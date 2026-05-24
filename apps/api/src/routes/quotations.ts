import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { asc, desc, eq } from 'drizzle-orm';
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
 * Routes:
 *   POST   /quotations           upload (multipart) → fires quotation/uploaded
 *   GET    /quotations           list with status + recommendation summary
 *   GET    /quotations/:id       full detail (lines, negotiations, messages, recommendation)
 *   GET    /quotations/:id/stream  SSE consuming the eventBus
 *
 * The upload route writes the file to local storage and fires the
 * Inngest event. Parsing and negotiation are async background work
 * driven by `handle-quotation-uploaded`. The client polls
 * `GET /quotations/:id` or subscribes to `/quotations/:id/stream` for
 * progress.
 */
const router = new Hono();

/**
 * Create an empty RFQ awaiting a supplier quote. No file required.
 * Returns the new quotation id. Use POST /quotations/:id/quote to
 * attach the supplier's spreadsheet later, which kicks off parsing.
 */
router.post('/rfqs', async (c) => {
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
  return c.json({ quotationId, status: 'awaiting_quote' }, 201);
});

/**
 * Attach a supplier's quotation file to an existing RFQ that's
 * awaiting its quote. Transitions the quotation into 'uploaded' and
 * fires the same Inngest event the legacy POST /quotations route
 * does, so the parser pipeline downstream is unchanged.
 */
router.post('/quotations/:id/quote', async (c) => {
  const id = c.req.param('id');
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

  return c.json({ quotationId: id, status: 'uploaded' }, 200);
});

router.post('/quotations', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  const userInstruction = form.get('userInstruction');

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'multipart field "file" is required' }, 400);
  }
  const filename = file.name || 'upload.xlsx';
  const bytes = await file.arrayBuffer();
  const saved = await saveUpload({ filename, bytes });

  // S1 is the source supplier — the one whose XLSX we just received.
  // Its display name will be updated post-parse when the parser
  // extracts the supplier name from the file metadata.
  const sourceSupplierId = 'supplier-1';
  const brandId = 'valden';

  const inserted = await db
    .insert(quotation)
    .values({
      brandId,
      sourceSupplierId,
      uploadedFilename: saved.uploadedFilename,
      storageUri: saved.storageUri,
      userInstruction:
        typeof userInstruction === 'string' && userInstruction.length > 0
          ? userInstruction
          : null,
      status: 'uploaded',
    })
    .returning({ id: quotation.id });
  const quotationId = inserted[0]?.id;
  if (!quotationId) {
    return c.json({ error: 'failed to insert quotation row' }, 500);
  }

  await inngest.send({
    name: 'quotation/uploaded',
    data: {
      quotationId,
      brandId,
      sourceSupplierId,
      storageUri: saved.storageUri,
      uploadedFilename: saved.uploadedFilename,
      userInstruction:
        typeof userInstruction === 'string' && userInstruction.length > 0
          ? userInstruction
          : null,
    },
  });

  return c.json({ quotationId, status: 'uploaded' }, 201);
});

router.get('/quotations', async (c) => {
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
  return c.json({ quotations: rows });
});

router.get('/quotations/:id', async (c) => {
  const id = c.req.param('id');
  const qrows = await db.select().from(quotation).where(eq(quotation.id, id)).limit(1);
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

  return c.json({
    quotation: q,
    lines,
    negotiations: negs.map((n) => ({
      ...n,
      messages: msgsByNeg.get(n.id) ?? [],
    })),
  });
});

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
    // Keep the connection open by sleeping in a loop.
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

export { router as quotationsRouter };
