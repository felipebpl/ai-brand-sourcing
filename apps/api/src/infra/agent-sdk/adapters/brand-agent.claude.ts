import {
  query,
  type AgentDefinition,
  type Options,
  type SDKResultSuccess,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type {
  BrandAgentNegotiateInput,
  BrandAgentPort,
  BrandAgentReactInput,
  EventBusPort,
  Recommendation,
} from '../../../domain';
import type { DB } from '../../../db';
import { modelFor, TaskAssignment } from '../model-router';
import { makeCostGuardHook, makeTraceHooks } from '../hooks';
import { PgSessionStore } from '../session-store.pg';
import { renderBrandAgentSystemPrompt } from '../prompts/brand-agent';
import {
  PARSER_AGENT_PLACEHOLDER_DESCRIPTION,
  PARSER_AGENT_PLACEHOLDER_PROMPT,
} from '../prompts/parser-agent';

/**
 * Brand agent adapter (Claude Agent SDK).
 *
 * For Step 1 (current scope): wires the config — model tier, system
 * prompt, session store, hooks, hard caps, security defaults — and
 * exposes a `bootstrap()` smoke method that proves the SDK can boot
 * against this configuration and produce a typed result.
 *
 * Subagent wiring (parser + suppliers) lands in Step 2.
 * `negotiate()` and `reactToSupplierMessage()` are intentionally
 * throwing until then; the orchestrator never calls them yet.
 *
 * Security defaults applied to every `query()` here:
 *   - `settingSources: []`   — never load CLAUDE.md / ~/.claude config
 *   - `permissionMode: 'dontAsk'` — deny anything not in allowedTools
 *   - `tools: []` (no built-ins; only what we explicitly grant via MCP)
 *   - `sessionStore: PgSessionStore` (cross-host resume on Inngest)
 *   - hard caps `maxTurns`, `maxBudgetUsd`
 */
export class ClaudeBrandAgentAdapter implements BrandAgentPort {
  private readonly sessionStore: PgSessionStore;

  constructor(opts: {
    db: DB;
    eventBus: EventBusPort;
    softBudgetUsd?: number;
  }) {
    this.sessionStore = new PgSessionStore(opts.db);
    this.eventBus = opts.eventBus;
    this.softBudgetUsd = opts.softBudgetUsd ?? 1.5;
  }

  private readonly eventBus: EventBusPort;
  private readonly softBudgetUsd: number;

  /**
   * Smoke-test method: boots a minimal `query()` to validate the SDK is
   * properly configured against this project. Not part of the
   * `BrandAgentPort` contract — used only by `bun run agent:smoke`.
   */
  async bootstrap(args: {
    quotationId: string;
    brand: { id: string; name: string; positioningHypothesis: string };
  }): Promise<BootstrapResult> {
    const systemPrompt = renderBrandAgentSystemPrompt({ brand: args.brand });
    const userPrompt = [
      'Bootstrap smoke test.',
      '',
      'You have no tools and no subagents in this run. Submit a brief',
      'status acknowledgment using the structured output schema:',
      '`{ status: "ok", message: <one short sentence confirming readiness>,',
      'modelInUse: <the model id you are running on> }`.',
    ].join('\n');

    const options = this.makeBaseOptions({
      quotationId: args.quotationId,
      systemPrompt,
      taskTier: TaskAssignment.brandAgent,
      outputSchema: BootstrapAckJsonSchema,
      maxTurns: 2,
      maxBudgetUsd: 0.15,
    });

    let success: SDKResultSuccess | undefined;
    for await (const message of query({ prompt: userPrompt, options })) {
      if (message.type === 'result' && message.subtype === 'success') {
        success = message;
      }
    }

    if (!success) {
      throw new Error('Brand agent bootstrap did not yield a success result');
    }

    const parsed = BootstrapAckSchema.safeParse(success.structured_output);
    if (!parsed.success) {
      throw new Error(
        `Brand agent bootstrap returned an unexpected output shape: ${parsed.error.message}`,
      );
    }

    return {
      status: parsed.data.status,
      message: parsed.data.message,
      modelInUse: parsed.data.modelInUse,
      sessionId: success.session_id,
      costUsd: success.total_cost_usd,
      durationMs: success.duration_ms,
      turns: success.num_turns,
    };
  }

  /**
   * Step 2 smoke method: invokes the parser subagent via the `Agent`
   * tool and reports back what it said. Validates the Agent → subagent
   * → return-result wiring end-to-end. Subagent prompt is currently a
   * placeholder; Step 3 plugs in the real skill and tools.
   */
  async pingParser(args: {
    quotationId: string;
    brand: { id: string; name: string; positioningHypothesis: string };
  }): Promise<PingParserResult> {
    const systemPrompt = renderBrandAgentSystemPrompt({ brand: args.brand });
    const userPrompt = [
      'Invoke the parser subagent now via the Agent tool. Tell it that',
      'this is a wiring test. After it replies, submit a structured',
      'acknowledgement with the parser\'s final message verbatim in the',
      '`parserMessage` field.',
    ].join(' ');

    const options = this.makeBaseOptions({
      quotationId: args.quotationId,
      systemPrompt,
      taskTier: TaskAssignment.brandAgent,
      outputSchema: PingParserAckJsonSchema,
      maxTurns: 4,
      maxBudgetUsd: 0.30,
      agents: { parser: parserPlaceholderAgentDefinition },
      tools: ['Agent'],
      allowedTools: ['Agent'],
    });

    let success: SDKResultSuccess | undefined;
    for await (const message of query({ prompt: userPrompt, options })) {
      if (message.type === 'result' && message.subtype === 'success') {
        success = message;
      }
    }

    if (!success) {
      throw new Error('pingParser did not yield a success result');
    }

    const parsed = PingParserAckSchema.safeParse(success.structured_output);
    if (!parsed.success) {
      throw new Error(
        `pingParser returned an unexpected output shape: ${parsed.error.message}`,
      );
    }

    return {
      status: parsed.data.status,
      parserMessage: parsed.data.parserMessage,
      sessionId: success.session_id,
      costUsd: success.total_cost_usd,
      durationMs: success.duration_ms,
      turns: success.num_turns,
    };
  }

  async negotiate(_input: BrandAgentNegotiateInput): Promise<Recommendation> {
    throw new Error(
      'ClaudeBrandAgentAdapter.negotiate not implemented yet (Step 5)',
    );
  }

  async reactToSupplierMessage(
    _input: BrandAgentReactInput,
  ): Promise<Recommendation> {
    throw new Error(
      'ClaudeBrandAgentAdapter.reactToSupplierMessage not implemented yet (Step 5)',
    );
  }

  private makeBaseOptions(args: {
    quotationId: string;
    systemPrompt: string;
    taskTier: (typeof TaskAssignment)[keyof typeof TaskAssignment];
    outputSchema: Record<string, unknown>;
    maxTurns: number;
    maxBudgetUsd: number;
    agents?: Record<string, AgentDefinition>;
    tools?: string[];
    allowedTools?: string[];
  }): Options {
    const traceHooks = makeTraceHooks({
      quotationId: args.quotationId,
      eventBus: this.eventBus,
    });
    const costGuard = makeCostGuardHook({
      softBudgetUsd: this.softBudgetUsd,
      onSoftBudgetExceeded: (info) => {
        console.warn(
          `[brand-agent] soft budget exceeded for session ${info.sessionId}: $${info.costSoFarUsd.toFixed(4)} > $${info.softBudgetUsd.toFixed(2)}`,
        );
      },
    });

    return {
      model: modelFor(args.taskTier),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: args.systemPrompt },
      settingSources: [],
      permissionMode: 'dontAsk',
      tools: args.tools ?? [],
      allowedTools: args.allowedTools ?? [],
      agents: args.agents,
      maxTurns: args.maxTurns,
      maxBudgetUsd: args.maxBudgetUsd,
      sessionStore: this.sessionStore,
      outputFormat: { type: 'json_schema', schema: args.outputSchema },
      hooks: {
        PreToolUse: [{ hooks: [traceHooks.PreToolUse] }],
        PostToolUse: [{ hooks: [traceHooks.PostToolUse] }],
        Stop: [{ hooks: [costGuard] }],
      },
    } as Options;
  }
}

