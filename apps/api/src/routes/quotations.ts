import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { asc, desc, eq } from 'drizzle-orm';
import {
  CurrencySchema,
  QuotationStatusSchema,
} from '@app/shared';
import { db } from '../db';
import {
  negotiation,
  negotiationMessage,
  quotation,
  quotationLine,
} from '../db/schema';
import { eventBus } from '../infra/agent-sdk/event-bus';
import { inngest } from '../inngest/client';
import { saveUpload } from '../storage/file-storage';

/**
 * Quotation HTTP surface.
 *
 *   POST   /rfqs                       create empty RFQ awaiting a quote
 *   POST   /quotations/:id/quote       attach supplier file to existing RFQ (multipart)
 *   POST   /quotations                 legacy create-and-upload in one step (multipart)
 *   GET    /quotations                 list with status + recommendation summary
 *   GET    /quotations/:id             full detail (lines, negotiations, messages)
 *   GET    /quotations/:id/stream      SSE consuming the eventBus
 *
 * Async work (parsing, negotiation) is driven by `handle-quotation-uploaded`
 * via Inngest. Clients poll `GET /quotations/:id` or subscribe to
 * `/quotations/:id/stream` for progress.
 */

const router = new OpenAPIHono();

// -------- shared schemas ----------------------------------------------------

const ErrorSchema = z.object({
  error: z.string(),
  detail: z.string().optional(),
});

const QuotationIdResponseSchema = z.object({
  quotationId: z.string().uuid(),
  status: QuotationStatusSchema,
});

