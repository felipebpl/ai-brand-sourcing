import { EventSchemas, Inngest } from 'inngest';
import type {
  QuotationUploadedEvent,
  SupplierMessageEvent,
  PurchaseOrderRequestedEvent,
} from '@app/shared';

/**
 * Inngest event-typed catalog.
 *
 * Three events drive the system. Two are user-driven specific payloads;
 * `supplier/message` is the canonical free-form inbound channel for any
 * supplier-side activity (including curveballs).
 */
type Events = {
  'quotation/uploaded': { data: QuotationUploadedEvent };
  'supplier/message': { data: SupplierMessageEvent };
  'purchase-order/requested': { data: PurchaseOrderRequestedEvent };
};

export const inngest = new Inngest({
  id: 'ai-brand-sourcing',
  schemas: new EventSchemas().fromRecord<Events>(),
  isDev: process.env.NODE_ENV !== 'production',
});
