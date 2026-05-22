# Assets

Sample data shipped with the challenge package. Used at runtime to seed the
product catalog and during manual testing of the parser. The evaluator will
test the system with a **different** XLSX not in this folder, so the parser
must not hardcode against these specific shapes.

## Files

### `products.csv`
The brand's product catalog. Source of truth for SKU matching.

- Brand: `valden`
- ~10,052 rows
- Columns: `brand, sku, name, color`
- SKU pattern: `<family>-<color>-<size>` (e.g. `OB007-BAS-L`, `OPP010-SRD-28-26`)

### `quotation_*.xlsx` — four very different supplier layouts

Confirms why a regex/keyword parser cannot work. See `docs/PARSER.md`.

| File | Sheet(s) | Cols | Notable shapes |
|---|---|---:|---|
| `quotation_1.xlsx` | `Purchase order` | 9 | Factory address in rows 1–7, then table with `Item #`, `Description`, `Qty`, `Unit price`, `Total price`. **23 merged ranges**. Column A is entirely empty (decorative margin). |
| `quotation_2.xlsx` | `Sheet1` | 5 | **Two prices per SKU**: `Unit FOB Price - Qty 1000` and `Unit FOB Price - Qty 5000`. Quantity-break tier pricing — no quantity column at all. |
| `quotation_3.xlsx` | `Quote 1` + `Quote 2` | 6 | **Multi-sheet.** Metadata embedded as labeled rows: `Factory Name`, `Quotation Date`, `Currency`, `Payment Terms: 40/60`, `Lead Time (Days): 60`. Table includes a `Discount (%)` column. The two sheets are the same items at different volumes (1000 vs 5000). |
| `quotation_4.xlsx` | `Sheet1` | 5 | **In Chinese.** Metadata in 工厂名称 (Factory Name), 报价日期 (Date), 币种 (Currency), 交期 (Lead Time). Table columns: `SKU, 产品 (Name), 单价 (Unit Price), 数量 (Qty), 总价 (Total)` — **price comes before quantity**, opposite of the others. |

## Parser implications captured here (will flow into ADR-002)

- Header position is variable (rows 1–7 are sometimes metadata, sometimes the
  table). Region segmentation must come before any header inference.
- Column order is not stable. The parser cannot rely on positional mapping;
  it must use the LLM to map columns semantically.
- Quantity-break pricing exists (multiple price columns per row). The schema
  must allow it; flatten into multiple `ParsedLineItem` rows.
- Multi-sheet workbooks happen. Treat each sheet as an independent quotation
  region (or merge them if they're the same supplier, depending on context).
- Multi-language metadata (Chinese seen here). LLM extraction handles this
  natively; do not hardcode label translations.
- Decorative empty columns/rows occur. The pre-processor must drop them
  before serializing for the LLM, or token budget bloats.
