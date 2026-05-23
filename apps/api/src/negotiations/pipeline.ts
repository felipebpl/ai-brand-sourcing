import { eq, sql } from 'drizzle-orm';
import type {
  BrandAgentPort,
  BrandProfile,
  EventBusPort,
  Recommendation,
  SupplierAgentPort,
  SupplierProfile,
  UserInstructionIntent,
} from '../domain';
import type { DB } from '../db';
import { negotiation, quotation, quotationLine, supplier } from '../db/schema';
import { ClaudeBrandAgentAdapter } from '../infra/agent-sdk/adapters/brand-agent.claude';
import { ClaudeSupplierAgentAdapter } from '../infra/agent-sdk/adapters/supplier-agent.claude';

/**
 * Negotiation pipeline — the orchestrator that wires everything for one
 * quotation's negotiation:
 *
 *   1. Load the quotation, items, supplier profiles, baseline, intent.
 *   2. Open one `negotiation` row per supplier (status: active).
 *   3. Build per-supplier `ClaudeSupplierAgentAdapter` instances and the
 *      brand `ClaudeBrandAgentAdapter` with the supplier map + neg ids
 *      injected.
 *   4. Invoke `brandAgent.negotiate(...)` — the brand drives multi-round
 *      dialogue via the brand MCP tools (ask_suppliers, walk_away,
 *      submit_recommendation).
 *   5. Persist the resulting Recommendation onto the quotation row
 *      (recommended_negotiation_id, recommendation_*, status=recommended).
 *
 * Idempotency: if the quotation is already at status='negotiating', this
 * function returns `skipped(already_in_flight)` instead of re-running.
 * If it's already past 'recommended', returns `skipped(already_done)`
 * unless `force=true`.
 */

export type RunNegotiationOutcome =
  | {
      kind: 'recommended';
      quotationId: string;
      recommendation: Recommendation;
      durationMs: number;
    }
  | {
      kind: 'skipped';
      quotationId: string;
      reason: 'already_in_flight' | 'already_recommended_or_beyond';
      currentStatus: string;
    }
  | {
      kind: 'failed';
      quotationId: string;
      error: string;
    };

