import { z } from 'zod';
import { CurrencySchema } from './quotation';

export const SupplierIdSchema = z.string().min(1);
export type SupplierId = z.infer<typeof SupplierIdSchema>;

/**
 * Payment terms — `installments` is the canonical, structured form.
 * `display` is a human-readable fallback (e.g. "40/60", "Net 30",
 * "30/30/30/10 over 90 days") for the cases where the structured form
 * does not fit.
 */
export const PaymentTermsSchema = z.object({
  installments: z.array(
    z.object({ percent: z.number().min(0).max(100), dueDays: z.number().int() }),
  ),
  display: z.string(),
});
export type PaymentTerms = z.infer<typeof PaymentTermsSchema>;

/**
 * An offer is a structured proposal carried by a single NegotiationMessage.
 * Both brand and supplier emit Offer-shaped payloads. The orchestrator
 * persists the latest non-null offer as the "current state" of the
 * negotiation.
 */
export const NegotiationOfferSchema = z.object({
  unitPriceAvg: z.number().nonnegative(),
  leadTimeDays: z.number().int().nonnegative(),
  paymentTerms: PaymentTermsSchema,
  currency: CurrencySchema,
  fulfillablePct: z.number().min(0).max(1).default(1),
  notes: z.string().nullable(),
});
export type NegotiationOffer = z.infer<typeof NegotiationOfferSchema>;

/**
 * Baseline derived from the source supplier's parsed quotation. Unlike
 * a NegotiationOffer (which is always a complete offer made by an agent),
 * a baseline may have null lead time or payment terms when the supplier's
 * file did not include them. The brand prompt renders nulls explicitly
 * as "(not specified by supplier)" so the agent can reason about the gap
 * instead of negotiating against fake values.
 */
export const BaselineOfferSchema = z.object({
  unitPriceAvg: z.number().nonnegative(),
  leadTimeDays: z.number().int().nonnegative().nullable(),
  paymentTermsDisplay: z.string().nullable(),
  currency: CurrencySchema,
});
export type BaselineOffer = z.infer<typeof BaselineOfferSchema>;

export const NegotiationMessageRoleSchema = z.enum([
  'brand',
  'supplier',
  'system',
]);
export type NegotiationMessageRole = z.infer<
  typeof NegotiationMessageRoleSchema
>;

export const NegotiationMessageSchema = z.object({
  id: z.string().uuid(),
  negotiationId: z.string().uuid(),
  role: NegotiationMessageRoleSchema,
  turnIndex: z.number().int().nonnegative(),
  content: z.string(),
  offer: NegotiationOfferSchema.nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type NegotiationMessage = z.infer<typeof NegotiationMessageSchema>;

export const NegotiationStatusSchema = z.enum([
  'pending',
  'active',
  'concluded',
  'stalled',
  'failed',
]);
export type NegotiationStatus = z.infer<typeof NegotiationStatusSchema>;

/**
 * Denormalized outcome metrics computed when a negotiation concludes.
 * These exist to make ML training data straightforward — query analytics
 * directly off the negotiation row, no message replay required.
 */
export const NegotiationOutcomeMetricsSchema = z.object({
  finalUnitPriceAvg: z.number().nonnegative().nullable(),
  finalLeadTimeDays: z.number().int().nonnegative().nullable(),
  finalPaymentTerms: PaymentTermsSchema.nullable(),
  roundsCount: z.number().int().nonnegative(),
  priceConcessionPct: z.number().nullable(),
  negotiationDurationSeconds: z.number().int().nonnegative().nullable(),
  winningDimensions: z.array(z.string()),
});
export type NegotiationOutcomeMetrics = z.infer<
  typeof NegotiationOutcomeMetricsSchema
>;

/**
 * Per-supplier comparison row — one slice of the brand agent's reasoning
 * across the 4 negotiations.
 */
export const SupplierComparisonRowSchema = z.object({
  supplierId: SupplierIdSchema,
  negotiationId: z.string().uuid(),
  unitPriceAvg: z.number().nonnegative(),
  leadTimeDays: z.number().int().nonnegative(),
  paymentTerms: PaymentTermsSchema,
  qualityScore: z.number().min(0).max(5),
  fulfillablePct: z.number().min(0).max(1),
  totalCost: z.number().nonnegative(),
  winsOn: z.array(z.string()),
});
export type SupplierComparisonRow = z.infer<typeof SupplierComparisonRowSchema>;

/**
 * Snapshot of the brand agent's recommendation, embedded in the Quotation
 * row. History of prior recommendations (curveball replans) lives in
 * `quotation.recommendation_history` JSONB array.
 */
export const RecommendationSchema = z.object({
  negotiationId: z.string().uuid(),
  supplierId: SupplierIdSchema,
  reasoning: z.string(),
  comparison: z.array(SupplierComparisonRowSchema),
  decidedAt: z.string().datetime(),
  supersededReason: z.string().nullable(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;
