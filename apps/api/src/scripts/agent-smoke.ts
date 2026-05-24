import { resolve } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import {
  negotiation,
  negotiationMessage,
  quotation,
  quotationLine,
  supplier,
} from '../db/schema';
import { eventBus } from '../infra/agent-sdk/event-bus';
import { ClaudeParserAdapter } from '../infra/agent-sdk/adapters/parser.claude';
import { ClaudeSupplierAgentAdapter } from '../infra/agent-sdk/adapters/supplier-agent.claude';
import { parseAndPersist } from '../quotations/pipeline';
import { runNegotiation } from '../negotiations/pipeline';
import { runBootstrap, runPingParser } from './agent-smoke-helpers';

/**
 * Agent SDK smoke harness.
 *
 *   bun run agent:smoke                    # brand bootstrap loopback (SDK config check)
 *   bun run agent:smoke parser-ping        # brand → Agent(parser) wiring check
 *   bun run agent:smoke parse <file>       # parser subagent vs a real XLSX
 *   bun run agent:smoke negotiate-round    # one supplier turn vs a synthetic brand opener
 *   bun run agent:smoke negotiate [id]     # full end-to-end negotiation pipeline
 *
 * Requires a real ANTHROPIC_API_KEY in .env. Validates the wiring end
 * to end, paying real Anthropic costs (~$0.02–0.10 per parse call,
 * ~$1–2 per full negotiate run).
 */
const mode = process.argv[2] ?? 'bootstrap';
const QUOTATION_ID = 'smoke-' + crypto.randomUUID();

const log = (label: string, payload?: unknown): void => {
  console.log(`\n--- ${label}`);
  if (payload !== undefined) console.log(payload);
};

eventBus.subscribe(QUOTATION_ID, (event) => {
  log(`event: ${event.kind}`, event.payload);
});

const brand = {
  id: 'valden',
  name: 'Valden',
  positioningHypothesis:
    'Premium outdoor technical apparel — quality matters, but value-conscious.',
};

const workspaceRoot = resolve(import.meta.dir, '../../../..');

if (mode === 'parse' || mode === 'parse-persist') {
  const fileArg = process.argv[3];
  if (!fileArg) {
    console.error(
      'Usage: bun agent:smoke parse-persist <relative-or-absolute-path>',
    );
    process.exit(2);
  }
  const storageUri = fileArg.startsWith('/')
    ? fileArg
    : resolve(workspaceRoot, fileArg);
  const uploadedFilename = fileArg.split('/').pop() ?? fileArg;

  // Create the quotation row first — in production this happens in the
  // POST /quotations route at upload time. Inline here so the smoke
  // covers the same DB lifecycle the real flow will.
  const [inserted] = await db
    .insert(quotation)
    .values({
      sourceSupplierId: 'supplier-1',
      uploadedFilename,
      storageUri,
      userInstruction: null,
      status: 'uploaded',
    })
    .returning({ id: quotation.id, status: quotation.status });

  if (!inserted) {
    console.error('Failed to insert quotation row');
    process.exit(1);
  }

  log(`Created quotation row ${inserted.id} (status=${inserted.status})`);
  log(`Running parseAndPersist pipeline against ${storageUri}`);

  const parser = new ClaudeParserAdapter({ db, eventBus, workspaceRoot });
  const outcome = await parseAndPersist({
    db,
    parser,
    quotationId: inserted.id,
    storageUri,
    uploadedFilename,
    userInstruction: null,
  });

  log('Pipeline outcome', outcome);

  if (outcome.kind === 'parsed') {
    // Verify by reading back from the DB exactly what's persisted.
    const persistedRow = await db
      .select()
      .from(quotation)
      .where(eq(quotation.id, inserted.id))
      .limit(1);
    const persistedLines = await db
      .select()
      .from(quotationLine)
      .where(eq(quotationLine.quotationId, inserted.id));

    log('Quotation row after persist', {
      id: persistedRow[0]?.id,
      status: persistedRow[0]?.status,
      parsedMetadata: persistedRow[0]?.parsedMetadata,
    });
    log(`Persisted ${persistedLines.length} quotation_line rows`);
    log('First 3 lines from DB', persistedLines.slice(0, 3));
  }

  log('Done.');
  process.exit(0);
}

if (mode === 'negotiate-round') {
  const supplierId = process.argv[3] ?? 'supplier-2';
  await runNegotiateRound(supplierId);
  process.exit(0);
}

if (mode === 'negotiate') {
  const quotationIdArg = process.argv[3];
  await runEndToEndNegotiation(quotationIdArg);
  process.exit(0);
}

if (mode === 'parser-ping') {
  log('Invoking brand agent → parser subagent (Agent tool round-trip)...');
  const result = await runPingParser({
    db,
    eventBus,
    quotationId: QUOTATION_ID,
    brand,
  });
  log('Parser ping result', result);
} else {
  log('Booting brand agent (bootstrap loopback)...');
  const result = await runBootstrap({
    db,
    eventBus,
    quotationId: QUOTATION_ID,
    brand,
  });
  log('Bootstrap result', result);
}

log('Done.');
process.exit(0);

// ---------------------------------------------------------------------------

