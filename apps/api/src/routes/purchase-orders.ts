import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { purchaseOrder, purchaseOrderLine, quotation } from '../db/schema';
import { inngest } from '../inngest/client';

/**
 * Routes:
 *   POST  /purchase-orders            convert a quotation's recommendation → PO
 *   GET   /purchase-orders            list all POs (most recent first)
 *   GET   /purchase-orders/:id        full PO with line items
 *
 * The POST route fires the Inngest event and returns immediately. The
 * actual materialization runs in `handle-purchase-order-requested`.
 * Client polls or subscribes to know when the PO row appears.
 */
const router = new Hono();

router.post('/purchase-orders', async (c) => {
  const body = await c.req.json().catch(() => null);
  const quotationId = body?.quotationId as string | undefined;
  if (!quotationId) {
    return c.json({ error: 'body.quotationId is required' }, 400);
  }

  const qrows = await db
    .select({
      id: quotation.id,
      status: quotation.status,
      recommendedNegotiationId: quotation.recommendedNegotiationId,
    })
    .from(quotation)
    .where(eq(quotation.id, quotationId))
    .limit(1);
  const q = qrows[0];
  if (!q) return c.json({ error: 'quotation not found' }, 404);
  if (q.status !== 'recommended') {
    return c.json(
      {
        error: 'quotation not ready',
        detail: `status is '${q.status}'; expected 'recommended'`,
      },
      409,
    );
  }
  if (!q.recommendedNegotiationId) {
    return c.json(
      { error: 'no recommendation persisted yet' },
      409,
    );
  }

  await inngest.send({
    name: 'purchase-order/requested',
    data: {
      quotationId,
      negotiationId: q.recommendedNegotiationId,
      requestedBy: 'ui',
    },
  });

  return c.json({ accepted: true, quotationId }, 202);
});

router.get('/purchase-orders', async (c) => {
  const rows = await db
    .select()
    .from(purchaseOrder)
    .orderBy(desc(purchaseOrder.issuedAt));
  return c.json({ purchaseOrders: rows });
});

router.get('/purchase-orders/:id', async (c) => {
  const id = c.req.param('id');
  const rows = await db
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.id, id))
    .limit(1);
  const po = rows[0];
  if (!po) return c.json({ error: 'not found' }, 404);
  const lines = await db
    .select()
    .from(purchaseOrderLine)
    .where(eq(purchaseOrderLine.poId, id));
  return c.json({ purchaseOrder: po, lines });
});

export { router as purchaseOrdersRouter };
