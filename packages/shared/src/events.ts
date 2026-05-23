import { z } from 'zod';

/**
 * Inngest event catalog.
 *
 * Naming convention: `<domain>/<verb>` (e.g. `quotation/uploaded`).
 *
 * Philosophy:
 * - User-driven actions get specific events (`quotation.uploaded`,
 *   `purchase_order.requested`).
 * - Supplier-side activity is **canonical** as `supplier.message` — a
 *   free-form natural-language note from the supplier. The brand agent
 *   interprets it (extracts delta: price/lead/capacity/intent) and decides
 *   how to react. This mirrors real life: suppliers send emails, not typed
 *   structured events. Avoids inventing one event type per dimension.
 */

export const InngestEventNames = {
  QuotationUploaded: 'quotation/uploaded',
  SupplierMessage: 'supplier/message',
  PurchaseOrderRequested: 'purchase-order/requested',
} as const;
export type InngestEventName =
  (typeof InngestEventNames)[keyof typeof InngestEventNames];

// -------- Event payloads -----------------------------------------------------

/**
 * Emitted when the user uploads a supplier quotation file.
 */
export const QuotationUploadedEventSchema = z.object({
  quotationId: z.string().uuid(),
  brandId: z.string().min(1),
  sourceSupplierId: z.string().min(1),
  storageUri: z.string(),
  uploadedFilename: z.string(),
  userInstruction: z.string().nullable(),
});
export type QuotationUploadedEvent = z.infer<
  typeof QuotationUploadedEventSchema
>;

/**
 * Canonical inbound event from any supplier — covers all curveballs.
 *
 * `content` is the raw natural-language message the supplier sent.
 * Brand agent parses it to extract structured delta (which dimension(s)
 * changed) and decides whether to renegotiate, swap winner, etc.
 *
 * In the trial UI this is wired to a "Send supplier message" form.
 * In production, it would be wired to email/whatsapp ingestion.
 */
export const SupplierMessageEventSchema = z.object({
  quotationId: z.string().uuid(),
  supplierId: z.string().min(1),
  negotiationId: z.string().uuid().nullable(),
  content: z.string().min(1),
  receivedAt: z.string().datetime(),
});
export type SupplierMessageEvent = z.infer<typeof SupplierMessageEventSchema>;

/**
 * Emitted when the user clicks "Convert to PO" on the recommended
 * negotiation. Materializes a Purchase Order.
 */
export const PurchaseOrderRequestedEventSchema = z.object({
  quotationId: z.string().uuid(),
  negotiationId: z.string().uuid(),
  requestedBy: z.string(),
});
export type PurchaseOrderRequestedEvent = z.infer<
  typeof PurchaseOrderRequestedEventSchema
>;
