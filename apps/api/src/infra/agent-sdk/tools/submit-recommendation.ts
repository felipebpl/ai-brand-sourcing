import { tool } from '@anthropic-ai/claude-agent-sdk';
import { RecommendationSchema, type Recommendation } from '@app/shared';
import { z } from 'zod';

/**
 * `submit_recommendation` MCP tool — the brand agent's terminal action.
 *
 * Validates the payload against the canonical Zod schema (rejects with
 * isError if invalid, so the agent can fix and retry). Pushes the parsed
 * Recommendation into the sink for the pipeline to persist atomically
 * to `quotation.recommended_*` fields.
 *
 * Accepts both a JSON-string payload (some agents serialize large JSON
 * before sending) and a structured object — same pattern as the parser's
 * submit_extraction tool.
 *
 * Like submit_extraction, this tool is idempotent within a single run:
 * a re-submission returns `isError: true` with a clear message so the
 * agent doesn't enter a retry loop after success.
 */
export interface SubmitRecommendationSink {
  accept(recommendation: Recommendation): Promise<void>;
}

const SubmitRecommendationInputSchema = {
  recommendation: z
    .unknown()
    .describe(
      'A Recommendation object matching the canonical schema. Pass it ' +
        'as an object, not a JSON-encoded string.',
    ),
};

export interface SubmitRecommendationConfig {
  sink: SubmitRecommendationSink;
  /** Real negotiation UUIDs the brand may reference. Used to reject invented ids. */
  validNegotiationIds: ReadonlySet<string>;
}

export function makeSubmitRecommendationTool(
  config: SubmitRecommendationConfig,
) {
  const { sink, validNegotiationIds } = config;
  let alreadySubmitted = false;

  return tool(
    'submit_recommendation',
    'Submit the final Recommendation that names the winning supplier ' +
      'with reasoning + comparison matrix. Call exactly once at the end ' +
      'of the negotiation. Your turn ends immediately after this call.',
    SubmitRecommendationInputSchema,
    async ({ recommendation }) => {
      if (alreadySubmitted) {
        return {
          content: [
            {
              type: 'text',
              text:
                'Recommendation already submitted. Do not call this tool again.',
            },
          ],
          isError: true,
        };
      }

      let toValidate: unknown = recommendation;
      if (typeof recommendation === 'string') {
        try {
          toValidate = JSON.parse(recommendation);
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: `recommendation was a string but is not valid JSON: ${
                  err instanceof Error ? err.message : String(err)
                }. Send the object directly, not as JSON-encoded text.`,
              },
            ],
            isError: true,
          };
        }
      }

      const parsed = RecommendationSchema.safeParse(toValidate);
      if (!parsed.success) {
        return {
          content: [
            {
              type: 'text',
              text:
                `Recommendation failed schema validation. Issues:\n` +
                parsed.error.issues
                  .map(
                    (i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`,
                  )
                  .join('\n'),
            },
          ],
          isError: true,
        };
      }

      // Reject invented UUIDs — only the negotiation ids the pipeline
      // already opened are valid.
      const referenced = new Set<string>([
        parsed.data.negotiationId,
        ...parsed.data.comparison.map((c) => c.negotiationId),
      ]);
      const invalid = [...referenced].filter(
        (id) => !validNegotiationIds.has(id),
      );
      if (invalid.length > 0) {
        const known = [...validNegotiationIds].join(', ');
        return {
          content: [
            {
              type: 'text',
              text:
                `Recommendation references unknown negotiationId(s): ` +
                `${invalid.join(', ')}. The only valid ids are: ${known}. ` +
                `Use those exact UUIDs from the task prompt.`,
            },
          ],
          isError: true,
        };
      }

      alreadySubmitted = true;
      try {
        await sink.accept(parsed.data);
      } catch (err) {
        alreadySubmitted = false;
        return {
          content: [
            {
              type: 'text',
              text: `Failed to persist recommendation: ${
                err instanceof Error ? err.message : String(err)
              }`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: 'Recommendation accepted. End your turn now.',
          },
        ],
        structuredContent: {
          accepted: true,
          supplierId: parsed.data.supplierId,
        } as Record<string, unknown>,
      };
    },
    { annotations: { readOnlyHint: false, idempotentHint: true } },
  );
}
