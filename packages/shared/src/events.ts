import { z } from 'zod';

/**
 * Inngest event names + payloads.
 *
 * Event names follow the convention `<domain>/<verb>.<state>` to keep the event
 * catalog navigable.
 */
export const QuotationUploadedEventSchema = z.object({
  quotationId: z.string().uuid(),
  filePath: z.string(),
  userInstruction: z.string().nullable(),
});
export type QuotationUploadedEvent = z.infer<typeof QuotationUploadedEventSchema>;

export const CurveballPayloadSchema = z.object({
  quotationId: z.string().uuid(),
  type: z.enum(['fulfillment_capacity_change', 'deadline_change', 'spec_change', 'custom']),
  description: z.string(),
  payload: z.record(z.unknown()),
});
export type CurveballPayload = z.infer<typeof CurveballPayloadSchema>;

export const InngestEventCatalog = {
  QuotationUploaded: 'quotation/uploaded',
  QuotationParsed: 'quotation/parsed',
  NegotiationCurveball: 'negotiation/curveball.sent',
  PurchaseOrderRequested: 'purchase-order/requested',
} as const;
export type InngestEventName = (typeof InngestEventCatalog)[keyof typeof InngestEventCatalog];
