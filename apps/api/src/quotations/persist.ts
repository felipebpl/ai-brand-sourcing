import { eq, sql } from 'drizzle-orm';
import type { QuotationExtraction } from '@app/shared';
import type { DB } from '../db';
import { quotation, quotationLine } from '../db/schema';

/**
 * Persist a parser-emitted `QuotationExtraction` to the database.
 *
 * Idempotent by design — re-running with the same `quotationId` replaces
 * all `quotation_line` rows for that quotation and overwrites the
 * `parsed_metadata` payload. This lets the agent retry (or a future
 * Inngest replay) without corrupting state.
 *
 * Runs as a single Postgres transaction so a mid-write crash leaves the
 * quotation in its prior state, never a half-loaded one.
 *
 * Persisted shape:
 * - `quotation.parsed_metadata` (jsonb): top-level fields the agent
 *   extracted — supplier name, currency, lead time, payment terms,
 *   issued_at, language — plus `ambiguities[]` for the brand/UI layer
 *   to surface. Recommendation/winner fields are untouched.
 * - `quotation.status`: advanced to `parsed` on success.
 * - `quotation_line[]` rows exploded one-per-tier with `matched_sku`,
 *   `match_confidence`, `match_method`, `match_reasoning`, `source_ref`,
 *   `raw_extras` populated as the agent reported them.
 *
 * Returns counters for the smoke harness and downstream telemetry.
 */
export interface PersistResult {
  quotationId: string;
  lineCount: number;
  ambiguityCount: number;
  matchBreakdown: {
    exact: number;
    fuzzy: number;
    uncertain: number;
    unmatched: number;
  };
}

export async function persistParseResult(args: {
  db: DB;
  quotationId: string;
  extraction: QuotationExtraction;
}): Promise<PersistResult> {
  const { db, quotationId, extraction } = args;

  const lineRows = extraction.lines.map((line) => ({
    quotationId,
    rawSku: line.rawSku,
    rawDescription: line.rawDescription,
    minQty: Math.trunc(line.minQty),
    maxQty: line.maxQty === null ? null : Math.trunc(line.maxQty),
    unitPrice: line.unitPrice.toString(),
    currency: line.currency,
    matchedSku: line.matchedSku,
    matchConfidence:
      line.matchConfidence === null ? null : line.matchConfidence.toString(),
    matchMethod: line.matchMethod,
    matchReasoning: line.matchReasoning,
    sourceRef: line.sourceRef as unknown,
    rawExtras: line.rawExtras as unknown,
  }));

  const breakdown = extraction.lines.reduce(
    (acc, l) => {
      if (l.matchMethod === 'agent_exact') acc.exact += 1;
      else if (l.matchMethod === 'agent_fuzzy_inferred') acc.fuzzy += 1;
      else if (l.matchMethod === 'agent_uncertain') acc.uncertain += 1;
      else acc.unmatched += 1;
      return acc;
    },
    { exact: 0, fuzzy: 0, uncertain: 0, unmatched: 0 },
  );

  const parsedMetadata = {
    supplierName: extraction.supplierName,
    quoteId: extraction.quoteId,
    issuedAt: extraction.issuedAt,
    currency: extraction.currency,
    leadTimeDays: extraction.leadTimeDays,
    paymentTerms: extraction.paymentTerms,
    language: extraction.language,
    ambiguities: extraction.ambiguities,
    matchBreakdown: breakdown,
    persistedAt: new Date().toISOString(),
  };

  await db.transaction(async (tx) => {
    await tx
      .delete(quotationLine)
      .where(eq(quotationLine.quotationId, quotationId));

    if (lineRows.length > 0) {
      await tx.insert(quotationLine).values(lineRows);
    }

    await tx
      .update(quotation)
      .set({
        parsedMetadata,
        status: 'parsed',
        updatedAt: sql`now()`,
      })
      .where(eq(quotation.id, quotationId));
  });

  return {
    quotationId,
    lineCount: lineRows.length,
    ambiguityCount: extraction.ambiguities.length,
    matchBreakdown: breakdown,
  };
}
