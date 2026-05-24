import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { AgentActor, EventBusPort } from '../../../domain';
import { asPostToolUse, asPreToolUse } from './_input-helpers';

/**
 * Lifecycle trace hooks — forward selected SDK events to the in-process
 * EventBus so the UI can render agent activity in real time.
 *
 * Each agent session (parser, brand, supplier) constructs its own hook
 * factory and tags emitted events with:
 *   - `actor`: which agent is talking (brand / parser / supplier:<id>)
 *   - `sessionId`: a stable per-run identifier so the UI can group
 *     all events belonging to one query() invocation
 *
 * `PreToolUse` / `PostToolUse` keep emitting `kind: 'brand.thinking'`
 * for backward compatibility with the parsing-activity panel. The
 * `actor` field in payload lets newer consumers (Ask Amber trace)
 * tell who actually spoke.
 *
 * Use `publishAssistantText` from each adapter's `for await` loop to
 * forward the natural-language content blocks the agent emits
 * between tool calls — the part Claude Code shows inline.
 */
export function makeTraceHooks(opts: {
  quotationId: string;
  eventBus: EventBusPort;
  actor: AgentActor;
}): {
  PreToolUse: HookCallback;
  PostToolUse: HookCallback;
  sessionId: string;
} {
  const { quotationId, eventBus, actor } = opts;
  const sessionId = crypto.randomUUID();

  const PreToolUse: HookCallback = async (input) => {
    const evt = asPreToolUse(input);
    await eventBus.publish({
      id: crypto.randomUUID(),
      quotationId,
      kind: 'brand.thinking',
      payload: {
        phase: 'pre_tool_use',
        toolName: evt.tool_name ?? 'unknown',
        toolInput: evt.tool_input ?? null,
        actor,
        sessionId,
      },
      occurredAt: new Date().toISOString(),
    });
    return {};
  };

  const PostToolUse: HookCallback = async (input) => {
    const evt = asPostToolUse(input);
    await eventBus.publish({
      id: crypto.randomUUID(),
      quotationId,
      kind: 'brand.thinking',
      payload: {
        phase: 'post_tool_use',
        toolName: evt.tool_name ?? 'unknown',
        toolResponse: evt.tool_response ?? null,
        actor,
        sessionId,
      },
      occurredAt: new Date().toISOString(),
    });
    return {};
  };

  return { PreToolUse, PostToolUse, sessionId };
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; name: string; id: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown }
  | { type: string; [k: string]: unknown };

type SdkMessage = {
  type: string;
  message?: { content?: ContentBlock[] };
  [k: string]: unknown;
};

/**
 * Forward the natural-language content blocks (text + thinking) that
 * appear between tool calls in an assistant turn. Mirrors what Claude
 * Code renders inline so the Ask Amber trace can show the agent's
 * reasoning, not just its tool plumbing.
 *
 * Call this from inside `for await (const message of query(...))` —
 * once per yielded message. Cheap when the message has no relevant
 * content blocks (it just returns).
 */
export async function publishAssistantText(opts: {
  quotationId: string;
  eventBus: EventBusPort;
  actor: AgentActor;
  sessionId: string;
  message: unknown;
}): Promise<void> {
  const { quotationId, eventBus, actor, sessionId } = opts;
  const message = opts.message as SdkMessage;
  if (!message || message.type !== 'assistant') return;
  const content = message.message?.content ?? [];

  for (const block of content) {
    if (block.type === 'text') {
      const text = (block as { text?: string }).text?.trim();
      if (!text) continue;
      await eventBus.publish({
        id: crypto.randomUUID(),
        quotationId,
        kind: 'agent.text',
        payload: { actor, sessionId, variant: 'text', text },
        occurredAt: new Date().toISOString(),
      });
    } else if (block.type === 'thinking') {
      const text = (block as { thinking?: string }).thinking?.trim();
      if (!text) continue;
      await eventBus.publish({
        id: crypto.randomUUID(),
        quotationId,
        kind: 'agent.text',
        payload: { actor, sessionId, variant: 'thinking', text },
        occurredAt: new Date().toISOString(),
      });
    }
  }
}

/**
 * Bookend events so the UI can mark each agent run with a clear
 * start/end. Cheap and idempotent per adapter.
 */
export async function publishSessionStarted(opts: {
  quotationId: string;
  eventBus: EventBusPort;
  actor: AgentActor;
  sessionId: string;
  label?: string;
}): Promise<void> {
  await opts.eventBus.publish({
    id: crypto.randomUUID(),
    quotationId: opts.quotationId,
    kind: 'agent.session_started',
    payload: {
      actor: opts.actor,
      sessionId: opts.sessionId,
      label: opts.label ?? null,
    },
    occurredAt: new Date().toISOString(),
  });
}

export async function publishSessionCompleted(opts: {
  quotationId: string;
  eventBus: EventBusPort;
  actor: AgentActor;
  sessionId: string;
  result?: Record<string, unknown>;
}): Promise<void> {
  await opts.eventBus.publish({
    id: crypto.randomUUID(),
    quotationId: opts.quotationId,
    kind: 'agent.session_completed',
    payload: {
      actor: opts.actor,
      sessionId: opts.sessionId,
      ...(opts.result ?? {}),
    },
    occurredAt: new Date().toISOString(),
  });
}
