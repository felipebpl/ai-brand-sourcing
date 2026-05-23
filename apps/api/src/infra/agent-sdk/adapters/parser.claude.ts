import { resolve } from 'node:path';
import {
  query,
  type Options,
  type SDKResultSuccess,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  EventBusPort,
  ParserPort,
  ParseResult,
  UserInstructionIntent,
  QuotationExtraction,
} from '../../../domain';
import type { DB } from '../../../db';
import { modelFor, TaskAssignment } from '../model-router';
import {
  makeCostGuardHook,
  makeStopOnSubmitHook,
  makeTraceHooks,
} from '../hooks';
import { PgSessionStore } from '../session-store.pg';
import { PARSER_SUBAGENT_SYSTEM_PROMPT } from '../prompts/parser-system';
import { makeParserMcpServer } from '../tools/parser-server';
import type { SubmitExtractionSink } from '../tools/submit-extraction';

/**
 * Parser adapter (Claude Agent SDK).
 *
 * Spawns a Claude `query()` configured as the parser subagent:
 *   - model: Claude Sonnet 4.6 via model-router
 *   - skill: quotation-parser loaded from the in-repo skill bundle
 *   - tools: Bash, Read, Write (for Python via Bash) +
 *            mcp__parser__lookup_catalog, mcp__parser__submit_extraction
 *   - settingSources: ['project'] so the skill folder is discovered
 *   - permissionMode: 'bypassPermissions' is INTENTIONAL here because
 *     the parser must run python3 noninteractively. We mitigate by:
 *       * scoping `cwd` to the workspace root
 *       * disallowing dangerous tools (no Edit, no WebFetch)
 *       * `allowDangerouslySkipPermissions: true` is required by the
 *         SDK to confirm intent
 *
 * The terminal `mcp__parser__submit_extraction` tool captures the typed
 * payload into a sink that resolves the returned Promise.
 *
 * Hard caps (`maxTurns: 20`, `maxBudgetUsd: 0.20`) protect against
 * runaway tool loops on adversarial files.
 */
export class ClaudeParserAdapter implements ParserPort {
  private readonly sessionStore: PgSessionStore;

  constructor(opts: {
    db: DB;
    eventBus: EventBusPort;
    workspaceRoot: string;
    softBudgetUsd?: number;
  }) {
    this.db = opts.db;
    this.sessionStore = new PgSessionStore(opts.db);
    this.eventBus = opts.eventBus;
    this.workspaceRoot = opts.workspaceRoot;
    this.softBudgetUsd = opts.softBudgetUsd ?? 0.15;
  }

  private readonly db: DB;
  private readonly eventBus: EventBusPort;
  private readonly workspaceRoot: string;
  private readonly softBudgetUsd: number;

  async parse(input: {
    quotationId: string;
    storageUri: string;
    uploadedFilename: string;
    userInstruction: string | null;
  }): Promise<ParseResult> {
    let captured: QuotationExtraction | undefined;
    const sink: SubmitExtractionSink = {
      async accept(extraction) {
        captured = extraction;
      },
    };

    const mcpServer = makeParserMcpServer({ db: this.db, submitSink: sink });
    const filePath = resolveFilePath(this.workspaceRoot, input.storageUri);

    const traceHooks = makeTraceHooks({
      quotationId: input.quotationId,
      eventBus: this.eventBus,
    });
    const costGuard = makeCostGuardHook({
      softBudgetUsd: this.softBudgetUsd,
      onSoftBudgetExceeded: (info) => {
        console.warn(
          `[parser] soft budget exceeded for session ${info.sessionId}: $${info.costSoFarUsd.toFixed(4)}`,
        );
      },
    });

    const userInstructionLine = input.userInstruction
      ? `User instruction (free text): ${input.userInstruction}`
      : 'User instruction: (none provided)';

    const userPrompt = [
      'You are the quotation-parser agent. Parse the supplier quotation',
      'file into a typed QuotationExtraction payload by following the',
      'skill instructions you already have loaded.',
      '',
      `File path (absolute): ${filePath}`,
      `Original filename: ${input.uploadedFilename}`,
      userInstructionLine,
      '',
      'Call `mcp__parser__submit_extraction` exactly once at the end with',
      'your full payload. End the turn immediately after that call — no',
      'further commentary.',
    ].join('\n');

    const stopOnSubmit = makeStopOnSubmitHook({
      terminalToolName: 'mcp__parser__submit_extraction',
    });

    const options: Options = {
      model: modelFor(TaskAssignment.parserAgent),
      cwd: this.workspaceRoot,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: PARSER_SUBAGENT_SYSTEM_PROMPT,
      },
      settingSources: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      mcpServers: { parser: mcpServer },
      tools: ['Bash', 'Read', 'Write'],
      allowedTools: [
        'Bash',
        'Read',
        'Write',
        'mcp__parser__lookup_catalog',
        'mcp__parser__submit_extraction',
      ],
      disallowedTools: [
        'Edit',
        'WebFetch',
        'WebSearch',
        'Agent',
        'Glob',
        'Grep',
      ],
      maxTurns: 25,
      maxBudgetUsd: 0.5,
      sessionStore: this.sessionStore,
      hooks: {
        PreToolUse: [{ hooks: [traceHooks.PreToolUse] }],
        PostToolUse: [
          { hooks: [traceHooks.PostToolUse, stopOnSubmit] },
        ],
        Stop: [{ hooks: [costGuard] }],
      },
    };

    let success: SDKResultSuccess | undefined;
    for await (const message of query({ prompt: userPrompt, options })) {
      if (message.type === 'result' && message.subtype === 'success') {
        success = message;
      }
    }

    if (!success) {
      throw new Error('Parser run did not yield a success result');
    }
    if (!captured) {
      throw new Error(
        'Parser run completed without calling submit_extraction (terminal tool)',
      );
    }

    const intent: UserInstructionIntent = {
      priority: 'balanced',
      constraints: {},
    };

    await this.eventBus.publish({
      id: crypto.randomUUID(),
      quotationId: input.quotationId,
      kind: 'parser.completed',
      payload: {
        lineCount: captured.lines.length,
        ambiguityCount: captured.ambiguities.length,
        costUsd: success.total_cost_usd,
        durationMs: success.duration_ms,
        turns: success.num_turns,
      },
      occurredAt: new Date().toISOString(),
    });

    return {
      quotationId: input.quotationId,
      extraction: captured,
      intent,
    };
  }
}

function resolveFilePath(workspaceRoot: string, storageUri: string): string {
  if (storageUri.startsWith('file://')) {
    return storageUri.slice('file://'.length);
  }
  if (storageUri.startsWith('/')) {
    return storageUri;
  }
  return resolve(workspaceRoot, storageUri);
}

