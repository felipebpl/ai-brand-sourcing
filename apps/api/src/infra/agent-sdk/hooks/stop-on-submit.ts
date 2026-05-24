import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { asPostToolUse } from './_input-helpers';

/**
 * PostToolUse hook that terminates the agent loop cleanly the moment
 * the terminal `submit_extraction` tool returns a non-error response.
 *
 * Why this is needed: even with the SDK's `maxTurns`/`maxBudgetUsd`
 * limits, the agent has a tendency to continue reasoning after a
 * terminal tool call (commenting, double-checking, re-reading docs).
 * Each extra turn costs $0.01–0.05 and contributes nothing — the
 * result is already captured by the submit sink.
 *
 * Setting `continue: false` from a PostToolUse hook stops the loop
 * immediately. The `ResultMessage` will still be emitted; the SDK
 * just doesn't ask the model for another turn.
 */
export function makeStopOnSubmitHook(opts: {
  terminalToolName: string;
}): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PostToolUse') return {};
    const evt = asPostToolUse(input);
    if (evt.tool_name !== opts.terminalToolName) return {};
    if (evt.tool_response?.isError) return {};
    return {
      continue: false,
      systemMessage: `Terminal tool ${opts.terminalToolName} succeeded — stopping loop.`,
    };
  };
}
