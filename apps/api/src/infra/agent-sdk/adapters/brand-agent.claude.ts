import {
  query,
  type AgentDefinition,
  type McpSdkServerConfigWithInstance,
  type Options,
  type SDKResultSuccess,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  BrandAgentNegotiateInput,
  BrandAgentPort,
  BrandAgentReactInput,
  EventBusPort,
  Recommendation,
  SupplierAgentPort,
} from '../../../domain';
import type { DB } from '../../../db';
import { modelFor, TaskAssignment } from '../model-router';
import {
  makeCostGuardHook,
  makeTraceHooks,
  publishAssistantText,
  publishSessionCompleted,
  publishSessionStarted,
} from '../hooks';
import { PgSessionStore } from '../session-store.pg';
import {
  BRAND_AGENT_SYSTEM_PROMPT,
  renderBrandAgentTaskPrompt,
} from '../prompts/brand-system';
import { makeBrandMcpServer } from '../tools/brand-server';
import type { SubmitRecommendationSink } from '../tools/submit-recommendation';

/**
 * Brand agent adapter (Claude Agent SDK).
 *
 * Implements `BrandAgentPort`:
 *   - `negotiate()` drives the full multi-supplier multi-round negotiation
 *     and returns the structured Recommendation captured from the
 *     `submit_recommendation` MCP tool.
 *   - `reactToSupplierMessage()` is reserved for the external curveball
 *     channel (`supplier.message` Inngest event). The trial relies on
 *     persona-driven intra-negotiation curveballs (see supplier-2 persona
 *     in `prompts/supplier-persona.ts`), so this method is intentionally
 *     out of scope.
 *
 * Security defaults applied to every `query()` here:
 *   - `settingSources: []`   — never load CLAUDE.md / ~/.claude config
 *   - `permissionMode: 'dontAsk'` — deny anything not in allowedTools
 *   - `tools: []` (no built-ins; only what we explicitly grant via MCP)
 *   - `sessionStore: PgSessionStore` (cross-host resume on Inngest)
 *   - hard caps `maxTurns`, `maxBudgetUsd`
 *
 * Smoke methods used to validate Step 1/2 SDK wiring live in
 * `apps/api/src/scripts/agent-smoke-helpers.ts` — kept out of this
 * production class.
 */
export class ClaudeBrandAgentAdapter implements BrandAgentPort {
  private readonly sessionStore: PgSessionStore;
  private readonly db: DB;
  private readonly eventBus: EventBusPort;
  private readonly softBudgetUsd: number;
  /** supplier-id → adapter; required for `negotiate()`. */
  private readonly supplierAdapters: ReadonlyMap<string, SupplierAgentPort>;
  /** supplier-id → negotiation row id; required for `negotiate()`. */
  private readonly negotiationIdBySupplier: ReadonlyMap<string, string>;

  constructor(opts: {
    db: DB;
    eventBus: EventBusPort;
    softBudgetUsd?: number;
    supplierAdapters?: ReadonlyMap<string, SupplierAgentPort>;
    negotiationIdBySupplier?: ReadonlyMap<string, string>;
  }) {
    this.db = opts.db;
    this.sessionStore = new PgSessionStore(opts.db);
    this.eventBus = opts.eventBus;
    this.softBudgetUsd = opts.softBudgetUsd ?? 1.5;
    this.supplierAdapters = opts.supplierAdapters ?? new Map();
    this.negotiationIdBySupplier = opts.negotiationIdBySupplier ?? new Map();
  }

