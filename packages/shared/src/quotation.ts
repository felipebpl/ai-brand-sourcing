import { z } from 'zod';

export const CurrencySchema = z.enum(['BRL', 'USD', 'EUR']);
export type Currency = z.infer<typeof CurrencySchema>;

export const ParsedLineItemSchema = z.object({
  rawSku: z.string().nullable(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().nullable(),
  unitPrice: z.number().nonnegative(),
  lineTotal: z.number().nullable(),
  currency: CurrencySchema.default('USD'),
  notes: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type ParsedLineItem = z.infer<typeof ParsedLineItemSchema>;

export const QuotationTotalsSchema = z.object({
  subtotal: z.number().nullable(),
  discount: z.number().nullable(),
  freight: z.number().nullable(),
  taxes: z.number().nullable(),
  grandTotal: z.number().nullable(),
});
export type QuotationTotals = z.infer<typeof QuotationTotalsSchema>;

export const QuotationExtractionSchema = z.object({
  supplier: z.string().nullable(),
  quoteId: z.string().nullable(),
  issuedAt: z.string().nullable(),
  currency: CurrencySchema.default('USD'),
  lineItems: z.array(ParsedLineItemSchema),
  totals: QuotationTotalsSchema,
  ambiguities: z.array(z.object({ where: z.string(), reason: z.string() })),
});
export type QuotationExtraction = z.infer<typeof QuotationExtractionSchema>;

export const QuotationStatusSchema = z.enum([
  'uploaded',
  'parsing',
  'parsed',
  'matched',
  'negotiating',
  'awaiting_decision',
  'completed',
  'failed',
]);
export type QuotationStatus = z.infer<typeof QuotationStatusSchema>;