const QuotationSummarySchema = z.object({
  id: z.string().uuid(),
  status: QuotationStatusSchema,
  uploadedFilename: z.string().nullable(),
  userInstruction: z.string().nullable(),
  sourceSupplierId: z.string(),
  recommendedNegotiationId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const QuotationLineSchema = z.object({
  id: z.string().uuid(),
  quotationId: z.string().uuid(),
  rawSku: z.string().nullable(),
  rawDescription: z.string().nullable(),
  minQty: z.number().int(),
  maxQty: z.number().int().nullable(),
  unitPrice: z.string(),
  currency: z.string(),
  matchedSku: z.string().nullable(),
  matchConfidence: z.string().nullable(),
  matchMethod: z.string().nullable(),
  matchReasoning: z.string().nullable(),
  sourceRef: z.unknown().nullable(),
  rawExtras: z.unknown().nullable(),
});

const NegotiationMessageOutSchema = z.object({
  id: z.string().uuid(),
  negotiationId: z.string().uuid(),
  role: z.enum(['brand', 'supplier', 'system']),
  turnIndex: z.number().int(),
  content: z.string(),
  offer: z.unknown().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
});

const NegotiationOutSchema = z.object({
  id: z.string().uuid(),
  quotationId: z.string().uuid(),
  supplierId: z.string(),
  status: z.enum(['pending', 'active', 'concluded', 'stalled', 'failed']),
  finalUnitPriceAvg: z.string().nullable(),
  finalLeadTimeDays: z.number().int().nullable(),
  finalPaymentTerms: z.unknown().nullable(),
  roundsCount: z.number().int(),
  priceConcessionPct: z.number().nullable(),
  negotiationDurationSeconds: z.number().int().nullable(),
  winningDimensions: z.array(z.string()).nullable(),
  createdAt: z.string(),
  concludedAt: z.string().nullable(),
  messages: z.array(NegotiationMessageOutSchema),
});

const QuotationFullSchema = z.object({
  quotation: z.object({
    id: z.string().uuid(),
    brandId: z.string(),
    sourceSupplierId: z.string(),
    uploadedFilename: z.string().nullable(),
    storageUri: z.string().nullable(),
    userInstruction: z.string().nullable(),
    userInstructionIntent: z.unknown().nullable(),
    parsedMetadata: z.unknown().nullable(),
    status: QuotationStatusSchema,
    recommendedNegotiationId: z.string().uuid().nullable(),
    recommendationReasoning: z.string().nullable(),
    recommendationComparison: z.unknown().nullable(),
    recommendedAt: z.string().nullable(),
    recommendationHistory: z.unknown(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  lines: z.array(QuotationLineSchema),
  negotiations: z.array(NegotiationOutSchema),
});

// Multipart upload schemas are declared loosely because @hono/zod-openapi
// validates multipart bodies via standard parsing — the runtime check for
// the `file` field happens inline (File instance check) since the OpenAPI
// schema can only describe the contract, not enforce a JS File type.
const UploadMultipartSchema = z.object({
  file: z.unknown().describe('Supplier quotation file (XLSX, binary)'),
  userInstruction: z
    .string()
    .optional()
    .describe('Free-text sourcing instruction from the user.'),
});

// -------- POST /rfqs --------------------------------------------------------

const createRfqRoute = createRoute({
  method: 'post',
  path: '/rfqs',
  tags: ['Quotations'],
  summary: 'Create an empty RFQ awaiting a supplier quote',
  description:
    'Returns the new quotation id. Use POST /quotations/:id/quote to ' +
    'attach the supplier spreadsheet later — that route triggers parsing.',
  responses: {
    201: {
      description: 'RFQ created',
      content: { 'application/json': { schema: QuotationIdResponseSchema } },
    },
    500: {
      description: 'Insert failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

router.openapi(createRfqRoute, async (c) => {
  const sourceSupplierId = 'supplier-1';
  const brandId = 'valden';

  const inserted = await db
    .insert(quotation)
    .values({
      brandId,
      sourceSupplierId,
      uploadedFilename: null,
      storageUri: null,
      status: 'awaiting_quote',
    })
    .returning({ id: quotation.id });
  const quotationId = inserted[0]?.id;
  if (!quotationId) {
    return c.json({ error: 'failed to insert quotation row' }, 500);
  }
  return c.json({ quotationId, status: 'awaiting_quote' as const }, 201);
});

// -------- POST /quotations/:id/quote (multipart) ---------------------------

const attachQuoteRoute = createRoute({
  method: 'post',
  path: '/quotations/{id}/quote',
  tags: ['Quotations'],
  summary: 'Attach a supplier quotation file to an existing awaiting RFQ',
  description:
    "Transitions the RFQ into 'uploaded' and fires the same Inngest event " +
    'the legacy POST /quotations route does. The parser pipeline downstream ' +
    'is unchanged.',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'multipart/form-data': { schema: UploadMultipartSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'File attached, parser enqueued',
      content: { 'application/json': { schema: QuotationIdResponseSchema } },
    },
    400: { description: 'Missing file', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'RFQ not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'RFQ already has a quote', content: { 'application/json': { schema: ErrorSchema } } },
    503: { description: 'Inngest enqueue failed', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

router.openapi(attachQuoteRoute, async (c) => {
  const { id } = c.req.valid('param');
  const existing = await db
    .select()
    .from(quotation)
    .where(eq(quotation.id, id))
    .limit(1);
  const q = existing[0];
  if (!q) return c.json({ error: 'rfq not found' }, 404);
  if (q.status !== 'awaiting_quote') {
    return c.json(
      {
        error: 'rfq already has a quote',
        detail: `status is '${q.status}'; expected 'awaiting_quote'`,
      },
      409,
    );
  }

  const form = await c.req.formData();
  const file = form.get('file');
  const userInstruction = form.get('userInstruction');
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'multipart field "file" is required' }, 400);
  }
  const filename = file.name || 'upload.xlsx';
  const bytes = await file.arrayBuffer();
  const saved = await saveUpload({ filename, bytes });

  const cleanInstruction =
    typeof userInstruction === 'string' && userInstruction.length > 0
      ? userInstruction
      : null;

  await db
    .update(quotation)
    .set({
      uploadedFilename: saved.uploadedFilename,
      storageUri: saved.storageUri,
      userInstruction: cleanInstruction,
      status: 'uploaded',
    })
    .where(eq(quotation.id, id));

  try {
    await inngest.send({
      name: 'quotation/uploaded',
      data: {
        quotationId: id,
        brandId: q.brandId,
        sourceSupplierId: q.sourceSupplierId,
        storageUri: saved.storageUri,
        uploadedFilename: saved.uploadedFilename,
        userInstruction: cleanInstruction,
      },
    });
  } catch (err) {
    await db
      .update(quotation)
      .set({
        uploadedFilename: null,
        storageUri: null,
        userInstruction: null,
        status: 'awaiting_quote',
      })
      .where(eq(quotation.id, id));
    return c.json(
      {
        error: 'failed to enqueue parse job',
        detail: err instanceof Error ? err.message : String(err),
      },
      503,
    );
  }

  return c.json({ quotationId: id, status: 'uploaded' as const }, 200);
});

// -------- POST /quotations (legacy create + upload) ------------------------

const legacyUploadRoute = createRoute({
  method: 'post',
  path: '/quotations',
  tags: ['Quotations'],
  summary: 'Legacy: create a quotation and attach a file in one step',
  description:
    "Kept for backward compatibility. New clients should use POST /rfqs " +
    'followed by POST /quotations/:id/quote.',
  request: {
    body: {
      content: {
        'multipart/form-data': { schema: UploadMultipartSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'Quotation created and parser enqueued',
      content: { 'application/json': { schema: QuotationIdResponseSchema } },
    },
    400: { description: 'Missing file', content: { 'application/json': { schema: ErrorSchema } } },
    500: { description: 'Insert failed', content: { 'application/json': { schema: ErrorSchema } } },
    503: { description: 'Inngest enqueue failed', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

router.openapi(legacyUploadRoute, async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  const userInstruction = form.get('userInstruction');

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'multipart field "file" is required' }, 400);
  }
  const filename = file.name || 'upload.xlsx';
  const bytes = await file.arrayBuffer();
  const saved = await saveUpload({ filename, bytes });

  const sourceSupplierId = 'supplier-1';
  const brandId = 'valden';

  const cleanInstructionLegacy =
    typeof userInstruction === 'string' && userInstruction.length > 0
      ? userInstruction
      : null;

  const inserted = await db
    .insert(quotation)
    .values({
      brandId,
      sourceSupplierId,
      uploadedFilename: saved.uploadedFilename,
      storageUri: saved.storageUri,
      userInstruction: cleanInstructionLegacy,
      status: 'uploaded',
    })
    .returning({ id: quotation.id });
  const quotationId = inserted[0]?.id;
  if (!quotationId) {
    return c.json({ error: 'failed to insert quotation row' }, 500);
  }

  try {
    await inngest.send({
      name: 'quotation/uploaded',
      data: {
        quotationId,
        brandId,
        sourceSupplierId,
        storageUri: saved.storageUri,
        uploadedFilename: saved.uploadedFilename,
        userInstruction: cleanInstructionLegacy,
      },
    });
  } catch (err) {
    await db
      .update(quotation)
      .set({
        status: 'failed',
        parsedMetadata: {
          failureReason: `Inngest send failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          failedAt: new Date().toISOString(),
        } as unknown,
      })
      .where(eq(quotation.id, quotationId));
    return c.json(
      {
        error: 'failed to enqueue parse job',
        detail: err instanceof Error ? err.message : String(err),
      },
      503,
    );
  }

  return c.json({ quotationId, status: 'uploaded' as const }, 201);
});

// -------- GET /quotations ---------------------------------------------------

const listQuotationsRoute = createRoute({
  method: 'get',
  path: '/quotations',
  tags: ['Quotations'],
  summary: 'List all quotations, most recent first',
  responses: {
    200: {
      description: 'Array of quotation summaries',
      content: {
        'application/json': {
          schema: z.object({ quotations: z.array(QuotationSummarySchema) }),
        },
      },
    },
  },
});

router.openapi(listQuotationsRoute, async (c) => {
  const rows = await db
    .select({
      id: quotation.id,
      status: quotation.status,
      uploadedFilename: quotation.uploadedFilename,
      userInstruction: quotation.userInstruction,
      sourceSupplierId: quotation.sourceSupplierId,
      recommendedNegotiationId: quotation.recommendedNegotiationId,
      createdAt: quotation.createdAt,
      updatedAt: quotation.updatedAt,
    })
    .from(quotation)
    .orderBy(desc(quotation.createdAt));
  return c.json({
    quotations: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

// -------- GET /quotations/:id ----------------------------------------------

const getQuotationRoute = createRoute({
  method: 'get',
  path: '/quotations/{id}',
  tags: ['Quotations'],
  summary: 'Full quotation detail (lines, negotiations, messages)',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Quotation detail',
      content: { 'application/json': { schema: QuotationFullSchema } },
    },
    404: { description: 'Quotation not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

// @hono/zod-openapi infers a strict TypedResponse from the route's
// `responses` map. Drizzle's row types (jsonb -> unknown, timestamps ->
// Date) plus the breadth of QuotationFullSchema produce a union that the
// inference can't perfectly reconcile, even though the runtime payload
// is correct. We cast `as never` on the success c.json call to keep
// strict response validation on the schema side without fighting TS at
// the cost of one explicit assertion.
router.openapi(getQuotationRoute, async (c) => {
  const { id } = c.req.valid('param');
  const qrows = await db
    .select()
    .from(quotation)
    .where(eq(quotation.id, id))
    .limit(1);
  const q = qrows[0];
  if (!q) return c.json({ error: 'not found' }, 404);

  const lines = await db
    .select()
    .from(quotationLine)
    .where(eq(quotationLine.quotationId, id));

  const negs = await db
    .select()
    .from(negotiation)
    .where(eq(negotiation.quotationId, id));

  const negIds = negs.map((n) => n.id);
  const msgs = negIds.length
    ? await db
        .select()
        .from(negotiationMessage)
        .orderBy(asc(negotiationMessage.turnIndex))
    : [];
  const msgsByNeg = new Map<string, typeof msgs>();
  for (const nid of negIds) msgsByNeg.set(nid, []);
  for (const m of msgs) {
    const bucket = msgsByNeg.get(m.negotiationId);
    if (bucket) bucket.push(m);
  }

  const payload = {
    quotation: {
      ...q,
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
      recommendedAt: q.recommendedAt?.toISOString() ?? null,
    },
    lines: lines.map((l) => ({ ...l })),
    negotiations: negs.map((n) => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
      concludedAt: n.concludedAt?.toISOString() ?? null,
      messages: (msgsByNeg.get(n.id) ?? []).map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
    })),
  };
  return c.json(payload as never);
});

// -------- GET /quotations/:id/stream (SSE — kept off OpenAPI) --------------

// SSE doesn't fit the OpenAPI request/response model cleanly; document it
// in ARCHITECTURE.md instead and register as a raw Hono GET so the SDK's
// streaming primitives are available.
router.get('/quotations/:id/stream', (c) => {
  const id = c.req.param('id');
  return streamSSE(c, async (stream) => {
    let closed = false;
    const unsubscribe = eventBus.subscribe(id, async (event) => {
      if (closed) return;
      try {
        await stream.writeSSE({
          event: event.kind,
          data: JSON.stringify(event),
          id: event.id,
        });
      } catch {
        closed = true;
      }
    });
    c.req.raw.signal?.addEventListener('abort', () => {
      closed = true;
      unsubscribe();
    });
    while (!closed && !c.req.raw.signal?.aborted) {
      await stream.sleep(15_000);
      try {
        await stream.writeSSE({ event: 'ping', data: 'keepalive' });
      } catch {
        closed = true;
      }
    }
    unsubscribe();
  });
});

void CurrencySchema;

export { router as quotationsRouter };
