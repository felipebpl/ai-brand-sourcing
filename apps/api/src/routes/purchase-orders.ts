import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { purchaseOrder, purchaseOrderLine, quotation } from '../db/schema';
import { inngest } from '../inngest/client';

/**
 * Purchase Order HTTP surface.
 *
 *   POST  /purchase-orders        convert a recommended quotation → PO
 *   GET   /purchase-orders        list all POs (most recent first)
 *   GET   /purchase-orders/{id}   full PO with line items
 *
 * The POST route validates state, fires `purchase-order/requested` via
 * Inngest, and returns 202. Materialization runs in `handle-purchase-order-requested`.
 * Client polls the PO list or detail to see the row appear.
 */

const router = new OpenAPIHono();

const ErrorSchema = z.object({
  error: z.string(),
  detail: z.string().optional(),
});

const PoStatusSchema = z.enum([
  'draft',
  'issued',
  'acknowledged',
  'fulfilled',
  'cancelled',
]);

const PurchaseOrderRowSchema = z.object({
  id: z.string().uuid(),
  poNumber: z.string(),
  brandId: z.string(),
  quotationId: z.string().uuid(),
  negotiationId: z.string().uuid(),
  supplierId: z.string(),
  status: PoStatusSchema,
  currency: z.string(),
  subtotal: z.string(),
  totalAmount: z.string(),
  leadTimeDays: z.number().int(),
  paymentTerms: z.unknown(),
  expectedDeliveryDate: z.string().nullable(),
  issuedAt: z.string(),
});

const PurchaseOrderLineRowSchema = z.object({
  id: z.string().uuid(),
  poId: z.string().uuid(),
  quotationLineId: z.string().uuid(),
  productSku: z.string(),
  description: z.string(),
  quantity: z.number().int(),
  unitPrice: z.string(),
  lineTotal: z.string(),
});

// -------- POST /purchase-orders --------------------------------------------

const createPoRoute = createRoute({
  method: 'post',
  path: '/purchase-orders',
  tags: ['Purchase Orders'],
  summary: 'Convert a recommended quotation into a Purchase Order',
  description:
    'Fires `purchase-order/requested` via Inngest. The PO row materializes ' +
    'asynchronously in the corresponding handler; poll GET /purchase-orders ' +
    'to see it appear. Requires the quotation to be in `recommended` status.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ quotationId: z.string().uuid() }),
        },
      },
    },
  },
  responses: {
    202: {
      description: 'Request accepted; materialization enqueued',
      content: {
        'application/json': {
          schema: z.object({
            accepted: z.boolean(),
            quotationId: z.string().uuid(),
          }),
        },
      },
    },
    400: {
      description: 'Missing or malformed body',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Quotation not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Quotation not ready for PO conversion',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    503: {
      description: 'Inngest enqueue failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

router.openapi(createPoRoute, async (c) => {
  const body = await c.req.json().catch(() => null);
  const quotationId = (body?.quotationId as string | undefined) ?? null;
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
    return c.json({ error: 'no recommendation persisted yet' }, 409);
  }

  try {
    await inngest.send({
      name: 'purchase-order/requested',
      data: {
        quotationId,
        negotiationId: q.recommendedNegotiationId,
        requestedBy: 'ui',
      },
    });
  } catch (err) {
    return c.json(
      {
        error: 'failed to enqueue purchase order materialization',
        detail: err instanceof Error ? err.message : String(err),
      },
      503,
    );
  }

  return c.json({ accepted: true, quotationId }, 202);
});

// -------- GET /purchase-orders ---------------------------------------------

const listPoRoute = createRoute({
  method: 'get',
  path: '/purchase-orders',
  tags: ['Purchase Orders'],
  summary: 'List all purchase orders, most recent first',
  responses: {
    200: {
      description: 'Array of purchase orders',
      content: {
        'application/json': {
          schema: z.object({ purchaseOrders: z.array(PurchaseOrderRowSchema) }),
        },
      },
    },
  },
});

router.openapi(listPoRoute, async (c) => {
  const rows = await db
    .select()
    .from(purchaseOrder)
    .orderBy(desc(purchaseOrder.issuedAt));
  const payload = {
    purchaseOrders: rows.map((p) => ({
      ...p,
      expectedDeliveryDate: p.expectedDeliveryDate?.toISOString() ?? null,
      issuedAt: p.issuedAt.toISOString(),
    })),
  };
  return c.json(payload as never);
});

// -------- GET /purchase-orders/{id} ----------------------------------------

const getPoRoute = createRoute({
  method: 'get',
  path: '/purchase-orders/{id}',
  tags: ['Purchase Orders'],
  summary: 'Full PO detail with line items',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Purchase order detail',
      content: {
        'application/json': {
          schema: z.object({
            purchaseOrder: PurchaseOrderRowSchema,
            lines: z.array(PurchaseOrderLineRowSchema),
          }),
        },
      },
    },
    404: {
      description: 'Purchase order not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

router.openapi(getPoRoute, async (c) => {
  const { id } = c.req.valid('param');
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
  const payload = {
    purchaseOrder: {
      ...po,
      expectedDeliveryDate: po.expectedDeliveryDate?.toISOString() ?? null,
      issuedAt: po.issuedAt.toISOString(),
    },
    lines,
  };
  return c.json(payload as never);
});

export { router as purchaseOrdersRouter };
