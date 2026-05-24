import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { asStop } from './_input-helpers';

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
    const stop = asStop(input);
    if (
      typeof stop.total_cost_usd === 'number' &&
      stop.total_cost_usd > opts.softBudgetUsd &&
      typeof stop.session_id === 'string'
    ) {
      opts.onSoftBudgetExceeded({
        sessionId: stop.session_id,
        costSoFarUsd: stop.total_cost_usd,
        softBudgetUsd: opts.softBudgetUsd,
      });
    }
    return {};
  };
}
