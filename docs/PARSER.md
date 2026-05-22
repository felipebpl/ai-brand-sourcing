# Parser

> **Status: TBD — gated on ADR-002.** This file holds the *direction*; the
> concrete implementation lands when we close ADR-002.

## Why this matters

The evaluator will test the system with an XLSX file we have not seen. The
parser must therefore be **layout-independent**, not a regex/keyword glue
tuned for the sample files. The user's standing rule: no intent capture via
regex/keywords. Use a typed LLM call grounded in an explicit grid.

## Direction (likely)

1. **Read** with SheetJS, requesting full metadata:

   ```ts
   XLSX.read(buffer, {
     cellStyles: true,
     cellNF: true,
     cellDates: true,
     sheetStubs: true,
   });
   ```

2. **Pre-process deterministically:**
   - Enumerate sheets; collect `!merges`, `!comments`, `!ref`.
   - Forward-fill merged regions (write the master value to all subcells)
     respecting orientation (row-merge = belongs-to-cells-below;
     column-merge = group label).
   - Segment data regions via BFS over non-empty cells, split by ≥ 2 blank
     rows/cols or by dtype-profile discontinuities (catches single-row
     separators between sub-tables).
   - Collapse multi-row headers into single strings (`"Preço Unitário /
     R$ / Sem ICMS"`).
   - Tag totalizer rows (`role: 'aggregate'`) — **do not drop them**;
     they're the validation oracle.
   - Capture stray cells (comments, isolated annotations) into a metadata
     bag with positional hints.

3. **Serialize** each region as **Markdown-KV** for the LLM. Markdown-KV
   beats CSV on tabular extraction benchmarks (60.7% vs 44.3% accuracy on
   the public study). Include locale hints from `numFmt`.

4. **Extract** with Claude Sonnet 4.6 + structured outputs:
   - System prompt + product-catalog summary cached via
     `cache_control: ephemeral` (refresh per ~5 min).
   - Output validated against the `QuotationExtraction` Zod schema in
     `packages/shared`.
   - Each line item carries `confidence` and an `ambiguities[]` array.

5. **Vision fallback** for regions below confidence threshold:
   - LibreOffice headless converts the workbook page to PDF, then to PNG.
   - Crop the suspect region; do not vision-bomb the whole sheet (image
     tokens dominate cost).
   - Same Zod schema, same prompt.

6. **Validate** with the totalizer oracle:
   - Σ line_total ≈ grand_total (tolerance for tax) → if mismatch, push
     into `ambiguities[]` and surface for review.
   - Currency consistency across rows.

7. **SKU match** against `product_catalog`:
   - Canonicalize: lowercase, strip `[-._/\s]`, collapse whitespace.
   - Stage A: exact canonical match → score 1.0.
   - Stage B: BM25 over `sku + name + aliases` (npm `wink-bm25-text-search`).
   - Stage C: voyage-3-large embeddings, cosine top-K (catalog pre-indexed
     at startup).
   - Stage D: Reciprocal Rank Fusion (k=60) over B + C, top-3.
   - Stage E: if top-1 margin > θ, accept. Otherwise call Claude as a
     judge: "pick_sku" tool with the top-3 + raw description.
   - Persist `matchedSku`, `matchConfidence`, `matchMethod`.

## Failure handling

- **Locked / password-protected XLSX:** detect early, fail fast with a
  clear user message.
- **Vision call timeout:** retry once, then accept text-only result with
  reduced confidence.
- **Structured output Zod rejection:** retry up to N times (handled by
  Anthropic SDK); on final failure, persist the raw response in
  `ambiguities[]`.

## What "magnífico" means in this context

- Handles a XLSX the developer has never seen, with merged headers,
  totalizer rows, and a price block with mixed `R$` / `USD` notation.
- Every parsed item has an auditable confidence score and a method tag.
- Cost stays bounded by aggressive prompt caching (catalog + system in
  the cache; per-file marginal cost ≈ $0.02–0.05).
- Total time-to-parse ≤ 10s wall-clock for a typical 5–15 line quote.

## Open questions (block ADR-002)

- Exact threshold for vision fallback?
- Catalog size — embedding pre-index or LLM judge directly?
- Multi-sheet quotations — do we parse all, or only the first?
