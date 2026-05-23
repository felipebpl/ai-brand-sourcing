import { z } from 'zod';
import { CurrencySchema } from './quotation';
import { PaymentTermsSchema, SupplierIdSchema } from './negotiation';

export const PurchaseOrderStatusSchema = z.enum([
  'draft',
  'issued',
  'acknowledged',
  'fulfilled',
  'cancelled',
]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatusSchema>;

export const PurchaseOrderLineSchema = z.object({
  id: z.string().uuid(),
  quotationLineId: z.string().uuid(),
  productSku: z.string(),
  description: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  lineTotal: z.number().nonnegative(),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;

export const PurchaseOrderSchema = z.object({
  id: z.string().uuid(),
  poNumber: z.string(),
  brandId: z.string(),
  supplierId: SupplierIdSchema,
  quotationId: z.string().uuid(),
  negotiationId: z.string().uuid(),
  status: PurchaseOrderStatusSchema,
  currency: CurrencySchema,
  lines: z.array(PurchaseOrderLineSchema),
  subtotal: z.number().nonnegative(),
  totalAmount: z.number().nonnegative(),
  leadTimeDays: z.number().int().nonnegative(),
  paymentTerms: PaymentTermsSchema,
  expectedDeliveryDate: z.string().datetime().nullable(),
  issuedAt: z.string().datetime(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;
