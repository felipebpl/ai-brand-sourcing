import { EventSchemas, Inngest } from 'inngest';
import type {
  CurveballPayload,
  ParsedLineItem,
  QuotationUploadedEvent,
} from '@app/shared';

type Events = {
  'quotation/uploaded': { data: QuotationUploadedEvent };
  'quotation/parsed': { data: { quotationId: string; items: ParsedLineItem[] } };
  'negotiation/curveball.sent': { data: CurveballPayload };
  'purchase-order/requested': {
    data: { quotationId: string; negotiationId: string };
  };
};

export const inngest = new Inngest({
  id: 'ai-brand-sourcing',
  schemas: new EventSchemas().fromRecord<Events>(),
  isDev: process.env.NODE_ENV !== 'production',
});
