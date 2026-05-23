import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { QuotationExtractionSchema, type QuotationExtraction } from '@app/shared';

/**
 * `submit_extraction` MCP tool — terminal action for the parser subagent.
 *
 * The parser produces a structured `QuotationExtraction` and calls this
 * tool exactly once. The adapter (parser.claude.ts) captures the payload
 * via the `SubmitExtractionSink` so the orchestrator can persist it and
 * return it to the brand agent as the subagent's terminal result.
 *
 * Schema mirrors `packages/shared/src/quotation.ts:QuotationExtractionSchema`
 * verbatim. The Zod schema validates the agent's submission server-side;
 * a malformed payload is rejected with `isError: true` so the agent gets
 * actionable feedback and can retry instead of crashing the whole run.
 *
 * The `extra` parameter of the handler is the MCP server's extras object
 * (RequestExtra) — we don't need it here but the SDK passes it.
 */

const SubmitExtractionInputSchema = {
  extraction: z
    .unknown()
    .describe(
      'A QuotationExtraction object exactly matching the schema in ' +
        'output-schema.md. Required top-level keys: lines (array), ' +
        'ambiguities (array, possibly empty), currency, plus any of ' +
        'supplierName, quoteId, issuedAt, leadTimeDays, paymentTerms, language.',
    ),
};

export interface SubmitExtractionSink {
  /**
   * Called exactly once per parser run, with the validated extraction
   * payload. Implementation lives in the adapter; the tool simply
   * forwards.
   */
  accept(extraction: QuotationExtraction): Promise<void>;
}

export function makeSubmitExtractionTool(sink: SubmitExtractionSink) {
  let alreadySubmitted = false;

  return tool(
    'submit_extraction',
    'Terminal tool for the parser subagent. Submit the structured ' +
      'QuotationExtraction payload exactly once at the end of the run. ' +
      'No further tool calls after this one. If validation fails, the ' +
      'tool returns isError so you can fix and re-submit; otherwise the ' +
      'parser run is complete.',
    SubmitExtractionInputSchema,
    async ({ extraction }) => {
      if (alreadySubmitted) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                'submit_extraction was already called this run. Do not ' +
                'submit again — exit the turn.',
            },
          ],
        };
      }

      let toValidate: unknown = extraction;
      if (typeof extraction === 'string') {
        try {
          toValidate = JSON.parse(extraction);
        } catch (e) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text:
                  'The `extraction` argument was a string but is not valid ' +
                  'JSON. Pass the payload as a structured object — not a ' +
                  'JSON-encoded string. Parse error: ' +
                  (e instanceof Error ? e.message : String(e)),
              },
            ],
          };
        }
      }

      const parsed = QuotationExtractionSchema.safeParse(toValidate);
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                'Validation failed against QuotationExtractionSchema. ' +
                'Fix these issues, then call submit_extraction again:\n\n' +
                parsed.error.issues
                  .slice(0, 12)
                  .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
                  .join('\n'),
            },
          ],
        };
      }

      alreadySubmitted = true;
      try {
        await sink.accept(parsed.data);
      } catch (err) {
        alreadySubmitted = false;
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                'submit_extraction validated but the orchestrator failed ' +
                'to accept the payload (transient infra issue). Retry ' +
                'the same submission once. Cause: ' +
                (err instanceof Error ? err.message : String(err)),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text:
              `Submission accepted. ${parsed.data.lines.length} lines ` +
              `parsed; ${parsed.data.ambiguities.length} ambiguity ` +
              'note(s). End the turn now.',
          },
        ],
        structuredContent: { accepted: true, lineCount: parsed.data.lines.length },
      };
    },
    { annotations: { readOnlyHint: false, idempotentHint: false } },
  );
}
