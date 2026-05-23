# Output Schema — `QuotationExtraction`

This is the exact shape your `submit_extraction` payload must take.
The source of truth (Zod schema in TypeScript) lives at
`packages/shared/src/quotation.ts`; this document mirrors it in
language an LLM can pattern-match against, plus a fully-filled
example.

## Top-level shape

```jsonc
{
  "supplierName": string | null,    // factory name as it appears on the file (e.g. "Thai Textiles")
  "quoteId": string | null,          // identifier the factory used for this quote, if any
  "issuedAt": string | null,         // ISO 8601 date if a quotation date is on the file
  "currency": "USD" | "BRL" | "EUR" | "CNY" | "GBP",
  "leadTimeDays": number | null,     // positive integer if the file declares a lead time
  "paymentTerms": string | null,     // free-form text — keep the source verbatim ("33/33/33", "40/60", "Net 30")
  "language": string | null,         // "en", "zh", etc. — coarse, just for downstream reasoning
  "lines": QuotationLineExtraction[],
  "ambiguities": Array<{ where: string, reason: string }>
}
```

## `QuotationLineExtraction`

```jsonc
{
  "rawSku": string | null,           // exactly as it appeared in the file
  "rawDescription": string | null,   // exactly as it appeared
  "minQty": number,                  // positive integer — the lower bound of this tier
  "maxQty": number | null,           // upper bound of this tier (null = open-ended)
  "unitPrice": number,               // non-negative; in `currency`
  "currency": "USD" | "BRL" | "EUR" | "CNY" | "GBP",  // usually matches top-level
  "matchedSku": string | null,       // null when unresolved; otherwise a catalog SKU
  "matchConfidence": number | null,  // 0..1; null when matchedSku is null
  "matchMethod": "agent_exact" | "agent_fuzzy_inferred" | "agent_uncertain" | null,
  "matchReasoning": string | null,   // one-line natural-language justification; null for exact matches
  "sourceRef": { "sheet": string, "row": number, "col": number } | null,
  "rawExtras": Record<string, unknown> | null   // discount %, source-specific tags
}
```

## Field-by-field intent

- `minQty` / `maxQty` unify both tier-pricing flavors:
  - Pattern 1 (rows): same SKU appears twice → two `quotation_line`
    entries, e.g. `minQty=500, maxQty=null` for one and
    `minQty=5000, maxQty=null` for another. The brand decides volume
    later; you just preserve what's offered.
  - Pattern 2 (columns): same SKU once, two prices for two tiers →
    two entries with `minQty=1000` and `minQty=5000` respectively.
- `matchedSku` is set **only** when you're confident. Read the rubric
  in `SKILL.md` for when each `matchMethod` value applies.
- `matchReasoning` exists so downstream humans can audit your fuzzy
  matches. One short sentence; cite the typo type and the
  description/color evidence that confirmed.
- `sourceRef` lets the brand agent click back into the file when
  reviewing. Provide it when you can; null is acceptable when the
  exact cell is ambiguous (e.g. you computed a value from a formula).
- `rawExtras` is the place for source-specific things you don't want
  to lose but don't fit elsewhere — line-level discount %, line-level
  notes, the inline `Total` value (so the brand can verify your
  arithmetic).
- `ambiguities[]` is your channel to the human reviewer. Every time
  you hesitated and decided "let me note this rather than guess",
  push an entry. The brand agent surfaces these in the UI for
  approval before negotiation begins.

## Fully-filled example

A realistic payload for a small (3-line) parsed quotation. Notice the
mix of exact, inferred, and uncertain matches; the tier-pricing
unification; and the active use of `ambiguities`.

```json
{
  "supplierName": "Thai Textiles",
  "quoteId": null,
  "issuedAt": "2026-01-01",
  "currency": "USD",
  "leadTimeDays": 60,
  "paymentTerms": "33/33/33",
  "language": "en",
  "lines": [
    {
      "rawSku": "OB006-ICB-S",
      "rawDescription": "Youth Thermo Zip",
      "minQty": 500,
      "maxQty": null,
      "unitPrice": 49.0,
      "currency": "USD",
      "matchedSku": "OB006-ICB-S",
      "matchConfidence": 1.0,
      "matchMethod": "agent_exact",
      "matchReasoning": null,
      "sourceRef": { "sheet": "Purchase order", "row": 9, "col": 2 },
      "rawExtras": null
    },
    {
      "rawSku": "OB006-ICB-S",
      "rawDescription": "Youth Thermo Zip",
      "minQty": 5000,
      "maxQty": null,
      "unitPrice": 45.0,
      "currency": "USD",
      "matchedSku": "OB006-ICB-S",
      "matchConfidence": 1.0,
      "matchMethod": "agent_exact",
      "matchReasoning": null,
      "sourceRef": { "sheet": "Purchase order", "row": 30, "col": 2 },
      "rawExtras": null
    },
    {
      "rawSku": "MBOO2-LGR-S",
      "rawDescription": "Alpine Guide 30",
      "minQty": 1000,
      "maxQty": null,
      "unitPrice": 120.0,
      "currency": "USD",
      "matchedSku": "MB002-LGR-S",
      "matchConfidence": 0.92,
      "matchMethod": "agent_fuzzy_inferred",
      "matchReasoning": "MBOO2→MB002: zero-vs-O typo; 'Alpine Guide 30' description matches catalog name verbatim",
      "sourceRef": { "sheet": "Sheet1", "row": 5, "col": 1 },
      "rawExtras": { "discountPct": 0 }
    },
    {
      "rawSku": "XYZ-999-Z",
      "rawDescription": null,
      "minQty": 200,
      "maxQty": null,
      "unitPrice": 35.0,
      "currency": "USD",
      "matchedSku": null,
      "matchConfidence": null,
      "matchMethod": "agent_uncertain",
      "matchReasoning": "no strong candidate; top similarity 0.31 lacks description corroboration",
      "sourceRef": { "sheet": "Sheet1", "row": 14, "col": 1 },
      "rawExtras": null
    }
  ],
  "ambiguities": [
    {
      "where": "line 4",
      "reason": "raw SKU 'XYZ-999-Z' did not resolve to any catalog candidate above 0.5 similarity, and no description was present to disambiguate"
    },
    {
      "where": "totals",
      "reason": "printed grand total (124,500) differs from sum of line totals at lowest tier (123,900) by ~0.5% — likely rounding"
    }
  ]
}
```

## Common mistakes to avoid

- **Mixing `null` and `""`**: `matchedSku` must be `null`, not `""`,
  when unresolved. Empty string is treated as a present-but-invalid
  value and rejected by the schema validator.
- **String numbers**: send `unitPrice: 49.0`, not `"49.00"`. The
  schema strictly typechecks numerics.
- **Forgetting `currency` on lines**: it's required even if it
  duplicates the top-level field. The schema treats them as
  potentially-different (some files mix currencies).
- **Submitting with `lines: []` silently**: that's allowed (for
  files that genuinely have no items) but you MUST add an
  `ambiguities` entry explaining why — otherwise it looks like a
  bug, not a deliberate empty extraction.