// -------- Subagent definitions ---------------------------------------------

const parserPlaceholderAgentDefinition: AgentDefinition = {
  description: PARSER_AGENT_PLACEHOLDER_DESCRIPTION,
  prompt: PARSER_AGENT_PLACEHOLDER_PROMPT,
  model: modelFor(TaskAssignment.parserAgent),
  tools: [],
  maxTurns: 2,
};

// -------- Bootstrap structured output ---------------------------------------

const BootstrapAckSchema = z.object({
  status: z.literal('ok'),
  message: z.string().min(1),
  modelInUse: z.string().min(1),
});

export interface BootstrapResult {
  status: 'ok';
  message: string;
  modelInUse: string;
  sessionId: string;
  costUsd: number;
  durationMs: number;
  turns: number;
}

const BootstrapAckJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'message', 'modelInUse'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
    message: { type: 'string', minLength: 1 },
    modelInUse: { type: 'string', minLength: 1 },
  },
};

// -------- pingParser structured output -------------------------------------

const PingParserAckSchema = z.object({
  status: z.literal('ok'),
  parserMessage: z.string().min(1),
});

export interface PingParserResult {
  status: 'ok';
  parserMessage: string;
  sessionId: string;
  costUsd: number;
  durationMs: number;
  turns: number;
}

const PingParserAckJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'parserMessage'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
    parserMessage: { type: 'string', minLength: 1 },
  },
};