export async function runNegotiation(args: {
  db: DB;
  eventBus: EventBusPort;
  brand: BrandProfile;
  quotationId: string;
  force?: boolean;
}): Promise<RunNegotiationOutcome> {
  const { db, eventBus, brand, quotationId, force = false } = args;

  const existing = await db
    .select({
      id: quotation.id,
      status: quotation.status,
      sourceSupplierId: quotation.sourceSupplierId,
      userInstruction: quotation.userInstruction,
      userInstructionIntent: quotation.userInstructionIntent,
      parsedMetadata: quotation.parsedMetadata,
    })
    .from(quotation)
    .where(eq(quotation.id, quotationId))
    .limit(1);
  const row = existing[0];
  if (!row) {
    return {
      kind: 'failed',
      quotationId,
      error: `Quotation ${quotationId} not found`,
    };
  }

  if (row.status === 'negotiating') {
    return {
      kind: 'skipped',
      quotationId,
      reason: 'already_in_flight',
      currentStatus: row.status,
    };
  }
  if (
    !force &&
    (row.status === 'recommended' || row.status === 'committed')
  ) {
    return {
      kind: 'skipped',
      quotationId,
      reason: 'already_recommended_or_beyond',
      currentStatus: row.status,
    };
  }

  // Pull items under negotiation (lowest tier only — multi-tier is
  // out of negotiation scope for now; brand will commit one volume).
  const lineRows = await db
    .select({
      productSku: quotationLine.matchedSku,
      description: quotationLine.rawDescription,
      quantity: quotationLine.minQty,
    })
    .from(quotationLine)
    .where(eq(quotationLine.quotationId, quotationId));
  const items: Array<{
    productSku: string;
    description: string | null;
    quantity: number;
  }> = [];
  for (const r of lineRows) {
    if (r.productSku === null) continue;
    items.push({
      productSku: r.productSku,
      description: r.description,
      quantity: Number(r.quantity),
    });
  }
  if (items.length === 0) {
    return {
      kind: 'failed',
      quotationId,
      error: 'Quotation has no matched line items to negotiate over',
    };
  }

  // Load all 3 supplier profiles.
  const supplierRows = await db.select().from(supplier);
  const supplierProfiles: SupplierProfile[] = supplierRows.map((s) => ({
    id: s.id,
    name: s.name,
    qualityScore: Number(s.qualityScore),
    defaultLeadTimeDays: s.defaultLeadTimeDays,
    defaultPaymentTermsDisplay:
      (s.defaultPaymentTerms as { display?: string } | null)?.display ?? 'TBD',
    pricingProfile: s.pricingProfile as 'cheap' | 'mid' | 'premium',
    reliabilityScore: s.reliabilityScore,
    onTimeDeliveryRate: s.onTimeDeliveryRate,
  }));

  if (supplierProfiles.length === 0) {
    return {
      kind: 'failed',
      quotationId,
      error: 'No suppliers seeded',
    };
  }

  // Compute the baseline (S1's quotation) from parsed_metadata + lines.
  const metadata =
    (row.parsedMetadata as Record<string, unknown> | null) ?? {};
  const baselineUnitAvg =
    lineRows.reduce((sum, l) => sum + Number(l.quantity) * 0, 0); // placeholder
  // Compute actual average from lines:
  const unitPriceRows = await db.execute<{ avg_unit_price: string }>(
    sql`SELECT (sum(unit_price * min_qty) / NULLIF(sum(min_qty),0))::numeric(14,4) AS avg_unit_price FROM quotation_line WHERE quotation_id = ${quotationId}`,
  );
  const computedRows =
    (unitPriceRows as unknown as { rows: { avg_unit_price: string | null }[] }).rows;
  const baselineAvgPrice = Number(
    computedRows[0]?.avg_unit_price ?? baselineUnitAvg,
  );
  const baseline = {
    unitPriceAvg: baselineAvgPrice,
    leadTimeDays:
      (typeof metadata.leadTimeDays === 'number' ? metadata.leadTimeDays : null) ??
      50,
    paymentTerms: {
      installments: [
        { percent: 33.33, dueDays: 0 },
        { percent: 33.33, dueDays: 30 },
        { percent: 33.34, dueDays: 60 },
      ],
      display:
        (typeof metadata.paymentTerms === 'string'
          ? metadata.paymentTerms
          : null) ?? '33/33/33',
    },
    currency:
      (metadata.currency as 'USD' | 'BRL' | 'EUR' | 'CNY' | 'GBP' | undefined) ??
      'USD',
    fulfillablePct: 1,
    notes: null,
  };

  const intent: UserInstructionIntent =
    (row.userInstructionIntent as UserInstructionIntent | null) ?? {
      priority: 'balanced',
      constraints: {},
    };

  // Open one negotiation row per supplier.
  const inserted = await db
    .insert(negotiation)
    .values(
      supplierProfiles.map((s) => ({
        quotationId,
        supplierId: s.id,
        status: 'active' as const,
      })),
    )
    .returning({ id: negotiation.id, supplierId: negotiation.supplierId });
  const negotiationIdBySupplier = new Map<string, string>();
  for (const r of inserted) {
    negotiationIdBySupplier.set(r.supplierId, r.id);
  }

  // Build supplier adapters.
  const supplierAdapters = new Map<string, SupplierAgentPort>();
  for (const profile of supplierProfiles) {
    supplierAdapters.set(
      profile.id,
      new ClaudeSupplierAgentAdapter({
        db,
        eventBus,
        profile,
        brand,
        defaultPaymentTermsDisplay: profile.defaultPaymentTermsDisplay,
      }),
    );
  }

  // Build brand adapter with supplier map injected.
  const brandAdapter: BrandAgentPort = new ClaudeBrandAgentAdapter({
    db,
    eventBus,
    supplierAdapters,
    negotiationIdBySupplier,
  });

  await db
    .update(quotation)
    .set({ status: 'negotiating', updatedAt: sql`now()` })
    .where(eq(quotation.id, quotationId));

  const start = Date.now();
  let recommendation: Recommendation;
  try {
    recommendation = await brandAdapter.negotiate({
      quotationId,
      brand,
      userInstruction: row.userInstruction,
      intent,
      suppliers: supplierProfiles,
      baseline,
      items,
    });
  } catch (err) {
    await db
      .update(quotation)
      .set({ status: 'failed', updatedAt: sql`now()` })
      .where(eq(quotation.id, quotationId));
    return {
      kind: 'failed',
      quotationId,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  await db
    .update(quotation)
    .set({
      recommendedNegotiationId: recommendation.negotiationId,
      recommendationReasoning: recommendation.reasoning,
      recommendationComparison: recommendation.comparison as unknown,
      recommendedAt: sql`now()`,
      status: 'recommended',
      updatedAt: sql`now()`,
    })
    .where(eq(quotation.id, quotationId));

  // Mark the winning negotiation 'concluded', leave others as-is for now
  // (some may be 'stalled' if brand walked away, others 'active' —
  // upstream cleanup can sweep on demand).
  await db
    .update(negotiation)
    .set({ status: 'concluded', concludedAt: sql`now()` })
    .where(eq(negotiation.id, recommendation.negotiationId));

  // Mark the source supplier name on the supplier row if it was a
  // placeholder (Quotation 2 has no supplier name; q1 'Thai Textiles').
  const supplierName = (metadata.supplierName as string | null) ?? null;
  if (supplierName && supplierName.length > 0) {
    await db
      .update(supplier)
      .set({ name: supplierName })
      .where(eq(supplier.id, row.sourceSupplierId));
  }

  return {
    kind: 'recommended',
    quotationId,
    recommendation,
    durationMs: Date.now() - start,
  };
}
