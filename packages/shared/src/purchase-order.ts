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

export const PurchaseOrderLineItemSchema = z.object({
  productSku: z.string(),
  description: z.string(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  lineTotal: z.number().nonnegative(),
});
export type PurchaseOrderLineItem = z.infer<typeof PurchaseOrderLineItemSchema>;

export const PurchaseOrderSchema = z.object({
  id: z.string().uuid(),
  poNumber: z.string(),
  supplierId: SupplierIdSchema,
  negotiationId: z.string().uuid(),
  quotationId: z.string().uuid(),
  status: PurchaseOrderStatusSchema,
  currency: CurrencySchema,
  lineItems: z.array(PurchaseOrderLineItemSchema),
  subtotal: z.number().nonnegative(),
  totalAmount: z.number().nonnegative(),
  leadTimeDays: z.number().int().nonnegative(),
  paymentTerms: PaymentTermsSchema,
  issuedAt: z.string().datetime(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;
