import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type {
  NegotiationOffer,
  SupplierAgentPort,
  SupplierAgentResponse,
} from '../../../domain';
import type { DB } from '../../../db';
import { negotiationMessage } from '../../../db/schema';
import { rawRows } from '../../../db/raw';

/**
 * `ask_suppliers` MCP tool — the brand agent's main lever.
 *
 * Takes an array of asks (1 per supplier the brand wants to engage this
 * round). Persists each as a `negotiation_message(role=brand)` row,
 * fires the corresponding `SupplierAgentPort.respond()` in PARALLEL via
 * `Promise.all`, then returns the structured responses for the brand
 * to reason over.
 *
 * Why a single tool (not per-supplier tools):
 *  - One round = one logical action in the brand's mental model. Three
 *    sub-tool calls back-to-back would create three "turns" in the
 *    agent loop and waste tokens. A single call returns all responses
 *    together, matching how the brand thinks ("here's what each said").
 *  - Parallelism is automatic and the brand doesn't pay a wall-clock
 *    cost for negotiating with 3 suppliers vs 1.
 */
const AskSuppliersInputSchema = {
  asks: z
    .array(
      z.object({
        supplierId: z.string().describe('The supplier to engage.'),
        message: z
          .string()
          .min(1)
          .describe('Natural-language ask, 1–3 sentences.'),
        brandAsk: z
          .object({
            unitPriceAvg: z.number().nonnegative(),
            leadTimeDays: z.number().int().nonnegative(),
            paymentTerms: z.object({
              installments: z.array(
                z.object({
                  percent: z.number().min(0).max(100),
                  dueDays: z.number().int(),
                }),
              ),
              display: z.string(),
            }),
            currency: z.enum(['USD', 'BRL', 'EUR', 'CNY', 'GBP']),
            fulfillablePct: z.number().min(0).max(1).default(1),
            notes: z.string().nullable().default(null),
          })
          .nullable()
          .optional()
          .describe(
            'Optional structured proposal alongside the message. Use when ' +
              'attaching a concrete counter; omit for clarifications.',
          ),
      }),
    )
    .min(1),
};

interface SupplierContext {
  adapter: SupplierAgentPort;
  negotiationId: string;
  quotedItems: ReadonlyArray<{
    productSku: string;
    description: string | null;
    quantity: number;
  }>;
}

export interface AskSuppliersConfig {
  db: DB;
  /**
   * The quotation under which all suppliers are being engaged. Propagated
   * to each supplier's `respond` call so live trace events route to the
   * correct SSE subscriber on the frontend.
   */
  quotationId: string;
  /**
   * Resolves a supplierId to the adapter + negotiationId + the items the
   * brand passed in. Throws if the supplierId is unknown (brand asked
   * a non-existent supplier).
   */
  suppliers: ReadonlyMap<string, SupplierContext>;
}

interface SupplierResult {
  supplierId: string;
  response: SupplierAgentResponse;
}

export function makeAskSuppliersTool(config: AskSuppliersConfig) {
  return tool(
    'ask_suppliers',
    'Send one or more asks to suppliers in parallel. Each ask is a ' +
      '(supplierId, message, optional brandAsk) tuple. Persists brand ' +
      'messages, calls each supplier in parallel, returns their ' +
      'responses for evaluation.',
    AskSuppliersInputSchema,
    async ({ asks }) => {
      const results: SupplierResult[] = [];
      const errors: { supplierId: string; reason: string }[] = [];

      // 1) Persist brand outbound messages first (turn_index sequential
      //    per negotiation), in one go per supplier.
      await Promise.all(
        asks.map(async (ask) => {
          const ctx = config.suppliers.get(ask.supplierId);
          if (!ctx) {
            errors.push({
              supplierId: ask.supplierId,
              reason: `unknown supplier id`,
            });
            return;
          }

          const nextTurnIndex = await reserveNextTurn(
            config.db,
            ctx.negotiationId,
          );

          await config.db.insert(negotiationMessage).values({
            negotiationId: ctx.negotiationId,
            role: 'brand',
            turnIndex: nextTurnIndex,
            content: ask.message,
            offer: (ask.brandAsk ?? null) as unknown,
            metadata: { modelInUse: 'opus-4-7', costUsd: 0 },
          });
        }),
      );

      // 2) Fire supplier adapters in parallel.
      await Promise.all(
        asks.map(async (ask) => {
          const ctx = config.suppliers.get(ask.supplierId);
          if (!ctx) return;

          try {
            const brandTurn = await getLastTurnIndex(
              config.db,
              ctx.negotiationId,
            );
            const response = await ctx.adapter.respond({
              quotationId: config.quotationId,
              negotiationId: ctx.negotiationId,
              brandMessage: ask.message,
              brandAsk: (ask.brandAsk ?? null) as NegotiationOffer | null,
              quotedItems: ctx.quotedItems,
              turnIndex: brandTurn + 1,
            });
            results.push({ supplierId: ask.supplierId, response });
          } catch (err) {
            errors.push({
              supplierId: ask.supplierId,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }),
      );

      const payload = { results, errors };
      return {
        content: [
          { type: 'text', text: JSON.stringify(payload, null, 2) },
        ],
        structuredContent: payload as unknown as Record<string, unknown>,
        isError: errors.length > 0 && results.length === 0,
      };
    },
    { annotations: { readOnlyHint: false, idempotentHint: false } },
  );
}

async function reserveNextTurn(
  db: DB,
  negotiationId: string,
): Promise<number> {
  const rows = await rawRows<{ max: number | null }>(
    db,
    sql`SELECT max(turn_index) AS max FROM negotiation_message WHERE negotiation_id = ${negotiationId}`,
  );
  const current = rows[0]?.max ?? -1;
  return current + 1;
}

async function getLastTurnIndex(
  db: DB,
  negotiationId: string,
): Promise<number> {
  const rows = await rawRows<{ max: number | null }>(
    db,
    sql`SELECT max(turn_index) AS max FROM negotiation_message WHERE negotiation_id = ${negotiationId}`,
  );
  return rows[0]?.max ?? 0;
}

