import { db } from '../db';
import { eventBus } from '../infra/agent-sdk/event-bus';
import { ClaudeBrandAgentAdapter } from '../infra/agent-sdk/adapters/brand-agent.claude';

/**
 * Brand agent smoke test.
 *
 *   bun run agent:smoke              # bootstrap only
 *   bun run agent:smoke parser-ping  # bootstrap + invoke parser subagent
 *
 * Requires a real ANTHROPIC_API_KEY in .env. Validates the wiring:
 * model router, system prompt, session store, structured output,
 * hooks, cost reporting — and (in parser-ping mode) the Agent tool
 * round-trip to the parser subagent placeholder.
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

const adapter = new ClaudeBrandAgentAdapter({ db, eventBus });

const brand = {
  id: 'valden',
  name: 'Valden',
  positioningHypothesis:
    'Premium outdoor technical apparel — quality matters, but value-conscious.',
};

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
