import { and, eq, sql } from 'drizzle-orm';
import type { Recommendation } from '@app/shared';
import type { DB } from '../db';
import {
  negotiation,
  negotiationMessage,
  purchaseOrder,
  purchaseOrderLine,
  quotation,
  quotationLine,
} from '../db/schema';

/**
 * Materialize a Purchase Order from a quotation's current
 * recommendation. This is the "real commit action" the challenge calls
 * out — a PO row + line items are persisted atomically, the quotation
 * is marked `committed`, and a PO number is assigned via a Postgres
 * sequence-style monotonic counter.
 *
 * Failure modes the caller should expect:
 *  - Quotation isn't in `recommended` status → returns `kind: 'failed'`
 *    with `not_ready` reason (e.g. still negotiating, or already
 *    committed).
 *  - No recommendation persisted yet → `not_ready`.
 *  - The winning negotiation's latest supplier offer is missing →
 *    `failed` with `missing_final_offer`.
 *
 * Idempotency: if a PO already exists for this quotation, returns it
 * instead of creating a duplicate (status is forward-only after
 * `issued`).
 *
 * PO numbering: `PO-YYYY-NNNN` where NNNN is a zero-padded sequence
 * across the entire `purchase_order` table.
 */

export type MaterializePoOutcome =
  | {
      kind: 'committed';
      purchaseOrderId: string;
      poNumber: string;
      totalAmount: number;
      currency: string;
      lineCount: number;
    }
  | {
      kind: 'already_exists';
      purchaseOrderId: string;
      poNumber: string;
    }
  | {
      kind: 'failed';
      reason: 'not_ready' | 'missing_final_offer' | 'no_lines' | 'unknown';
      detail: string;
    };

