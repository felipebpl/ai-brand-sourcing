import { asc, eq } from 'drizzle-orm';
import {
  query,
  type Options,
  type SDKResultSuccess,
} from '@anthropic-ai/claude-agent-sdk';
import { NegotiationOfferSchema } from '@app/shared';
import { z } from 'zod';
import type {
  BrandProfile,
  EventBusPort,
  NegotiationOffer,
  SupplierAgentPort,
  SupplierAgentRespondInput,
  SupplierAgentResponse,
  SupplierProfile,
} from '../../../domain';
import type { DB } from '../../../db';
import { negotiationMessage } from '../../../db/schema';
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
  renderSupplierRuntimeContext,
  renderSupplierSystemPrompt,
} from '../prompts/supplier-persona';

/**
 * Claude Agent SDK adapter for a single supplier agent.
 *
 * One instance per (supplier × negotiation) is the natural granularity,
 * but `respond` is stateless — the adapter reads conversation history
 * from the DB on every call and reconstructs the prompt. This matches
 * the "supplier is an external entity exchanging messages via DB rows"
 * model from ADR-013 follow-up: `negotiation_message[]` is the source
 * of truth, agents are pure functions over it.
 *
 * Why no session resume:
 * - Curveball messages (user-injected `negotiation_message(role=supplier)`
 *   rows) need to flow into the supplier's next reasoning step without
 *   the supplier having "said" them through a Claude turn. Replaying
 *   from the DB on each call makes that trivial.
 * - Inngest may re-run the function on a different host; no session
 *   continuity to worry about.
 * - Cost: each call re-sends history, but with prompt caching on the
 *   stable persona prefix the marginal tokens are tiny, and the model
 *   is Haiku 4.5 anyway.
 */
export class ClaudeSupplierAgentAdapter implements SupplierAgentPort {
  private readonly sessionStore: PgSessionStore;
  private readonly brand: BrandProfile;
  private readonly defaultPaymentTermsDisplay: string;

  readonly profile: SupplierProfile;

  constructor(args: {
    db: DB;
    eventBus: EventBusPort;
    profile: SupplierProfile;
    brand: BrandProfile;
    defaultPaymentTermsDisplay: string;
  }) {
    this.db = args.db;
    this.eventBus = args.eventBus;
    this.profile = args.profile;
    this.brand = args.brand;
    this.defaultPaymentTermsDisplay = args.defaultPaymentTermsDisplay;
    this.sessionStore = new PgSessionStore(args.db);
  }

  private readonly db: DB;
  private readonly eventBus: EventBusPort;

  async respond(
    input: SupplierAgentRespondInput,
  ): Promise<SupplierAgentResponse> {
    const history = await this.loadHistory(input.negotiationId);
    const systemPrompt = renderSupplierSystemPrompt({
      profile: this.profile,
      brand: this.brand,
      defaultPaymentTermsDisplay: this.defaultPaymentTermsDisplay,
    });
    const runtimeContext = renderSupplierRuntimeContext({
      quotedItems: input.quotedItems,
    });
    const userPrompt = renderUserPrompt({
      runtimeContext,
      history,
      brandMessage: input.brandMessage,
      brandAsk: input.brandAsk,
      turnIndex: input.turnIndex,
    });

    const quotationId = input.quotationId;
    const actor = {
      kind: 'supplier' as const,
      supplierId: this.profile.id,
    };
    const traceHooks = makeTraceHooks({
      eventBus: this.eventBus,
      quotationId,
      actor,
    });
    const sessionId = traceHooks.sessionId;
    const costGuard = makeCostGuardHook({
      softBudgetUsd: 0.1,
      onSoftBudgetExceeded: (info) => {
        console.warn(`[${this.profile.id}] soft budget exceeded`, info);
      },
    });

    const options: Options = {
      model: modelFor(TaskAssignment.supplierAgent),
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: systemPrompt,
      },
      settingSources: [],
      permissionMode: 'dontAsk',
      tools: [],
      allowedTools: [],
      disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Agent', 'Glob', 'Grep'],
      maxTurns: 3,
      maxBudgetUsd: 0.2,
      sessionStore: this.sessionStore,
      outputFormat: {
        type: 'json_schema',
        schema: SUPPLIER_RESPONSE_JSON_SCHEMA,
      },
      hooks: {
        PreToolUse: [{ hooks: [traceHooks.PreToolUse] }],
        PostToolUse: [{ hooks: [traceHooks.PostToolUse] }],
        Stop: [{ hooks: [costGuard] }],
      },
    };

