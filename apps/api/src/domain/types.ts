/**
 * Domain types — re-exported from `@app/shared` for convenience, plus a few
 * domain-only types that don't cross the wire to the frontend.
 */

export type {
  Currency,
  QuotationStatus,
  UserInstructionIntent,
  QuotationExtraction,
  QuotationLineExtraction,
} from '@app/shared';

export type {
  SupplierId,
  PaymentTerms,
  NegotiationOffer,
  NegotiationMessage,
  NegotiationMessageRole,
  NegotiationStatus,
  NegotiationOutcomeMetrics,
  SupplierComparisonRow,
  Recommendation,
} from '@app/shared';

export type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
} from '@app/shared';

/**
 * Supplier profile as it appears to the brand agent's planning context.
 * Subset of the full DB row: only what's negotiation-relevant.
 */
export interface SupplierProfile {
  id: string;
  name: string;
  qualityScore: number;
  defaultLeadTimeDays: number;
  defaultPaymentTermsDisplay: string;
  pricingProfile: 'cheap' | 'mid' | 'premium';
  /** Optional, populated by future fulfillment modules. */
  reliabilityScore: number | null;
  onTimeDeliveryRate: number | null;
}

/**
 * Brand identity as it appears to the brand agent's system prompt.
 * Inferred at upload time (e.g. "Valden — premium outdoor technical apparel").
 */
export interface BrandProfile {
  id: string;
  name: string;
  positioningHypothesis: string;
}

/**
 * Lightweight catalog hit returned by the lookup_catalog tool.
 * Used by the parser agent during SKU resolution.
 */
export interface CatalogHit {
  sku: string;
  name: string;
  color: string | null;
  similarity: number;
}

/**
 * Top-level result of the parser stage: the typed quotation + an "intent"
 * structured projection extracted from the user's free-text instruction.
 */
export interface ParseResult {
  quotationId: string;
  extraction: import('@app/shared').QuotationExtraction;
  intent: import('@app/shared').UserInstructionIntent;
}
