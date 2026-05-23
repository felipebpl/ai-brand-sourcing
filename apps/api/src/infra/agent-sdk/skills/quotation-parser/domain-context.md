# Domain Context

## The brand

**Valden** — premium outdoor technical apparel. ~10,000 SKUs spanning:
- Insulated pants & bibs
- Shells & jackets
- Base layers & mid-layers
- Gloves, headwear, accessories
- Ski-/snow-adjacent gear (skis, packs, climbing accessories)

SKU pattern: `<FAMILY>-<COLOR_CODE>-<SIZE>` (and sometimes
`<FAMILY>-<COLOR_CODE>-<WAIST>-<INSEAM>` for pants). Examples:
- `OB007-BAS-L` — Thermo Mesh Crew, Basalt Grey, size L
- `OPP010-SRD-28-26` — Backcountry Insulated Pant, waist 28 inseam 26

Family prefixes carry meaning (`OB` = base layer, `OPP` = pants, `MC` =
keylocks/accessories, `EBK` = kids gloves, etc.) but you should never
need to enumerate them — `lookup_catalog` resolves any raw SKU.

## What quotations look like

These come from **manufacturing partners** (factories in Asia and Eastern
Europe, mostly). They're commercial proposals for production orders.
Each line is a SKU + quantity + unit price, often with tier pricing
(price drops at qty thresholds).

Metadata that may or may not appear:
- Factory name and address
- Quotation date
- Currency (often USD; sometimes local — convert on parsing)
- Payment terms (e.g. `33/33/33`, `40/60`, `30/70`, `100% upfront`,
  `Net 30`)
- Lead time in days (e.g. `60`, `90`, `120`)
- Incoterms (`FOB`, `EXW`, `DDP`, sometimes implicit in column names like
  "Unit FOB Price")
- Discount % per line
- Totals (often as a SUM() formula at the bottom)