  /**
   * Run the full negotiation: opens N supplier conversations (already
   * persisted as negotiation rows by the caller), drives a multi-round
   * agentic loop via the brand MCP tools, and returns the structured
   * Recommendation captured from `submit_recommendation`.
   *
   * Caller invariants:
   *  - `supplierAdapters` and `negotiationIdBySupplier` must be set on
   *    this adapter (via the constructor) for every supplier in `input.suppliers`.
   *  - Each negotiation row must already exist in the DB (created by
   *    `runNegotiation` pipeline before calling this).
   */
  async negotiate(input: BrandAgentNegotiateInput): Promise<Recommendation> {
    const supplierContextMap = new Map<
      string,
      {
        adapter: SupplierAgentPort;
        negotiationId: string;
        quotedItems: BrandAgentNegotiateInput['items'];
      }
    >();
    for (const profile of input.suppliers) {
      const adapter = this.supplierAdapters.get(profile.id);
      const negotiationId = this.negotiationIdBySupplier.get(profile.id);
      if (!adapter || !negotiationId) {
        throw new Error(
          `Brand adapter missing setup for ${profile.id}: ${
            !adapter ? 'no supplier adapter' : ''
          } ${!negotiationId ? 'no negotiation row' : ''}`,
        );
      }
      supplierContextMap.set(profile.id, {
        adapter,
        negotiationId,
        quotedItems: input.items,
      });
    }

    let captured: Recommendation | undefined;
    const sink: SubmitRecommendationSink = {
      accept: async (rec) => {
        captured = rec;
      },
    };

    const mcpServer = makeBrandMcpServer({
      db: this.db,
      quotationId: input.quotationId,
      suppliers: supplierContextMap,
      negotiationIdBySupplier: this.negotiationIdBySupplier,
      recommendationSink: sink,
    });

    const userPrompt = renderBrandAgentTaskPrompt({
      brand: input.brand,
      userInstruction: input.userInstruction,
      intent: input.intent,
      baseline: input.baseline,
      suppliers: input.suppliers,
      items: input.items,
      negotiationIdBySupplier: this.negotiationIdBySupplier,
    });

    const { options, sessionId } = this.makeBaseOptions({
      quotationId: input.quotationId,
      systemPrompt: BRAND_AGENT_SYSTEM_PROMPT,
      taskTier: TaskAssignment.brandAgent,
      maxTurns: 25,
      maxBudgetUsd: 2.0,
      mcpServers: { brand: mcpServer },
      tools: [],
      allowedTools: [
        'mcp__brand__ask_suppliers',
        'mcp__brand__walk_away_from',
        'mcp__brand__submit_recommendation',
      ],
      disallowedTools: [
        'Bash',
        'Read',
        'Write',
        'Edit',
        'WebFetch',
        'WebSearch',
        'Agent',
        'Glob',
        'Grep',
      ],
    });

    const brandActor = { kind: 'brand' as const };
    await publishSessionStarted({
      quotationId: input.quotationId,
      eventBus: this.eventBus,
      actor: brandActor,
      sessionId,
      label: `Brand orchestrator · ${input.suppliers.length} suppliers`,
    });

    let lastResult: SDKResultSuccess | undefined;
    for await (const message of query({ prompt: userPrompt, options })) {
      await publishAssistantText({
        quotationId: input.quotationId,
        eventBus: this.eventBus,
        actor: brandActor,
        sessionId,
        message,
      });
      if (message.type === 'result' && message.subtype === 'success') {
        lastResult = message;
      }
    }

    await publishSessionCompleted({
      quotationId: input.quotationId,
      eventBus: this.eventBus,
      actor: brandActor,
      sessionId,
      result: lastResult
        ? {
            costUsd: lastResult.total_cost_usd,
            durationMs: lastResult.duration_ms,
            turns: lastResult.num_turns,
          }
        : { aborted: true },
    });

    if (!captured) {
      throw new Error(
        `Brand agent finished without calling submit_recommendation. ` +
          `Last result: ${lastResult?.subtype ?? 'unknown'}; cost: $${
            lastResult?.total_cost_usd?.toFixed(4) ?? '?'
          }`,
      );
    }

    return captured;
  }

  async reactToSupplierMessage(
    _input: BrandAgentReactInput,
  ): Promise<Recommendation> {
    throw new Error(
      'ClaudeBrandAgentAdapter.reactToSupplierMessage is out of scope ' +
        'for this trial. Curveballs are handled intra-negotiation via the ' +
        'supplier-2 persona reveal (see prompts/supplier-persona.ts). ' +
        'External post-recommendation supplier.message events are not wired.',
    );
  }

  private makeBaseOptions(args: {
    quotationId: string;
    systemPrompt: string;
    taskTier: (typeof TaskAssignment)[keyof typeof TaskAssignment];
    maxTurns: number;
    maxBudgetUsd: number;
    agents?: Record<string, AgentDefinition>;
    tools?: string[];
    allowedTools?: string[];
    disallowedTools?: string[];
    mcpServers?: Record<string, McpSdkServerConfigWithInstance>;
  }): { options: Options; sessionId: string } {
    const traceHooks = makeTraceHooks({
      quotationId: args.quotationId,
      eventBus: this.eventBus,
      actor: { kind: 'brand' },
    });
    const costGuard = makeCostGuardHook({
      softBudgetUsd: this.softBudgetUsd,
      onSoftBudgetExceeded: (info) => {
        console.warn(
          `[brand-agent] soft budget exceeded for session ${info.sessionId}: $${info.costSoFarUsd.toFixed(4)} > $${info.softBudgetUsd.toFixed(2)}`,
        );
      },
    });

    const base: Record<string, unknown> = {
      model: modelFor(args.taskTier),
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: args.systemPrompt,
      },
      settingSources: [],
      permissionMode: 'dontAsk',
      tools: args.tools ?? [],
      allowedTools: args.allowedTools ?? [],
      agents: args.agents,
      mcpServers: args.mcpServers,
      maxTurns: args.maxTurns,
      maxBudgetUsd: args.maxBudgetUsd,
      sessionStore: this.sessionStore,
      hooks: {
        PreToolUse: [{ hooks: [traceHooks.PreToolUse] }],
        PostToolUse: [{ hooks: [traceHooks.PostToolUse] }],
        Stop: [{ hooks: [costGuard] }],
      },
    };
    if (args.disallowedTools) {
      base.disallowedTools = args.disallowedTools;
    }
    return { options: base as Options, sessionId: traceHooks.sessionId };
  }
}
