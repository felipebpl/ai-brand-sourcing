import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { quotation, quotationLine } from '../db/schema';
import { eventBus } from '../infra/agent-sdk/event-bus';
import { ClaudeBrandAgentAdapter } from '../infra/agent-sdk/adapters/brand-agent.claude';
import { ClaudeParserAdapter } from '../infra/agent-sdk/adapters/parser.claude';
import { parseAndPersist } from '../quotations/pipeline';

/**
 * Agent SDK smoke harness.
 *
 *   bun run agent:smoke                    # bootstrap loopback (Step 1)
 *   bun run agent:smoke parser-ping        # brand → Agent(parser) placeholder (Step 2)
 *   bun run agent:smoke parse <file>       # parser subagent vs a real XLSX (Step 3)
 *
 * Requires a real ANTHROPIC_API_KEY in .env. Validates the wiring end
 * to end, paying real Anthropic costs (~$0.02–0.10 per parse call).
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

const adapter = new ClaudeBrandAgentAdapter({ db, eventBus });

if (mode === 'parser-ping') {
  log('Invoking brand agent → parser subagent (Agent tool round-trip)...');
  const result = await adapter.pingParser({ quotationId: QUOTATION_ID, brand });
  log('Parser ping result', result);
} else {
  log('Booting brand agent (bootstrap loopback)...');
  const result = await adapter.bootstrap({ quotationId: QUOTATION_ID, brand });
  log('Bootstrap result', result);
}

log('Done.');
process.exit(0);
