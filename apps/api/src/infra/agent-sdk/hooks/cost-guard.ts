import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';

/**
 * Soft cost guard hook. Reads the running `total_cost_usd` from the
 * SDK on `Stop` events and emits a warning when a soft budget is
 * exceeded. The hard cap is enforced by the SDK's `maxBudgetUsd`
 * option directly.
 *
 * This is observational — it does not abort the agent loop. Use the
 * `maxBudgetUsd` query option for hard limits.
 */
export function makeCostGuardHook(opts: {
  softBudgetUsd: number;
  onSoftBudgetExceeded: (info: {
    sessionId: string;
    costSoFarUsd: number;
    softBudgetUsd: number;
  }) => void;
}): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'Stop') return {};
    const cost = (input as unknown as { total_cost_usd?: number })
      .total_cost_usd;
    const sessionId = (input as unknown as { session_id?: string }).session_id;
    if (
      typeof cost === 'number' &&
      cost > opts.softBudgetUsd &&
      typeof sessionId === 'string'
    ) {
      opts.onSoftBudgetExceeded({
        sessionId,
        costSoFarUsd: cost,
        softBudgetUsd: opts.softBudgetUsd,
      });
    }
    return {};
  };
}
