import { db } from '../db';
import { eventBus } from '../infra/agent-sdk/event-bus';
import { ClaudeBrandAgentAdapter } from '../infra/agent-sdk/adapters/brand-agent.claude';

/**
 * Brand agent bootstrap smoke test.
 *
 *   bun run agent:smoke
 *
 * Requires a real ANTHROPIC_API_KEY in .env. Sends a single, minimal
 * `query()` to the brand agent's loopback bootstrap endpoint to validate
 * the entire wiring: model router, system prompt, session store,
 * structured output, hooks, cost reporting.
 *
 * Expected cost: <$0.01 per run.
 */
const QUOTATION_ID = 'smoke-' + crypto.randomUUID();

const log = (label: string, payload?: unknown): void => {
  console.log(`\n--- ${label}`);
  if (payload !== undefined) console.log(payload);
};

eventBus.subscribe(QUOTATION_ID, (event) => {
  log(`event: ${event.kind}`, event.payload);
});

const adapter = new ClaudeBrandAgentAdapter({ db, eventBus });

log('Booting brand agent...');

const result = await adapter.bootstrap({
  quotationId: QUOTATION_ID,
  brand: {
    id: 'valden',
    name: 'Valden',
    positioningHypothesis:
      'Premium outdoor technical apparel — quality matters, but value-conscious.',
  },
});

log('Bootstrap result', result);
log('Done.');
process.exit(0);
