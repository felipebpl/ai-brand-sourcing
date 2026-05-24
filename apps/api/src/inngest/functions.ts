import { handleQuotationUploaded } from './functions/handle-quotation-uploaded';
import { handlePurchaseOrderRequested } from './functions/handle-purchase-order-requested';

/**
 * Inngest function registry.
 *
 * Two user-driven handlers are wired: parse-and-negotiate on upload, and
 * PO materialization on commit. The `supplier/message` event type stays
 * declared in the typed schema for forward compatibility, but the
 * curveball flow for this trial is handled intra-negotiation via the
 * supplier-2 persona reveal (see `prompts/supplier-persona.ts`) — no
 * external `handle.supplier-message` function is needed.
 */
export const functions = [
  handleQuotationUploaded,
  handlePurchaseOrderRequested,
] as const;
