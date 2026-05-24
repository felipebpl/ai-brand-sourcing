import { eq, inArray, sql } from 'drizzle-orm';
import type { QuotationExtraction } from '@app/shared';
import type { DB } from '../db';
import { product, quotation, quotationLine } from '../db/schema';

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
/**
 * Catalog guard — pure helper. Extracted from `persistParseResult` so
 * the demotion logic can be unit-tested without a live DB. Inputs:
 *
 *  - `extraction`: what the parser submitted.
 *  - `validSkus`: the subset of `extraction.lines[].matchedSku` values
 *    that actually exist in the `product` table.
 *
 * Returns the same `lines` array with orphans demoted to
 * `agent_uncertain` (matched_sku and confidence nulled, reasoning
 * prefixed), plus an extended `ambiguities` array carrying one entry per
 * demoted SKU so the UI surfaces them, plus the list of demoted SKUs
 * for audit (`catalogGuard.demoted`).
 *
 * The parser's "agent_exact" path skips lookup_catalog when the raw SKU
 * looks structurally clean, which fails when the supplier writes an
 * incomplete SKU (e.g. pants without inseam: "AP004-GLW-28" vs the
 * catalog's "AP004-GLW-28-24"). This guard makes the FK constraint a
 * safety net instead of a crash trigger.
 */
export function collectProposedSkus(
  extraction: QuotationExtraction,
): string[] {
  return Array.from(
    new Set(
      extraction.lines
        .map((l) => l.matchedSku)
        .filter((s): s is string => typeof s === 'string' && s.length > 0),
    ),
  );
}

export function applyCatalogGuard(
  extraction: QuotationExtraction,
  validSkus: ReadonlySet<string>,
): {
  guardedLines: QuotationExtraction['lines'];
  guardedAmbiguities: QuotationExtraction['ambiguities'];
  demotedSkus: string[];
} {
  const demotedSkus: string[] = [];
  const guardedLines = extraction.lines.map((line) => {
    if (!line.matchedSku || validSkus.has(line.matchedSku)) return line;
    demotedSkus.push(line.matchedSku);
    const note = `catalog guard: matched SKU '${line.matchedSku}' is not in the product catalog — demoted to uncertain`;
    return {
      ...line,
      matchedSku: null,
      matchConfidence: null,
      matchMethod: 'agent_uncertain' as const,
      matchReasoning: line.matchReasoning
        ? `${note}. Prior reasoning: ${line.matchReasoning}`
        : note,
    };
  });

  const guardedAmbiguities = [
    ...extraction.ambiguities,
    ...demotedSkus.map((sku) => ({
      where: `matched_sku '${sku}'`,
      reason:
        'Proposed match not found in catalog. The raw SKU likely needs more segments (e.g. pants take waist-inseam) or contains a typo; review the line.',
    })),
  ];

  return { guardedLines, guardedAmbiguities, demotedSkus };
}

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

  const proposedSkus = collectProposedSkus(extraction);
  const validSkus = new Set<string>();
  if (proposedSkus.length > 0) {
    const existing = await db
      .select({ sku: product.sku })
      .from(product)
      .where(inArray(product.sku, proposedSkus));
    for (const row of existing) validSkus.add(row.sku);
  }

  const { guardedLines, guardedAmbiguities, demotedSkus } = applyCatalogGuard(
    extraction,
    validSkus,
  );

  const lineRows = guardedLines.map((line) => ({
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

  const breakdown = guardedLines.reduce(
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
    ambiguities: guardedAmbiguities,
    matchBreakdown: breakdown,
    catalogGuard: {
      proposed: proposedSkus.length,
      valid: validSkus.size,
      demoted: demotedSkus,
    },
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
    ambiguityCount: guardedAmbiguities.length,
    matchBreakdown: breakdown,
  };
}
