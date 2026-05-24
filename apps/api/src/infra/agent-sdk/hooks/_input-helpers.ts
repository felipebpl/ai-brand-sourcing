import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';

/**
 * Narrowing helpers for `HookCallback` inputs.
 *
 * The SDK's `HookCallback` parameter is typed as a discriminated union but
 * the discriminant key (`hook_event_name`) is not narrowed by usage — every
 * hook ends up doing `(input as unknown as { tool_name?: string }).tool_name`
 * to extract the per-event fields. These helpers move that cast into one
 * place and give callers a properly-typed object on the way out.
 */

type HookInput = Parameters<HookCallback>[0];

export interface PreToolUseInput {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: unknown;
  session_id?: string;
}

export interface PostToolUseInput {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_response: { isError?: boolean; [k: string]: unknown } | null;
  session_id?: string;
}

export interface StopInput {
  hook_event_name: 'Stop';
  total_cost_usd?: number;
  session_id?: string;
}

export function asPreToolUse(input: HookInput): PreToolUseInput {
  return input as unknown as PreToolUseInput;
}

export function asPostToolUse(input: HookInput): PostToolUseInput {
  return input as unknown as PostToolUseInput;
}

export function asStop(input: HookInput): StopInput {
  return input as unknown as StopInput;
}