async function runEndToEndNegotiation(
  explicitQuotationId: string | undefined,
): Promise<void> {
  let quotationId = explicitQuotationId;
  if (!quotationId) {
    const recent = await db
      .select({ id: quotation.id })
      .from(quotation)
      .where(eq(quotation.status, 'parsed'))
      .orderBy(desc(quotation.updatedAt))
      .limit(1);
    if (!recent[0]) {
      console.error(
        'No parsed quotation available. Run `bun agent:smoke parse-persist assets/quotation_2.xlsx` first.',
      );
      process.exit(1);
    }
    quotationId = recent[0].id;
  }

  log(`Running brand-agent end-to-end negotiation on ${quotationId}`);
  const outcome = await runNegotiation({
    db,
    eventBus,
    brand,
    quotationId,
    force: false,
  });
  log('Outcome', outcome);

  if (outcome.kind === 'recommended') {
    log('Winner recommendation', {
      supplierId: outcome.recommendation.supplierId,
      negotiationId: outcome.recommendation.negotiationId,
      decidedAt: outcome.recommendation.decidedAt,
    });
    log('Reasoning', outcome.recommendation.reasoning);
    log('Comparison matrix', outcome.recommendation.comparison);
    log(`Duration: ${(outcome.durationMs / 1000).toFixed(1)}s`);
  }
}

async function runNegotiateRound(supplierId: string): Promise<void> {
  // Find the most recent parsed quotation to negotiate over.
  const recent = await db
    .select({
      id: quotation.id,
      sourceSupplierId: quotation.sourceSupplierId,
      parsedMetadata: quotation.parsedMetadata,
    })
    .from(quotation)
    .where(eq(quotation.status, 'parsed'))
    .orderBy(desc(quotation.updatedAt))
    .limit(1);
  const quotationRow = recent[0];
  if (!quotationRow) {
    console.error(
      'No parsed quotation available. Run `bun agent:smoke parse-persist assets/quotation_2.xlsx` first.',
    );
    process.exit(1);
  }

  const supplierRow = await db
    .select()
    .from(supplier)
    .where(eq(supplier.id, supplierId))
    .limit(1);
  const profileRow = supplierRow[0];
  if (!profileRow) {
    console.error(`Supplier ${supplierId} not found`);
    process.exit(1);
  }

  // Pull the items being negotiated (first 25 lowest-tier rows).
  const lineRows = await db
    .select({
      productSku: quotationLine.matchedSku,
      description: quotationLine.rawDescription,
      quantity: quotationLine.minQty,
    })
    .from(quotationLine)
    .where(eq(quotationLine.quotationId, quotationRow.id))
    .limit(50);
  const quotedItems: Array<{
    productSku: string;
    description: string | null;
    quantity: number;
  }> = [];
  for (const r of lineRows) {
    if (r.productSku === null) continue;
    quotedItems.push({
      productSku: r.productSku,
      description: r.description,
      quantity: Number(r.quantity),
    });
  }

  // Open a fresh negotiation row for this round (or reuse the latest one).
  const insertedNegotiation = await db
    .insert(negotiation)
    .values({
      quotationId: quotationRow.id,
      supplierId,
      status: 'active',
    })
    .returning({ id: negotiation.id });
  const negotiationId = insertedNegotiation[0]?.id;
  if (!negotiationId) {
    console.error('Failed to insert negotiation row');
    process.exit(1);
  }

  // Fabricate a brand opening message so we can isolate one supplier turn —
  // the real brand agent composes its own openers per the system prompt.
  const brandOpeningMessage = [
    `Hello — we are sourcing this bundle of ${quotedItems.length} SKUs.`,
    `We have a baseline price of $52.00 average unit price from another partner,`,
    `lead time 50 days, terms 33/33/33. Premium quality is important to us, but`,
    `we are also cost-conscious. Where can ${profileRow.name} land on price,`,
    `lead time, and payment terms for this bundle?`,
  ].join(' ');

  await db.insert(negotiationMessage).values({
    negotiationId,
    role: 'brand',
    turnIndex: 0,
    content: brandOpeningMessage,
    offer: null,
    metadata: { simulated: true, quotationId: quotationRow.id },
  });

  log(
    `Negotiation ${negotiationId} (${supplierId}) — brand opening message persisted`,
  );

  const supplierAdapter = new ClaudeSupplierAgentAdapter({
    db,
    eventBus,
    profile: {
      id: profileRow.id,
      name: profileRow.name,
      qualityScore: Number(profileRow.qualityScore),
      defaultLeadTimeDays: profileRow.defaultLeadTimeDays,
      defaultPaymentTermsDisplay:
        (profileRow.defaultPaymentTerms as { display?: string } | null)
          ?.display ?? 'TBD',
      pricingProfile: profileRow.pricingProfile as 'cheap' | 'mid' | 'premium',
      reliabilityScore: profileRow.reliabilityScore,
      onTimeDeliveryRate: profileRow.onTimeDeliveryRate,
    },
    brand,
    defaultPaymentTermsDisplay:
      (profileRow.defaultPaymentTerms as { display?: string } | null)
        ?.display ?? 'TBD',
  });

  log(`Invoking supplier agent ${supplierId}...`);
  const response = await supplierAdapter.respond({
    quotationId: quotationRow.id,
    negotiationId,
    brandMessage: brandOpeningMessage,
    brandAsk: null,
    quotedItems,
    turnIndex: 1,
  });

  log('Supplier response', response);

  const persistedMessages = await db
    .select()
    .from(negotiationMessage)
    .where(eq(negotiationMessage.negotiationId, negotiationId));
  log(`Persisted ${persistedMessages.length} negotiation_message rows`);
  log('Thread', persistedMessages);
}
