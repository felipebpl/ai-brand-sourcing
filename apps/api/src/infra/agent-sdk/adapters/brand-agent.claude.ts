import type { BrandAgentPort } from '../../../domain';

/**
 * Brand agent adapter using the Claude Agent SDK (Opus 4.7).
 *
 * Implementation strategy:
 *  - Single query() with `model: claude-opus-4-7`, `agents: { supplier-1..n }`
 *    declaring each supplier as a subagent, `allowedTools: ['Agent',
 *    'mcp__brand__*']`.
 *  - Brand agent internal loop: parallel Agent("supplier-N") calls each
 *    round, evaluates responses, decides whether to continue, picks
 *    winner.
 *  - System prompt carries: brand profile, user instruction intent, supplier
 *    profiles, baseline offer, conversation discipline rules (information
 *    asymmetry, stop criteria, BATNA), and tool inventory.
 *  - Final output: structured Recommendation via tool
 *    mcp__brand__submit_recommendation (forced via tool_choice).
 *  - For `reactToSupplierMessage`: resume the same session
 *    (sessionStore-backed), inject the supplier message + current
 *    recommendation, produce a new Recommendation.
 *  - Hard caps: maxTurns 40, maxBudgetUsd 2.00, timeout 180s.
 *
 * TBD — implementation lands once we're past scaffolding.
 */
export class ClaudeBrandAgentAdapter implements BrandAgentPort {
  async negotiate(): Promise<never> {
    throw new Error('ClaudeBrandAgentAdapter.negotiate not implemented yet');
  }
  async reactToSupplierMessage(): Promise<never> {
    throw new Error(
      'ClaudeBrandAgentAdapter.reactToSupplierMessage not implemented yet',
    );
  }
}
