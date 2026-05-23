import { resolve } from 'node:path';
import { db } from '../db';
import { eventBus } from '../infra/agent-sdk/event-bus';
import { ClaudeBrandAgentAdapter } from '../infra/agent-sdk/adapters/brand-agent.claude';
import { ClaudeParserAdapter } from '../infra/agent-sdk/adapters/parser.claude';

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

if (mode === 'parse') {
  const fileArg = process.argv[3];
  if (!fileArg) {
    console.error('Usage: bun agent:smoke parse <relative-or-absolute-path>');
    process.exit(2);
  }
  const storageUri = fileArg.startsWith('/')
    ? fileArg
    : resolve(workspaceRoot, fileArg);

  log(`Parsing real XLSX via parser subagent: ${storageUri}`);
  const parser = new ClaudeParserAdapter({ db, eventBus, workspaceRoot });
  const result = await parser.parse({
    quotationId: QUOTATION_ID,
    storageUri,
    uploadedFilename: fileArg.split('/').pop() ?? fileArg,
    userInstruction: null,
  });
  log('Parse result — top-level fields', {
    supplierName: result.extraction.supplierName,
    quoteId: result.extraction.quoteId,
    issuedAt: result.extraction.issuedAt,
    currency: result.extraction.currency,
    leadTimeDays: result.extraction.leadTimeDays,
    paymentTerms: result.extraction.paymentTerms,
    language: result.extraction.language,
    lineCount: result.extraction.lines.length,
    ambiguityCount: result.extraction.ambiguities.length,
  });
  log('First 5 lines', result.extraction.lines.slice(0, 5));
  if (result.extraction.ambiguities.length > 0) {
    log('Ambiguities', result.extraction.ambiguities);
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
