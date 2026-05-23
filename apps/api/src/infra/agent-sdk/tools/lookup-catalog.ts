import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { DB } from '../../../db';

/**
 * `lookup_catalog` MCP tool — fuzzy search the brand's product catalog
 * by Postgres trigram similarity (`pg_trgm`).
 *
 * Returns the top-K candidate SKUs ranked by similarity. The parser
 * agent uses this whenever a raw SKU from a supplier file doesn't
 * verbatim match the catalog; it then decides the right match using
 * contextual signals (description, color) and reports the chosen
 * `matchMethod` + `matchReasoning` per line.
 *
 * Why trigram, not embeddings or BM25:
 *   - SKUs are short codes (typos: zero↔O, l↔I, missing dashes). Trigram
 *     dominates on short-string fuzzy at this length.
 *   - Embeddings burn cost + add a Voyage dependency, with no recall win
 *     over trigram for this domain.
 *   - BM25 is overkill for 10k rows of short codes.
 *
 * Returns no more than `limit` rows and discards anything below 0.20
 * similarity (noise floor).
 */
const LookupCatalogInputSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      'The raw SKU (or SKU-like substring) from the supplier file to resolve against the catalog.',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(10)
    .describe('Maximum number of candidates to return. Keep ≤ 20 in practice.'),
};

type CatalogRow = {
  sku: string;
  name: string;
  color: string | null;
  sim: number;
  [k: string]: unknown;
};

export function makeLookupCatalogTool(db: DB) {
  return tool(
    'lookup_catalog',
    'Fuzzy search the brand product catalog by trigram similarity. ' +
      'Returns the top-K candidate SKUs ranked by similarity score, ' +
      'each with `sku`, `name`, `color`, and `similarity` (0..1). ' +
      'Use whenever a raw SKU does not verbatim match a catalog entry.',
    LookupCatalogInputSchema,
    async ({ query, limit }) => {
      const result = await db.execute<CatalogRow>(sql`
        SELECT sku, name, color, similarity(sku, ${query}) AS sim
        FROM   product
        WHERE  similarity(sku, ${query}) > 0.2
        ORDER  BY sim DESC
        LIMIT  ${limit}
      `);
      const rows = (result as unknown as { rows: CatalogRow[] }).rows;
      const candidates = rows.map((r) => ({
        sku: r.sku,
        name: r.name,
        color: r.color,
        similarity: Number(r.sim),
      }));
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { query, count: candidates.length, candidates },
              null,
              2,
            ),
          },
        ],
        structuredContent: { query, candidates },
      };
    },
    { annotations: { readOnlyHint: true, idempotentHint: true } },
  );
}
