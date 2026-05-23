/**
 * Maps a task tier to a Claude model id.
 *
 * Centralizes model choice so we change one file when prices shift or
 * a new model lands. Each tier maps to a default; callers can override
 * by passing the explicit model id.
 *
 * Pricing (May 2026, ballpark per 1M tokens):
 *   opus-4-7    $5 in / $25 out / cache read $0.50
 *   sonnet-4-6  $3 in / $15 out / cache read $0.30
 *   haiku-4-5   $1 in / $5  out / cache read $0.10
 */

export const TaskTier = {
  /** Planner / final judge / hard reasoning. */
  Strategic: 'strategic',
  /** Multi-turn dialogue, structured parsing, mid-stakes decisions. */
  Tactical: 'tactical',
  /** Persona simulation, classification, light extraction. */
  Worker: 'worker',
} as const;
export type TaskTier = (typeof TaskTier)[keyof typeof TaskTier];

const TIER_TO_MODEL: Record<TaskTier, string> = {
  strategic: 'claude-opus-4-7',
  tactical: 'claude-sonnet-4-6',
  worker: 'claude-haiku-4-5',
};

export function modelFor(tier: TaskTier): string {
  return TIER_TO_MODEL[tier];
}

/**
 * Task → tier mapping. Keep this list explicit so the cost surface of
 * each call is obvious at code-review time.
 */
export const TaskAssignment = {
  brandAgent: TaskTier.Strategic,
  brandRecommendationFinal: TaskTier.Strategic,
  brandReactToSupplierMessage: TaskTier.Strategic,
  parserAgent: TaskTier.Tactical,
  supplierAgent: TaskTier.Worker,
  userInstructionIntent: TaskTier.Worker,
} as const;
