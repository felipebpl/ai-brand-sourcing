import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { DB } from '../../../db';
import { negotiation, negotiationMessage } from '../../../db/schema';

/**
 * `walk_away_from` MCP tool — brand agent explicitly closes a
 * negotiation as stalled. The supplier is removed from further rounds
 * but their last offer remains in the comparison matrix so the brand
 * can still report on it.
 *
 * Side effects:
 *  - UPDATE negotiation.status = 'stalled' (with concluded_at = now()).
 *  - INSERT negotiation_message(role=system, content=reason).
 */
const WalkAwayInputSchema = {
  supplierId: z
    .string()
    .min(1)
    .describe('The supplier id to walk away from.'),
  reason: z
    .string()
    .min(1)
    .describe('Short natural-language reason. Stored for audit.'),
};

export interface WalkAwayConfig {
  db: DB;
  negotiationIdBySupplier: ReadonlyMap<string, string>;
}

export function makeWalkAwayTool(config: WalkAwayConfig) {
  return tool(
    'walk_away_from',
    'Close a supplier negotiation as stalled. Their last offer remains ' +
      'in the comparison matrix but you stop engaging with them. Use ' +
      'when a supplier hit a hard limit you cannot accept.',
    WalkAwayInputSchema,
    async ({ supplierId, reason }) => {
      const negotiationId = config.negotiationIdBySupplier.get(supplierId);
      if (!negotiationId) {
        return {
          content: [
            {
              type: 'text',
              text: `unknown supplier id: ${supplierId}`,
            },
          ],
          isError: true,
        };
      }

      await config.db
        .update(negotiation)
        .set({
          status: 'stalled',
          concludedAt: sql`now()`,
        })
        .where(eq(negotiation.id, negotiationId));

      const next = await config.db.execute<{ max: number | null }>(
        sql`SELECT max(turn_index) AS max FROM negotiation_message WHERE negotiation_id = ${negotiationId}`,
      );
      const rows = (next as unknown as { rows: { max: number | null }[] }).rows;
      const nextTurnIndex = (rows[0]?.max ?? -1) + 1;

      await config.db.insert(negotiationMessage).values({
        negotiationId,
        role: 'system',
        turnIndex: nextTurnIndex,
        content: `Brand walked away from ${supplierId}: ${reason}`,
        offer: null,
        metadata: { eventType: 'brand_walked_away', supplierId, reason },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Closed negotiation with ${supplierId} as stalled.`,
          },
        ],
        structuredContent: {
          supplierId,
          status: 'stalled',
          reason,
        } as Record<string, unknown>,
      };
    },
    { annotations: { readOnlyHint: false, idempotentHint: true } },
  );
}
