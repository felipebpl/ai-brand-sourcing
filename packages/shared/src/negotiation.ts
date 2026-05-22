import { z } from 'zod';
import { CurrencySchema } from './quotation';

export const SupplierIdSchema = z.string().min(1);
export type SupplierId = z.infer<typeof SupplierIdSchema>;

export const PaymentTermsSchema = z.object({
  installments: z.array(z.object({ percent: z.number(), dueDays: z.number() })),
  display: z.string(),
});
export type PaymentTerms = z.infer<typeof PaymentTermsSchema>;

export const NegotiationOfferSchema = z.object({
  productSku: z.string(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  leadTimeDays: z.number().int().nonnegative(),
  paymentTerms: PaymentTermsSchema,
  currency: CurrencySchema,
  fulfillablePercent: z.number().min(0).max(1).default(1),
  validUntil: z.string().nullable(),
});
export type NegotiationOffer = z.infer<typeof NegotiationOfferSchema>;

export const NegotiationMessageRoleSchema = z.enum(['brand', 'supplier', 'system']);
export type NegotiationMessageRole = z.infer<typeof NegotiationMessageRoleSchema>;

export const NegotiationMessageSchema = z.object({
  id: z.string().uuid(),
  negotiationId: z.string().uuid(),
  role: NegotiationMessageRoleSchema,
  content: z.string(),
  offer: NegotiationOfferSchema.nullable(),
  turn: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type NegotiationMessage = z.infer<typeof NegotiationMessageSchema>;

export const NegotiationStatusSchema = z.enum([
  'pending',
  'in_progress',
  'awaiting_curveball',
  'concluded',
  'failed',
]);
export type NegotiationStatus = z.infer<typeof NegotiationStatusSchema>;

export const NegotiationOutcomeSchema = z.object({
  negotiationId: z.string().uuid(),
  supplierId: SupplierIdSchema,
  finalOffer: NegotiationOfferSchema,
  rationale: z.string(),
  qualityScore: z.number().min(0).max(5),
  totalCost: z.number().nonnegative(),
});
export type NegotiationOutcome = z.infer<typeof NegotiationOutcomeSchema>;

export const WinnerSelectionSchema = z.object({
  primary: NegotiationOutcomeSchema,
  splitWith: z.array(NegotiationOutcomeSchema).default([]),
  reasoning: z.string(),
  tradeoffs: z.array(z.string()),
});
export type WinnerSelection = z.infer<typeof WinnerSelectionSchema>;
