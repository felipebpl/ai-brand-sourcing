import { z } from 'zod';

export const CurrencySchema = z.enum(['USD', 'BRL', 'EUR', 'CNY', 'GBP']);
export type Currency = z.infer<typeof CurrencySchema>;

export const QuotationStatusSchema = z.enum([
  'uploaded',
  'parsing',
  'parsed',
  'negotiating',
  'recommended',
  'committed',
  'cancelled',
  'failed',
]);
export type QuotationStatus = z.infer<typeof QuotationStatusSchema>;

/**
 * Brand sourcing priority — extracted by the brand agent from the user's
 * free-text instruction at upload. Drives weighting in winner selection.
 */
export const UserInstructionIntentSchema = z.object({
  priority: z.enum(['speed', 'cost', 'quality', 'balanced']).default('balanced'),
  constraints: z
    .object({
      maxLeadTimeDays: z.number().int().positive().nullable().optional(),
      maxUnitPrice: z.number().positive().nullable().optional(),
      minQualityScore: z.number().min(0).max(5).nullable().optional(),
      deadlineDate: z.string().datetime().nullable().optional(),
      preferredPaymentTerms: z.string().nullable().optional(),
    })
    .default({}),
});
export type UserInstructionIntent = z.infer<typeof UserInstructionIntentSchema>;

/**
 * Structured projection extracted by the parser agent from one supplier
 * quotation XLSX. Persisted denormalized in `quotation.parsed_metadata` and
 * exploded into `quotation_line` rows.
 */
export const QuotationLineExtractionSchema = z.object({
  rawSku: z.string().nullable(),
  rawDescription: z.string().nullable(),
  minQty: z.number().int().positive(),
  maxQty: z.number().int().positive().nullable(),
  unitPrice: z.number().nonnegative(),
  currency: CurrencySchema.default('USD'),
  matchedSku: z.string().nullable(),
  matchConfidence: z.number().min(0).max(1).nullable(),
  matchMethod: z
    .enum(['agent_exact', 'agent_fuzzy_inferred', 'agent_uncertain'])
    .nullable(),
  matchReasoning: z.string().nullable(),
  sourceRef: z
    .object({
      sheet: z.string(),
      row: z.number().int().nonnegative(),
      col: z.number().int().nonnegative(),
    })
    .nullable(),
  rawExtras: z.record(z.unknown()).nullable(),
});
export type QuotationLineExtraction = z.infer<
  typeof QuotationLineExtractionSchema
>;

export const QuotationExtractionSchema = z.object({
  supplierName: z.string().nullable(),
  quoteId: z.string().nullable(),
  issuedAt: z.string().nullable(),
  currency: CurrencySchema.default('USD'),
  leadTimeDays: z.number().int().positive().nullable(),
  paymentTerms: z.string().nullable(),
  language: z.string().nullable(),
  lines: z.array(QuotationLineExtractionSchema),
  ambiguities: z.array(
    z.object({ where: z.string(), reason: z.string() }),
  ),
});
export type QuotationExtraction = z.infer<typeof QuotationExtractionSchema>;