    await publishSessionStarted({
      quotationId,
      eventBus: this.eventBus,
      actor,
      sessionId,
      label: `${this.profile.id} · round ${input.turnIndex + 1}`,
    });

    let success: SDKResultSuccess | undefined;
    for await (const message of query({ prompt: userPrompt, options })) {
      await publishAssistantText({
        quotationId,
        eventBus: this.eventBus,
        actor,
        sessionId,
        message,
      });
      if (message.type === 'result' && message.subtype === 'success') {
        success = message;
      }
    }

    await publishSessionCompleted({
      quotationId,
      eventBus: this.eventBus,
      actor,
      sessionId,
      result: success
        ? {
            costUsd: success.total_cost_usd,
            durationMs: success.duration_ms,
            turns: success.num_turns,
          }
        : { aborted: true },
    });

    if (!success || !success.structured_output) {
      throw new Error(
        `Supplier ${this.profile.id} produced no structured output`,
      );
    }

    const parsed = parseStructuredOutput(success.structured_output);

    await this.persistMessage({
      negotiationId: input.negotiationId,
      turnIndex: input.turnIndex,
      response: parsed,
      modelInUse: modelFor(TaskAssignment.supplierAgent),
      costUsd: success.total_cost_usd,
    });

    return parsed;
  }

  private async loadHistory(
    negotiationId: string,
  ): Promise<NegotiationMessageRow[]> {
    return this.db
      .select({
        role: negotiationMessage.role,
        turnIndex: negotiationMessage.turnIndex,
        content: negotiationMessage.content,
        offer: negotiationMessage.offer,
        metadata: negotiationMessage.metadata,
      })
      .from(negotiationMessage)
      .where(eq(negotiationMessage.negotiationId, negotiationId))
      .orderBy(asc(negotiationMessage.turnIndex));
  }

  private async persistMessage(args: {
    negotiationId: string;
    turnIndex: number;
    response: SupplierAgentResponse;
    modelInUse: string;
    costUsd: number;
  }): Promise<void> {
    const offerJson =
      args.response.kind === 'counter_offer' ? args.response.offer : null;
    const metadata: Record<string, unknown> = {
      modelInUse: args.modelInUse,
      costUsd: args.costUsd,
      intent: args.response.kind,
    };
    if (args.response.kind === 'walk_away') {
      metadata.walkAwayReason = args.response.reason;
    }
    if (args.response.kind === 'request_clarification') {
      metadata.question = args.response.question;
    }

    await this.db.insert(negotiationMessage).values({
      negotiationId: args.negotiationId,
      role: 'supplier',
      turnIndex: args.turnIndex,
      content: args.response.message,
      offer: offerJson as unknown,
      metadata,
    });
  }
}

// -------- prompt assembly ---------------------------------------------------

interface NegotiationMessageRow {
  role: 'brand' | 'supplier' | 'system';
  turnIndex: number;
  content: string;
  offer: unknown;
  metadata: unknown;
}

