# Known Patterns of Quotation Variability

Four sample quotations are bundled at `assets/quotation_*.xlsx` and they
collectively span the kinds of variability you'll meet in the wild.

## Pattern 1 — Header-heavy layout, tier pricing as duplicated rows

> Example: `quotation_1.xlsx` from "Thai Textiles"

- Rows 1–7: factory address, "Quotation" label, date.
- Row 8: column headers (`Item #`, `Description`, …, `Qty`, `Unit price`,
  `Total price`).
- Rows 9+: line items. **Same SKU may appear twice** with different
  quantities (e.g. qty 500 and qty 5000) — tier pricing expressed as
  duplicated rows. Treat each row as a separate `quotation_line` with
  its own `min_qty`.
- 23 merged cell ranges.
- Column A entirely empty (decorative margin).
- `Total price` column contains formulas (`=PRODUCT(F17, G17)`); read
  the computed values (`data_only=True`) or compute yourself.

## Pattern 2 — Tier pricing as separate columns, footer metadata

> Example: `quotation_2.xlsx` (Sheet1)

- Row 1: headers `Item | Unit FOB Price - Qty 1000 | Unit FOB Price -
  Qty 5000`.
- Rows 2+: line items. **Two price columns per SKU**, one per tier.
  Expand into multiple `quotation_line` rows (one per tier) with
  `min_qty=1000` and `min_qty=5000`.
- Footer rows after the table: `Payment | 30/70` and `Lead Time | 90
  days`.
- Common typos: `MBOO2` (zero instead of O), `0PP027` (zero instead of
  O). These are normal — resolve via `lookup_catalog`.

## Pattern 3 — Metadata at top, discounts, multi-sheet

> Example: `quotation_3.xlsx` with sheets "Quote 1" and "Quote 2"

- Rows 1–5: labeled metadata (`Factory Name:`, `Quotation Date:`,
  `Currency:`, `Payment Terms:`, `Lead Time (Days):`).
- Row 6: column headers (`Item No. | Style/SKU ID | Quantity (Pcs) |
  FOB Price | Discount (%) | Total`).
- **Two sheets** are scenarios — same items at different volumes (1000
  variable vs 5000 fixed). For this trial, merge into a single
  Quotation with both sets of lines (mark `sourceRef.sheet` so the
  brand agent knows which scenario each line came from); the brand
  agent can decide whether to compare both scenarios or pick one.
- Discount column applies per line — compute net unit price.
- Common typos: `OBS` vs `0BS`, `lCB` (lowercase L instead of I).

## Pattern 4 — Chinese labels, swapped column order

> Example: `quotation_4.xlsx` (Sheet1)

- Rows 1–4: metadata in Chinese (`工厂名称` factory name, `报价日期`
  quotation date, `币种：美元（USD` currency, `交期（天）` lead time).
- Row 5: column headers (`SKU | 产品 (product) | 单价 (unit price) |
  数量 (qty) | 总价 (total)`).
- **Column order trap**: even though the label `单价` means unit price
  and `数量` means qty, the actual data positions may have them in the
  literal column order shown in the header (price-before-qty), which
  is the **opposite** of patterns 1 and 3. **Always verify** by
  plausibility — apparel unit prices are usually $5–$200; quantities
  are usually 100–10000. If you see "$5000" as unit price, columns are
  swapped.

## General rules of thumb

- **Headers are not always in row 1.** They may be at row 5, 6, 8 — find
  them by looking for a row of mostly-string cells followed by mostly-
  numeric cells.
- **Column A may be empty** (decorative margin). Strip empty leading
  columns before extracting.
- **Totalizer rows** at the bottom are useful validation oracles —
  reconcile the sum of line totals with the printed grand total. If
  they disagree by more than 1%, flag in `ambiguities`.
- **Multi-sheet workbooks** may be either (a) separate scenarios for
  the same items, or (b) entirely separate quotations. Inspect both
  sheets and decide based on whether SKUs overlap and metadata
  matches. For the trial, default to merging into one Quotation if the
  same factory is named in both.
