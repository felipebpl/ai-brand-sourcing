import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { EventBusPort } from '../../../domain';

/**
 * Lifecycle trace hooks — forward selected SDK events to the in-process
 * EventBus so the UI can render agent activity in real time.
 *
 * Only `PreToolUse` and `PostToolUse` are published right now. Other
 * lifecycle events (`SessionStart`, `Stop`, `SubagentStart`,
 * `SubagentStop`) are easy to add when the corresponding UI affordance
 * exists.
 *
 * The hook is bound to a single `quotationId` so events route to the
 * right SSE subscriber.
 */
export function makeTraceHooks(opts: {
  quotationId: string;
  eventBus: EventBusPort;
}): {
  PreToolUse: HookCallback;
  PostToolUse: HookCallback;
} {
  const { quotationId, eventBus } = opts;

  const PreToolUse: HookCallback = async (input) => {
    const toolName =
      (input as unknown as { tool_name?: string }).tool_name ?? 'unknown';
    const toolInput =
      (input as unknown as { tool_input?: unknown }).tool_input ?? null;
    await eventBus.publish({
      id: crypto.randomUUID(),
      quotationId,
      kind: 'brand.thinking',
      payload: { phase: 'pre_tool_use', toolName, toolInput },
      occurredAt: new Date().toISOString(),
    });
    return {};
  };

  const PostToolUse: HookCallback = async (input) => {
    const toolName =
      (input as unknown as { tool_name?: string }).tool_name ?? 'unknown';
    const toolResponse =
      (input as unknown as { tool_response?: unknown }).tool_response ?? null;
    await eventBus.publish({
      id: crypto.randomUUID(),
      quotationId,
      kind: 'brand.thinking',
      payload: { phase: 'post_tool_use', toolName, toolResponse },
      occurredAt: new Date().toISOString(),
    });
    return {};
  };

  return { PreToolUse, PostToolUse };
}