function renderUserPrompt(args: {
  runtimeContext: string;
  history: NegotiationMessageRow[];
  brandMessage: string;
  brandAsk: NegotiationOffer | null;
  turnIndex: number;
}): string {
  const threadLines = args.history
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const speaker = m.role === 'brand' ? '[brand]' : '[you]';
      const offerNote = m.offer ? ` (offer attached: ${JSON.stringify(m.offer)})` : '';
      return `${speaker} (turn ${m.turnIndex}): ${m.content}${offerNote}`;
    });

  const lines = [args.runtimeContext, ``, `# Conversation so far`, ``];
  if (threadLines.length === 0) {
    lines.push('(This is the opening message of the negotiation.)');
  } else {
    lines.push(...threadLines);
  }

  lines.push(
    ``,
    `# New brand message (turn ${args.turnIndex})`,
    ``,
    args.brandMessage,
  );

  if (args.brandAsk) {
    lines.push(
      ``,
      `## Structured ask attached`,
      `\`\`\`json`,
      JSON.stringify(args.brandAsk, null, 2),
      `\`\`\``,
    );
  }

  lines.push(
    ``,
    `# Your turn`,
    `Respond as the supplier rep per the persona and rules in the system`,
    `prompt. Use the structured output format. Keep \`message\` to 1–3`,
    `sentences. If you propose a counter-offer, fill the \`offer\` block.`,
  );

  return lines.join('\n');
}

// -------- structured output schema -----------------------------------------

const SUPPLIER_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['intent', 'message'],
  additionalProperties: false,
  properties: {
    intent: {
      type: 'string',
      enum: [
        'counter_offer',
        'accept',
        'walk_away',
        'request_clarification',
      ],
    },
    message: { type: 'string', minLength: 1 },
    offer: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: [
        'unitPriceAvg',
        'leadTimeDays',
        'paymentTerms',
        'currency',
        'fulfillablePct',
        'notes',
      ],
      properties: {
        unitPriceAvg: { type: 'number', minimum: 0 },
        leadTimeDays: { type: 'integer', minimum: 0 },
        paymentTerms: {
          type: 'object',
          required: ['installments', 'display'],
          additionalProperties: false,
          properties: {
            installments: {
              type: 'array',
              items: {
                type: 'object',
                required: ['percent', 'dueDays'],
                additionalProperties: false,
                properties: {
                  percent: { type: 'number', minimum: 0, maximum: 100 },
                  dueDays: { type: 'integer' },
                },
              },
            },
            display: { type: 'string' },
          },
        },
        currency: {
          type: 'string',
          enum: ['USD', 'BRL', 'EUR', 'CNY', 'GBP'],
        },
        fulfillablePct: { type: 'number', minimum: 0, maximum: 1 },
        notes: { type: ['string', 'null'] },
      },
    },
    walkAwayReason: { type: ['string', 'null'] },
    clarificationQuestion: { type: ['string', 'null'] },
  },
};

/**
 * Defense-in-depth Zod validation of the supplier's structured output.
 * The SDK already enforces SUPPLIER_RESPONSE_JSON_SCHEMA server-side, but
 * we re-validate here per CLAUDE.md (`Numbers persisted from agent outputs
 * go through Zod before reaching Drizzle`). Catches schema drift between
 * the JSON Schema and downstream consumers earlier.
 */
const RawSupplierResponseSchema = z.object({
  intent: z.enum([
    'counter_offer',
    'accept',
    'walk_away',
    'request_clarification',
  ]),
  message: z.string().min(1),
  offer: NegotiationOfferSchema.nullable().optional(),
  walkAwayReason: z.string().nullable().optional(),
  clarificationQuestion: z.string().nullable().optional(),
});

export function parseStructuredOutput(raw: unknown): SupplierAgentResponse {
  const result = RawSupplierResponseSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Supplier output failed Zod validation: ${result.error.message}`,
    );
  }
  const parsed = result.data;
  switch (parsed.intent) {
    case 'counter_offer':
      if (!parsed.offer) {
        throw new Error('counter_offer intent without offer payload');
      }
      return {
        kind: 'counter_offer',
        offer: parsed.offer,
        message: parsed.message,
      };
    case 'accept':
      return { kind: 'accept', message: parsed.message };
    case 'walk_away':
      return {
        kind: 'walk_away',
        reason: parsed.walkAwayReason ?? 'no reason provided',
        message: parsed.message,
      };
    case 'request_clarification':
      return {
        kind: 'request_clarification',
        question: parsed.clarificationQuestion ?? parsed.message,
        message: parsed.message,
      };
  }
}