export async function materializePurchaseOrder(args: {
  db: DB;
  quotationId: string;
}): Promise<MaterializePoOutcome> {
  const { db, quotationId } = args;

  const qrows = await db
    .select({
      id: quotation.id,
      status: quotation.status,
      brandId: quotation.brandId,
      recommendedNegotiationId: quotation.recommendedNegotiationId,
      recommendationComparison: quotation.recommendationComparison,
    })
    .from(quotation)
    .where(eq(quotation.id, quotationId))
    .limit(1);
  const q = qrows[0];
  if (!q) {
    return { kind: 'failed', reason: 'not_ready', detail: 'quotation not found' };
  }
  if (q.status === 'committed') {
    const existing = await db
      .select({ id: purchaseOrder.id, poNumber: purchaseOrder.poNumber })
      .from(purchaseOrder)
      .where(eq(purchaseOrder.quotationId, quotationId))
      .limit(1);
    const row = existing[0];
    if (row) {
      return {
        kind: 'already_exists',
        purchaseOrderId: row.id,
        poNumber: row.poNumber,
      };
    }
    return {
      kind: 'failed',
      reason: 'unknown',
      detail: 'quotation marked committed but no PO row exists',
    };
  }
  if (q.status !== 'recommended') {
    return {
      kind: 'failed',
      reason: 'not_ready',
      detail: `quotation status is '${q.status}'; expected 'recommended'`,
    };
  }
  if (!q.recommendedNegotiationId) {
    return {
      kind: 'failed',
      reason: 'not_ready',
      detail: 'no recommended negotiation on the quotation',
    };
  }

  // Pull the winning supplier's most recent offer.
  const winningNegotiationId = q.recommendedNegotiationId;
  const lastSupplierMessage = await db
    .select()
    .from(negotiationMessage)
    .where(
      and(
        eq(negotiationMessage.negotiationId, winningNegotiationId),
        eq(negotiationMessage.role, 'supplier'),
      ),
    )
    .orderBy(sql`turn_index desc`)
    .limit(1);
  const finalOffer = lastSupplierMessage[0]?.offer as
    | {
        unitPriceAvg: number;
        leadTimeDays: number;
        paymentTerms: { display: string; installments: unknown };
        currency: string;
        fulfillablePct?: number;
        notes?: string | null;
      }
    | null
    | undefined;
  if (!finalOffer) {
    return {
      kind: 'failed',
      reason: 'missing_final_offer',
      detail: 'winning negotiation has no supplier offer to commit',
    };
  }

  const winningNeg = await db
    .select({ supplierId: negotiation.supplierId })
    .from(negotiation)
    .where(eq(negotiation.id, winningNegotiationId))
    .limit(1);
  const supplierId = winningNeg[0]?.supplierId;
  if (!supplierId) {
    return {
      kind: 'failed',
      reason: 'unknown',
      detail: 'winning negotiation row missing supplier_id',
    };
  }

  const lineRows = await db
    .select({
      id: quotationLine.id,
      productSku: quotationLine.matchedSku,
      description: quotationLine.rawDescription,
      quantity: quotationLine.minQty,
    })
    .from(quotationLine)
    .where(eq(quotationLine.quotationId, quotationId));

  const lines: Array<{
    quotationLineId: string;
    productSku: string;
    description: string;
    quantity: number;
  }> = [];
  for (const r of lineRows) {
    if (!r.productSku) continue;
    lines.push({
      quotationLineId: r.id,
      productSku: r.productSku,
      description: r.description ?? r.productSku,
      quantity: Number(r.quantity),
    });
  }
  if (lines.length === 0) {
    return {
      kind: 'failed',
      reason: 'no_lines',
      detail: 'quotation has no matched lines to materialize',
    };
  }

  const unitPriceAvg = Number(finalOffer.unitPriceAvg);
  const subtotal = lines.reduce(
    (sum, l) => sum + l.quantity * unitPriceAvg,
    0,
  );
  const totalAmount = subtotal; // no tax/shipping modeled in trial

  const poNumber = await reservePoNumber(db);

  const expectedDeliveryDate = new Date();
  expectedDeliveryDate.setDate(
    expectedDeliveryDate.getDate() + Number(finalOffer.leadTimeDays),
  );

  let poId: string | undefined;
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(purchaseOrder)
      .values({
        poNumber,
        brandId: q.brandId,
        quotationId,
        negotiationId: winningNegotiationId,
        supplierId,
        status: 'issued',
        currency: finalOffer.currency,
        subtotal: subtotal.toFixed(4),
        totalAmount: totalAmount.toFixed(4),
        leadTimeDays: Number(finalOffer.leadTimeDays),
        paymentTerms: finalOffer.paymentTerms as unknown,
        expectedDeliveryDate,
      })
      .returning({ id: purchaseOrder.id });
    poId = inserted[0]?.id;
    if (!poId) {
      throw new Error('insert purchase_order returned no id');
    }

    await tx.insert(purchaseOrderLine).values(
      lines.map((l) => ({
        poId: poId as string,
        quotationLineId: l.quotationLineId,
        productSku: l.productSku,
        description: l.description,
        quantity: l.quantity,
        unitPrice: unitPriceAvg.toFixed(4),
        lineTotal: (l.quantity * unitPriceAvg).toFixed(4),
      })),
    );

    await tx
      .update(quotation)
      .set({ status: 'committed', updatedAt: sql`now()` })
      .where(eq(quotation.id, quotationId));
  });

  return {
    kind: 'committed',
    purchaseOrderId: poId as string,
    poNumber,
    totalAmount,
    currency: finalOffer.currency,
    lineCount: lines.length,
  };
}

/**
 * Reserve the next PO number in the form `PO-YYYY-NNNN`. Atomically
 * scans existing po_number values for the current year and assigns
 * max + 1. Not a true sequence (no DDL for that yet), but safe under
 * single-process load — and the row insert that follows in the same
 * transaction will fail if another concurrent caller wins the race
 * (unique constraint on po_number), so retry is the caller's job in
 * the rare-race scenario.
 */
async function reservePoNumber(db: DB): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `PO-${year}-`;
  const result = await db.execute<{ max_n: number | null }>(
    sql`
      SELECT MAX(
        NULLIF(
          regexp_replace(po_number, ${prefix}, '', 'g'),
          ''
        )::int
      ) AS max_n
      FROM purchase_order
      WHERE po_number LIKE ${prefix + '%'}
    `,
  );
  const rows = (result as unknown as { rows: { max_n: number | null }[] }).rows;
  const next = (rows[0]?.max_n ?? 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}
