import { eventBus } from '../../infra/agent-sdk/event-bus';
import { ClaudeParserAdapter } from '../../infra/agent-sdk/adapters/parser.claude';
import { parseAndPersist } from '../../quotations/pipeline';
import { runNegotiation } from '../../negotiations/pipeline';
import { db } from '../../db';
import { inngest } from '../client';
import { resolve } from 'node:path';

/**
 * `quotation/uploaded` handler — the system's main entry point.
 *
 * Sequence:
 *   1. Parse the XLSX (parseAndPersist) — idempotent via state machine
 *      (uploaded → parsing → parsed | failed).
 *   2. If parsing succeeded, run the brand negotiation (runNegotiation)
 *      — also idempotent (parsed → negotiating → recommended | failed).
 *
 * Both steps are wrapped in `step.run` so Inngest can checkpoint each
 * and replay safely on transient failure. The brand agent's internal
 * agentic loop is one durable step from Inngest's POV; the rounds
 * inside it are not — Anthropic provides that durability via the SDK's
 * own retry semantics.
 */
export const handleQuotationUploaded = inngest.createFunction(
  {
    id: 'handle-quotation-uploaded',
    name: 'Parse and negotiate uploaded quotation',
    retries: 1,
    concurrency: { limit: 4 },
  },
  { event: 'quotation/uploaded' },
  async ({ event, step }) => {
    const { quotationId, storageUri, uploadedFilename, userInstruction } =
      event.data;

    const workspaceRoot = resolve(import.meta.dir, '..', '..', '..', '..', '..');

    const parsed = await step.run('parse-quotation', async () => {
      const parser = new ClaudeParserAdapter({
        db,
        eventBus,
        workspaceRoot,
      });
      return parseAndPersist({
        db,
        parser,
        quotationId,
        storageUri,
        uploadedFilename,
        userInstruction,
      });
    });

    if (parsed.kind !== 'parsed' && parsed.kind !== 'skipped') {
      return { phase: 'parse', outcome: parsed };
    }

    const negotiated = await step.run('run-negotiation', async () => {
      return runNegotiation({
        db,
        eventBus,
        brand: {
          id: 'valden',
          name: 'Valden',
          positioningHypothesis:
            'Premium outdoor technical apparel — quality matters, but value-conscious.',
        },
        quotationId,
      });
    });

    return {
      phase: 'negotiate',
      parsed,
      negotiated,
    };
  },
);
