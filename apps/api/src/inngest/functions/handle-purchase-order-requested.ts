import { db } from '../../db';
import { materializePurchaseOrder } from '../../purchase-orders/materialize';
import { inngest } from '../client';

/**
 * `purchase-order/requested` handler — materializes a PO from a
 * quotation's current recommendation. Triggered by the UI's
 * "Convert to PO" button via the corresponding POST route.
 *
 * Idempotent at two levels: the materialize function itself short-
 * circuits if a PO already exists for the quotation, and Inngest's
 * own deduplication absorbs duplicate event deliveries.
 */
export const handlePurchaseOrderRequested = inngest.createFunction(
  {
    id: 'handle-purchase-order-requested',
    name: 'Materialize Purchase Order from recommendation',
    retries: 1,
    concurrency: { limit: 8 },
  },
  { event: 'purchase-order/requested' },
  async ({ event, step }) => {
    const { quotationId } = event.data;

    const outcome = await step.run('materialize-po', async () => {
      return materializePurchaseOrder({ db, quotationId });
    });

    return outcome;
  },
);
