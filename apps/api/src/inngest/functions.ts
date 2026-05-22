/**
 * Inngest function registry.
 *
 * TBD — the full workflow (parse → match → negotiate × 3 in parallel → curveball
 * waitForEvent → winner selection → PO) will be implemented once the agent
 * framework decision is finalized (see docs/DECISIONS.md, ADR-001).
 *
 * For now this exports an empty function list so the Inngest handler can be
 * wired and the dev server can boot.
 */

export const functions = [] as const;
