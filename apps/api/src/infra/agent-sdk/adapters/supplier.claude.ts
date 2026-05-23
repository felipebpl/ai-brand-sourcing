import type { SupplierAgentPort, SupplierProfile } from '../../../domain';

/**
 * Supplier agent adapter using the Claude Agent SDK (Haiku 4.5).
 *
 * One instance per supplier. Persona drives system prompt — cost floor,
 * lead-time flexibility, payment-term preferences, negotiation style.
 *
 * Note: supplier agents are invoked as subagents of the brand agent in
 * production, but for testability we wrap each in a stand-alone adapter
 * that exposes `respond()` per the port. The brand agent's `Agent()`
 * subagent call ultimately routes here.
 *
 * Strict tool: `mcp__supplier__respond` with discriminated-union output
 * (`counter_offer | accept | walk_away | request_clarification`). Forced
 * via tool_choice on the closing turn.
 *
 * Information asymmetry guard: this adapter never receives or surfaces
 * what other suppliers have offered. Only the brand's ask + its own
 * conversation history (loaded via sessionStore).
 *
 * TBD — implementation lands once we're past scaffolding.
 */
export class ClaudeSupplierAgentAdapter implements SupplierAgentPort {
  constructor(public readonly profile: SupplierProfile) {}

  async respond(): Promise<never> {
    throw new Error('ClaudeSupplierAgentAdapter.respond not implemented yet');
  }
}
