import { describe, expect, test } from 'bun:test';
import type { QuotationExtraction } from '@app/shared';
import { applyCatalogGuard, collectProposedSkus } from './persist';

function makeExtraction(
  partial: Partial<QuotationExtraction['lines'][number]>[] = [],
): QuotationExtraction {
  return {
    supplierName: 'Test',
    quoteId: null,
    issuedAt: null,
    currency: 'USD',
    leadTimeDays: 30,
    paymentTerms: '40/60',
    language: 'en',
    lines: partial.map((p, i) => ({
      rawSku: p.rawSku ?? `RAW-${i}`,
      rawDescription: p.rawDescription ?? null,
      minQty: p.minQty ?? 100,
      maxQty: p.maxQty ?? null,
      unitPrice: p.unitPrice ?? 10,
      currency: p.currency ?? 'USD',
      matchedSku: p.matchedSku ?? null,
      matchConfidence: p.matchConfidence ?? null,
      matchMethod: p.matchMethod ?? null,
      matchReasoning: p.matchReasoning ?? null,
      sourceRef: p.sourceRef ?? null,
      rawExtras: p.rawExtras ?? null,
    })),
    ambiguities: [],
  };
}

describe('collectProposedSkus', () => {
  test('dedups and filters empty/null matchedSku values', () => {
    const ext = makeExtraction([
      { matchedSku: 'A-001' },
      { matchedSku: 'A-001' },
      { matchedSku: null },
      { matchedSku: '' },
      { matchedSku: 'B-002' },
    ]);
    const skus = collectProposedSkus(ext);
    expect(skus.sort()).toEqual(['A-001', 'B-002']);
  });

  test('returns empty array when no lines have matchedSku', () => {
    const ext = makeExtraction([{ matchedSku: null }, { matchedSku: null }]);
    expect(collectProposedSkus(ext)).toEqual([]);
  });
});

describe('applyCatalogGuard', () => {
  test('keeps lines whose matchedSku exists in the catalog', () => {
    const ext = makeExtraction([
      { matchedSku: 'A-001', matchMethod: 'agent_exact' },
    ]);
    const result = applyCatalogGuard(ext, new Set(['A-001']));
    expect(result.demotedSkus).toEqual([]);
    expect(result.guardedLines[0]?.matchedSku).toBe('A-001');
    expect(result.guardedLines[0]?.matchMethod).toBe('agent_exact');
    expect(result.guardedAmbiguities).toEqual([]);
  });

  test('demotes orphan SKU and appends an ambiguity entry', () => {
    const ext = makeExtraction([
      {
        matchedSku: 'GHOST-999',
        matchMethod: 'agent_exact',
        matchConfidence: 1.0,
        matchReasoning: 'looked clean',
      },
    ]);
    const result = applyCatalogGuard(ext, new Set([]));
    expect(result.demotedSkus).toEqual(['GHOST-999']);
    const line = result.guardedLines[0];
    expect(line?.matchedSku).toBeNull();
    expect(line?.matchConfidence).toBeNull();
    expect(line?.matchMethod).toBe('agent_uncertain');
    expect(line?.matchReasoning).toContain('catalog guard');
    expect(line?.matchReasoning).toContain('Prior reasoning: looked clean');
    expect(result.guardedAmbiguities).toHaveLength(1);
    expect(result.guardedAmbiguities[0]?.where).toContain('GHOST-999');
  });

  test('orphan with no prior reasoning still gets a clean note', () => {
    const ext = makeExtraction([
      { matchedSku: 'GHOST-999', matchMethod: 'agent_exact' },
    ]);
    const result = applyCatalogGuard(ext, new Set([]));
    expect(result.guardedLines[0]?.matchReasoning).toBe(
      "catalog guard: matched SKU 'GHOST-999' is not in the product catalog — demoted to uncertain",
    );
  });

  test('mixed batch: keeps valid, demotes orphans, preserves order', () => {
    const ext = makeExtraction([
      { matchedSku: 'A-001', matchMethod: 'agent_exact' },
      { matchedSku: 'GHOST-A' },
      { matchedSku: 'B-002', matchMethod: 'agent_fuzzy_inferred' },
      { matchedSku: 'GHOST-B' },
    ]);
    const result = applyCatalogGuard(ext, new Set(['A-001', 'B-002']));
    expect(result.demotedSkus).toEqual(['GHOST-A', 'GHOST-B']);
    expect(result.guardedLines[0]?.matchedSku).toBe('A-001');
    expect(result.guardedLines[1]?.matchedSku).toBeNull();
    expect(result.guardedLines[2]?.matchedSku).toBe('B-002');
    expect(result.guardedLines[3]?.matchedSku).toBeNull();
    expect(result.guardedAmbiguities).toHaveLength(2);
  });

  test('preserves pre-existing ambiguities and appends new ones at the end', () => {
    const ext = makeExtraction([{ matchedSku: 'GHOST' }]);
    ext.ambiguities = [{ where: 'line 7', reason: 'pre-existing issue' }];
    const result = applyCatalogGuard(ext, new Set([]));
    expect(result.guardedAmbiguities).toHaveLength(2);
    expect(result.guardedAmbiguities[0]).toEqual({
      where: 'line 7',
      reason: 'pre-existing issue',
    });
    expect(result.guardedAmbiguities[1]?.where).toContain('GHOST');
  });
});
