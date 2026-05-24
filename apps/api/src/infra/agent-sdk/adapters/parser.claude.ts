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
  QuotationExtraction,
} from '../../../domain';
import type { DB } from '../../../db';
import { modelFor, TaskAssignment } from '../model-router';
import {
  makeCostGuardHook,
  makeStopOnSubmitHook,
  makeTraceHooks,
  publishAssistantText,
  publishSessionCompleted,
  publishSessionStarted,
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
 *   - system prompt: PARSER_SUBAGENT_SYSTEM_PROMPT (inlined skill content)
 *   - tools: Bash, Read, Write (for Python via Bash) +
 *            mcp__parser__lookup_catalog, mcp__parser__submit_extraction
 *   - settingSources: [] — project-skills mechanism is not used; the
 *     skill content is inlined in the system prompt to save a Read turn
 *   - permissionMode: 'bypassPermissions' is INTENTIONAL: the parser
 *     must run python3 non-interactively. Mitigations:
 *       * `cwd` scoped to the workspace root
 *       * `disallowedTools` blocks Edit/WebFetch/WebSearch/Agent/Glob/Grep
 *       * hard caps `maxTurns: 25`, `maxBudgetUsd: 0.5`
 *       * `allowDangerouslySkipPermissions: true` confirms intent
 *
 * The terminal `mcp__parser__submit_extraction` tool captures the typed
 * payload into a sink that resolves the returned Promise.
 *
 * Hard caps (`maxTurns: 25`, `maxBudgetUsd: 0.5`) match ADR-014's
 * validated cost envelope across the four sample quotations.
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
    let extractionCapturedAt: number | null = null;
    const sink: SubmitExtractionSink = {
      async accept(extraction) {
        captured = extraction;
        extractionCapturedAt = Date.now();
      },
    };

    const mcpServer = makeParserMcpServer({ db: this.db, submitSink: sink });
    const filePath = resolveFilePath(this.workspaceRoot, input.storageUri);

    const actor = { kind: 'parser' as const };
    const traceHooks = makeTraceHooks({
      quotationId: input.quotationId,
      eventBus: this.eventBus,
      actor,
    });
    const sessionId = traceHooks.sessionId;
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

    await publishSessionStarted({
      quotationId: input.quotationId,
      eventBus: this.eventBus,
      actor,
      sessionId,
      label: `Parsing ${input.uploadedFilename}`,
    });

    let success: SDKResultSuccess | undefined;
    const iter = query({ prompt: userPrompt, options });
    for await (const message of iter) {
      await publishAssistantText({
        quotationId: input.quotationId,
        eventBus: this.eventBus,
        actor,
        sessionId,
        message,
      });
      if (message.type === 'result' && message.subtype === 'success') {
        success = message;
      }

      // Defensive exit: stopOnSubmit asks the SDK to halt after
      // submit_extraction, but the model can still trail commentary
      // and the result message sometimes never lands cleanly. As soon
      // as we have the extraction in hand, give the SDK ~3s to wrap
      // up and then force-close the iterator so the run doesn't hang.
      if (captured && extractionCapturedAt !== null) {
        const elapsed = Date.now() - extractionCapturedAt;
        if (success || elapsed > 3_000) {
          try {
            await iter.return?.(undefined);
          } catch {
            // Iterator already closed — fine.
          }
          break;
        }
      }
    }

    await publishSessionCompleted({
      quotationId: input.quotationId,
      eventBus: this.eventBus,
      actor,
      sessionId,
      result: success
        ? {
            costUsd: success.total_cost_usd,
            durationMs: success.duration_ms,
            turns: success.num_turns,
          }
        : { forced: true },
    });

    if (!captured) {
      throw new Error(
        'Parser run completed without calling submit_extraction (terminal tool)',
      );
    }

    await this.eventBus.publish({
      id: crypto.randomUUID(),
      quotationId: input.quotationId,
      kind: 'parser.completed',
      payload: {
        lineCount: captured.lines.length,
        ambiguityCount: captured.ambiguities.length,
        costUsd: success?.total_cost_usd ?? null,
        durationMs: success?.duration_ms ?? null,
        turns: success?.num_turns ?? null,
        resultLanded: success != null,
      },
      occurredAt: new Date().toISOString(),
    });

    return {
      quotationId: input.quotationId,
      extraction: captured,
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

