import {
  query,
  type AgentDefinition,
  type Options,
  type SDKResultSuccess,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { DB } from '../db';
import type { BrandProfile, EventBusPort } from '../domain';
import {
  makeCostGuardHook,
  makeTraceHooks,
  publishAssistantText,
  publishSessionCompleted,
  publishSessionStarted,
} from '../infra/agent-sdk/hooks';
import { modelFor, TaskAssignment } from '../infra/agent-sdk/model-router';
import { PgSessionStore } from '../infra/agent-sdk/session-store.pg';

/**
 * Smoke helpers — used only by `apps/api/src/scripts/agent-smoke.ts` to
 * validate Claude Agent SDK wiring end-to-end. These are NOT part of the
 * production negotiation flow:
 *
 *   - `runBootstrap` proves the SDK can boot against this project's
 *     configuration and return a typed structured output. Step 1 verifier.
 *   - `runPingParser` proves the brand agent can invoke a subagent via
 *     the `Agent` tool and pass its reply back as structured output.
 *     Step 2 verifier; uses a no-op placeholder subagent.
 *
 * Keeping them out of `ClaudeBrandAgentAdapter` so the adapter only
 * exposes `negotiate()` / `reactToSupplierMessage()` — the real
 * `BrandAgentPort` surface.
 */

const SOFT_BUDGET_USD = 0.15;

const BootstrapAckSchema = z.object({
  status: z.literal('ok'),
  message: z.string().min(1),
  modelInUse: z.string().min(1),
});

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

export interface BootstrapResult {
  status: 'ok';
  message: string;
  modelInUse: string;
  sessionId: string;
  costUsd: number;
  durationMs: number;
  turns: number;
}

const PingParserAckSchema = z.object({
  status: z.literal('ok'),
  parserMessage: z.string().min(1),
});

const PingParserAckJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'parserMessage'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
    parserMessage: { type: 'string', minLength: 1 },
  },
};

export interface PingParserResult {
  status: 'ok';
  parserMessage: string;
  sessionId: string;
  costUsd: number;
  durationMs: number;
  turns: number;
}

/**
 * Inline placeholder subagent for the parser-ping smoke test. Tells the
 * subagent to reply with a fixed sentence and stop — no real parsing.
 */
const parserPingAgentDefinition: AgentDefinition = {
  description:
    'Specialist parser for supplier quotation files. ' +
    'Invoke when a user uploads a quotation XLSX that needs to be turned ' +
    'into structured line items. [Smoke-test placeholder: returns a ping.]',
  prompt: [
    '# Parser subagent (smoke placeholder)',
    '',
    'You are being invoked as part of a wiring test. Reply with exactly',
    'the sentence:',
    '',
    '`Parser subagent online — smoke placeholder.`',
    '',
    'Do not call any tools. Do not invent extraction output.',
  ].join('\n'),
  model: modelFor(TaskAssignment.parserAgent),
  tools: [],
  maxTurns: 2,
};

function smokeBrandSystemPrompt(brand: BrandProfile): string {
  return [
    `# Role`,
    ``,
    `You are the AI sourcing agent for ${brand.name}.`,
    ``,
    `## Brand positioning`,
    brand.positioningHypothesis,
    ``,
    `This run is a smoke test; reply per the user prompt's instructions.`,
  ].join('\n');
}

interface SmokeOptionsArgs {
  db: DB;
  eventBus: EventBusPort;
  quotationId: string;
  brand: BrandProfile;
  outputSchema: Record<string, unknown>;
  maxTurns: number;
  maxBudgetUsd: number;
  agents?: Record<string, AgentDefinition>;
  tools?: string[];
  allowedTools?: string[];
}

