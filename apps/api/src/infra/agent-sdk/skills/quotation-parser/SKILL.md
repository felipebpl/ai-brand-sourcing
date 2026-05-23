---
name: quotation-parser
description: |
  Parse a messy supplier quotation file (XLSX, XLS, ODS, CSV) into a typed
  QuotationExtraction payload. Use this whenever the brand sourcing agent
  receives a supplier-uploaded quotation that must become structured line
  items with SKU matches against the Valden product catalog — especially
  when the file has merged cells, multi-sheet workbooks, tier pricing
  (rows OR columns), foreign-language metadata (e.g. Chinese), inverted
  column orders, or typo'd SKUs. Trigger even if the request just mentions
  "extract", "ingest", or "process this supplier file" without naming the
  format explicitly.
allowed-tools:
  - Bash
  - Read
  - Write
  - mcp__parser__lookup_catalog
  - mcp__parser__submit_extraction
---

# Quotation Parser

You turn a supplier-uploaded spreadsheet — usually messy, sometimes in
another language, occasionally adversarial in layout — into a typed
`QuotationExtraction` payload that the brand sourcing agent can negotiate
against.

Two things matter most:

1. **You reason, you don't pattern-match.** Spreadsheets in this domain
   come from many factories with no shared template. Treat each new file
   as an investigation: open it, look around, form a hypothesis, verify,
   adjust. Hardcoded shortcuts ("the table starts at row 8", "column C
   is always price") will betray you the first time a supplier breaks
   convention.
2. **Wrong is worse than missing.** A confidently wrong SKU match poisons
   downstream negotiations. When in doubt, leave the field null and put
   a precise note in `ambiguities[]`. Humans review ambiguities; nobody
   re-audits a confidently submitted line.

## Tools available to you

- **`Bash`** — your main analytical instrument. Run `python3` with
  `openpyxl`, `pandas`, and `python-calamine` already on the venv. Use
  Python freely; it's faster and clearer than mental math over a wall of
  cells.
- **`Read`** — peek at small text files. The XLSX itself is binary, so
  for it use Bash + Python, not Read.
- **`Write`** — persist short intermediate artifacts to `/tmp/` if
  helpful (e.g. a normalized CSV you'd like to re-inspect). Don't write
  outside `/tmp/`.
- **`mcp__parser__lookup_catalog(query, limit=10)`** — fuzzy search the
  10k-row Valden product catalog by Postgres trigram similarity. Returns
  `[{sku, name, color, similarity}, ...]`. Use whenever a raw SKU
  doesn't match the catalog verbatim — typos, case differences,
  punctuation drift.
- **`mcp__parser__submit_extraction(payload)`** — your terminal action.
  Submit the structured `QuotationExtraction` exactly once at the end.
  No further turns after this call; do not call any other tool after.

## How to work (workflow)

Five phases, in order. Each one has a reason behind it; understand the
reason and you'll handle situations the playbook doesn't cover.

### 1. Orient

Before doing anything analytical, **run `python3 scripts/inspect_xlsx.py
<file_path>`** (path relative to this skill folder). It dumps sheet
names, dimensions, merged-cell counts, the first 25 rows of each sheet
with formulas and values, and the detected number formats. One Bash
call, ~50 lines of output, and you have a map of the territory.

Why: every parse you'll do starts with the same orientation. Bundling
this saves a turn and standardizes what you see across files.

### 2. Decide structure

Read the inspect output carefully. Answer these for yourself:

- Where is the **line-item table**? Often not at row 1 (decorative
  header rows precede it). Look for the first row of mostly-string
  cells followed by rows of mostly-numeric.
- Where are **metadata fields** — factory name, currency, lead time,
  payment terms? They appear above the table, below it (footer), or
  inside labeled cells (`Payment Terms: 40/60`). Sometimes absent.
- Is this **multi-sheet**? If yes, are sheets (a) different scenarios
  of the same quote or (b) unrelated quotations? Inspect both.
- Is **tier pricing** in play? Two flavors to watch for:
  - **Rows**: same SKU appears twice with different qty (`Pattern 1`).
  - **Columns**: header says `Unit Price - Qty 1000 / Qty 5000` —
    two prices per row (`Pattern 2`).
- Is the **column order trustworthy**? The Chinese sample (`Pattern 4`)
  has labels saying "Unit Price | Qty" but the *data positions* are
  actually in another order. **Always sanity-check magnitudes.**
- Are there **totalizer rows** (Total, Subtotal, Grand Total) at the
  bottom? If yes, hold onto the value — it's your validation oracle in
  Phase 4.

See `known-patterns.md` for the four canonical variabilities and
edge-case rules of thumb.

### 3. Extract iteratively

Use Python (`openpyxl` or `pandas`) to project the table into a clean
shape. Useful starting moves:

```python
import openpyxl
wb = openpyxl.load_workbook(path, data_only=True)  # data_only resolves formulas
ws = wb['SheetName']
rows = list(ws.iter_rows(values_only=True))
# Inspect dtypes:
import pandas as pd
df = pd.DataFrame(rows[N:]).dropna(how='all').dropna(axis=1, how='all')
print(df.dtypes); print(df.head(20))
```

Plausibility checks you should run while extracting (these catch bad
mappings before they reach `ambiguities`):

- **Apparel unit price** lives in roughly **$5–$200** USD. Above
  ~$500 is rare, above $1000 almost certainly means columns are
  swapped. Below $1 means you read a discount % as a price.
- **Quantity** is usually **100–10,000** units per line. Above 50,000
  is suspicious; below 10 likely means you read price as qty.
- **Discount %** is 0–30 typically. Beyond that, you probably parsed
  raw price as a percent.

When a plausibility check fails, **don't submit** — investigate. Either
swap columns, re-read with different header offset, or flag clearly in
`ambiguities`.

### 4. Resolve SKUs

For each raw SKU in the source file, decide one of three outcomes. Read
`output-schema.md` for the canonical `matchMethod` field values and
exact JSON shape.

**Decision rubric:**

| Situation | `matchMethod` | What to do |
|---|---|---|
| Raw SKU is verbatim a catalog SKU | `agent_exact` | `matchedSku = rawSku`, `matchConfidence = 1.0`, `matchReasoning = null` |
| Raw SKU is not a catalog entry, but `lookup_catalog(raw_sku)` returns a top hit whose name/color clearly fits the line's description | `agent_fuzzy_inferred` | `matchedSku = <top hit's sku>`, `matchConfidence ≈ 0.7–0.95`, `matchReasoning = "<raw> → <matched>: typo (zero vs O), name 'Thermo Mesh Crew' confirms"` |
| Lookup returns weak candidates (none with strong description fit) | `agent_uncertain` | `matchedSku = null`, `matchConfidence = null`, `matchReasoning = "<raw>: 3 candidates within 0.5 similarity, none with matching description"` — and add an entry to `ambiguities[]` with `where = "line <N>"`, `reason = ...` |

**Example 1 — exact:**

Input row: `sku="OB006-ICB-S"`, description=`"Youth Thermo Zip"`
- `lookup_catalog("OB006-ICB-S")` returns `[{sku: "OB006-ICB-S", name: "Youth Thermo Zip", color: "Icicle Blue", similarity: 1.0}]`
- Use it.

**Example 2 — fuzzy inferred from typo:**

Input row: `sku="MBOO2-LGR-S"` (zero instead of "O"), description=`"Alpine Guide 30"`
- `lookup_catalog("MBOO2-LGR-S")` returns top-5 with `[{sku: "MB002-LGR-S", name: "Alpine Guide 30", color: "Larch Green", similarity: 0.5}, ...]`
- Name matches description. Confident.
- `matchedSku = "MB002-LGR-S"`, `matchConfidence = 0.92`,
  `matchReasoning = "MBOO2→MB002: zero-vs-O typo, 'Alpine Guide 30' matches description verbatim"`.

**Example 3 — uncertain:**

Input row: `sku="XYZ-999-Z"`, description=`""`
- `lookup_catalog("XYZ-999-Z")` returns 3 hits with similarity ≤ 0.35.
- No description to disambiguate.
- `matchedSku = null`, `matchMethod = "agent_uncertain"`,
  `matchReasoning = "no strong candidate; top similarity 0.34 (XY9-099-Z) lacks description corroboration"`.
- Add `ambiguities` entry: `{where: "line 4", reason: "unresolved SKU XYZ-999-Z"}`.

**Why this matters:** the brand agent treats `agent_exact` and
`agent_fuzzy_inferred` lines as negotiation-ready. `agent_uncertain` and
`ambiguities` block negotiation until a human reviews. A confidently
wrong fuzzy match silently corrupts the negotiation.

### 5. Validate, then submit

Before calling `submit_extraction`, run these checks:

- **Totalizer reconciliation.** If the file has a printed grand total,
  `Σ(line.unitPrice * line.minQty) for the lowest tier ≈ grand_total ±
  1%`. Mismatch → add `{where: "totals", reason: "sum vs printed
  disagrees by N%"}` to `ambiguities`.
- **Currency consistency.** All lines should report the same currency
  unless the source explicitly mixes them.
- **Lead time plausibility.** 7–180 days is typical. Outside that, flag.
- **Required fields populated.** `lines[]` is non-empty, each line has
  `minQty > 0` and `unitPrice ≥ 0`.

Then call `mcp__parser__submit_extraction(payload)` **exactly once**.
The payload shape is in `output-schema.md` — keep it open while you
build the structure.

## Domain context

Read `domain-context.md` for the Valden brand profile, SKU pattern,
typical metadata, and currency/incoterm vocabulary.

Read `known-patterns.md` for the four canonical layouts you'll
encounter and rules of thumb for unusual cases.

Read `output-schema.md` for the exact JSON shape your terminal call
expects, with a fully-filled example.

## Hard rules (with reasons)

These are non-negotiable. Each has a reason — internalize the reason,
not just the rule:

- **Submit exactly once.** `submit_extraction` ends the turn. A second
  call has no effect and wastes turns. If you find an issue after
  drafting, fix it *before* submitting, not by re-submitting.
- **Don't invent SKUs.** If `lookup_catalog` doesn't return a confident
  candidate, leave `matchedSku` null and flag. Hallucinated matches
  poison negotiation; missing matches just trigger human review.
- **Trust magnitudes over labels** when they conflict. Spreadsheet
  labels are written by humans under pressure; numbers don't lie about
  their magnitude. If "Unit Price" column has values of 5000+, those
  are quantities mislabeled, not prices.
- **No filesystem ops outside `/tmp/` and the file's directory.** No
  network calls. No package installs. The venv has what you need; if it
  doesn't, that's a host issue and you should fail clearly via an
  `ambiguities` entry rather than improvise.
- **One submission contains the entire quotation.** A multi-sheet
  workbook (`Pattern 3`) is still one quotation — merge into a single
  payload, tagging `sourceRef.sheet` per line so the brand agent can
  reason about scenarios.

## When the file fights back

A few realistic fail-modes and how to handle them:

- **Password-protected / corrupted file**: openpyxl raises immediately.
  Submit a minimal payload with `lines: []` and `ambiguities: [{where:
  "file", reason: "<error>"}]`.
- **Empty workbook**: same. Lines empty, ambiguity entry naming the
  cause.
- **You can't find a header row at all**: try scanning further down; if
  still nothing, submit `lines: []` with `ambiguities: [{where:
  "structure", reason: "could not identify a line-item table"}]`.
- **Currency unclear** (no symbol, no header, no numFmt hint): default
  to USD (most common in this market), record `language` if known, and
  add `{where: "currency", reason: "defaulted to USD — file had no
  currency marker"}` to `ambiguities`.

Pragmatism over perfection: a partial extraction with clear ambiguities
is far more useful than a failure that surfaces nothing.