function buildSmokeOptions(args: SmokeOptionsArgs): {
  options: Options;
  sessionId: string;
} {
  const sessionStore = new PgSessionStore(args.db);
  const traceHooks = makeTraceHooks({
    quotationId: args.quotationId,
    eventBus: args.eventBus,
    actor: { kind: 'brand' },
  });
  const costGuard = makeCostGuardHook({
    softBudgetUsd: SOFT_BUDGET_USD,
    onSoftBudgetExceeded: (info) => {
      console.warn(
        `[smoke] soft budget exceeded for session ${info.sessionId}: $${info.costSoFarUsd.toFixed(4)}`,
      );
    },
  });

  const base: Record<string, unknown> = {
    model: modelFor(TaskAssignment.brandAgent),
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: smokeBrandSystemPrompt(args.brand),
    },
    settingSources: [],
    permissionMode: 'dontAsk',
    tools: args.tools ?? [],
    allowedTools: args.allowedTools ?? [],
    agents: args.agents,
    maxTurns: args.maxTurns,
    maxBudgetUsd: args.maxBudgetUsd,
    sessionStore,
    outputFormat: { type: 'json_schema', schema: args.outputSchema },
    hooks: {
      PreToolUse: [{ hooks: [traceHooks.PreToolUse] }],
      PostToolUse: [{ hooks: [traceHooks.PostToolUse] }],
      Stop: [{ hooks: [costGuard] }],
    },
  };

  return { options: base as Options, sessionId: traceHooks.sessionId };
}

export async function runBootstrap(args: {
  db: DB;
  eventBus: EventBusPort;
  quotationId: string;
  brand: BrandProfile;
}): Promise<BootstrapResult> {
  const userPrompt = [
    'Bootstrap smoke test.',
    '',
    'You have no tools and no subagents in this run. Submit a brief',
    'status acknowledgment using the structured output schema:',
    '`{ status: "ok", message: <one short sentence confirming readiness>,',
    'modelInUse: <the model id you are running on> }`.',
  ].join('\n');

  const { options, sessionId } = buildSmokeOptions({
    db: args.db,
    eventBus: args.eventBus,
    quotationId: args.quotationId,
    brand: args.brand,
    outputSchema: BootstrapAckJsonSchema,
    maxTurns: 2,
    maxBudgetUsd: 0.15,
  });

  const actor = { kind: 'brand' as const };
  await publishSessionStarted({
    quotationId: args.quotationId,
    eventBus: args.eventBus,
    actor,
    sessionId,
    label: 'Brand agent smoke bootstrap',
  });

  let success: SDKResultSuccess | undefined;
  for await (const message of query({ prompt: userPrompt, options })) {
    await publishAssistantText({
      quotationId: args.quotationId,
      eventBus: args.eventBus,
      actor,
      sessionId,
      message,
    });
    if (message.type === 'result' && message.subtype === 'success') {
      success = message;
    }
  }

  await publishSessionCompleted({
    quotationId: args.quotationId,
    eventBus: args.eventBus,
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

export async function runPingParser(args: {
  db: DB;
  eventBus: EventBusPort;
  quotationId: string;
  brand: BrandProfile;
}): Promise<PingParserResult> {
  const userPrompt =
    'Invoke the parser subagent now via the Agent tool. Tell it that ' +
    'this is a wiring test. After it replies, submit a structured ' +
    "acknowledgement with the parser's final message verbatim in the " +
    '`parserMessage` field.';

  const { options, sessionId } = buildSmokeOptions({
    db: args.db,
    eventBus: args.eventBus,
    quotationId: args.quotationId,
    brand: args.brand,
    outputSchema: PingParserAckJsonSchema,
    maxTurns: 4,
    maxBudgetUsd: 0.3,
    agents: { parser: parserPingAgentDefinition },
    tools: ['Agent'],
    allowedTools: ['Agent'],
  });

  const actor = { kind: 'brand' as const };
  await publishSessionStarted({
    quotationId: args.quotationId,
    eventBus: args.eventBus,
    actor,
    sessionId,
    label: 'Brand agent smoke parser-ping',
  });

  let success: SDKResultSuccess | undefined;
  for await (const message of query({ prompt: userPrompt, options })) {
    await publishAssistantText({
      quotationId: args.quotationId,
      eventBus: args.eventBus,
      actor,
      sessionId,
      message,
    });
    if (message.type === 'result' && message.subtype === 'success') {
      success = message;
    }
  }

  await publishSessionCompleted({
    quotationId: args.quotationId,
    eventBus: args.eventBus,
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
