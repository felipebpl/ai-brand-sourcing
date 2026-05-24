# Ontology

Domain vocabulary — the source of truth for naming across code, prompts,
and UI copy. The DB schema in `apps/api/src/db/schema.ts` is the
authoritative shape; this file explains the intent.

## Entities (8)

### Product

Master data for the brand's product catalog. Seeded from
`assets/products.csv` (~10k SKUs for Valden).

| Field | Type | Notes |
|---|---|---|
| sku | text PK | e.g. `OB007-BAS-L`, `OPP010-SRD-28-26` |
| brand_id | text | default `valden`; multi-tenant ready |
| name | text | e.g. "Thermo Mesh Crew" |
| color | text \| null | e.g. "Basalt Grey" |
| attributes | jsonb | future enrichment (material, weight, compliance, etc.) |

### Supplier

The counterparty. Source supplier (who uploaded the XLSX) plus three
simulated counterparts; all are renegotiable, so the source has its
own agent persona too.

| Field | Type | Notes |
|---|---|---|
| id | text PK | `supplier-1`, `supplier-2`, … |
| name | text | display name |
| quality_score | numeric(3,2) | 0–5 (per challenge brief) |
| default_lead_time_days | int | starting position |
| default_payment_terms | jsonb | starting position |
| persona | text | system-prompt fragment driving the supplier agent |
| pricing_profile | text | `cheap` \| `mid` \| `premium` |
| reliability_score | float \| null | ML-populated future field |
| on_time_delivery_rate | float \| null | future field |

### Quotation

One row per supplier-uploaded file. **Carries the embedded recommendation**
once the brand agent decides — no separate `winner_selection` table.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| brand_id | text | default `valden` |
| source_supplier_id | fk → supplier | who sent it |
| uploaded_filename | text \| null | original filename — null while the RFQ is `awaiting_quote` |
| storage_uri | text \| null | path/url where the bytes live — null while the RFQ is `awaiting_quote` |
| user_instruction | text \| null | free-form note from upload form |
| user_instruction_intent | jsonb \| null | structured projection: `{ priority, constraints }` |
| parsed_metadata | jsonb \| null | currency, lead time, payment terms, language, ambiguities, catalog-guard summary, etc. |
| status | enum | `awaiting_quote` → `uploaded` → `parsing` → `parsed` → `negotiating` → `recommended` → `committed` (or `cancelled`/`failed`) |
| recommended_negotiation_id | fk → negotiation \| null | the current winning negotiation |
| recommendation_reasoning | text \| null | brand agent's natural-language justification |
| recommendation_comparison | jsonb \| null | supplier × dimension comparison matrix |
| recommended_at | timestamptz \| null | when the recommendation was made |
| recommendation_history | jsonb[] | superseded recommendations (curveball replans) |

### QuotationLine

Atomic unit of a quotation. Tier pricing (whether expressed as duplicated
rows or as multiple price columns) is unified via `min_qty`/`max_qty`.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| quotation_id | fk → quotation | |
| raw_sku | text \| null | as it appeared in the file |
| raw_description | text \| null | as it appeared |
| min_qty | int | tier lower bound |
| max_qty | int \| null | tier upper bound (null = open-ended) |
| unit_price | numeric(14,4) | |
| currency | text | ISO 4217 |
| matched_sku | fk → product \| null | resolved SKU |
| match_confidence | numeric(4,3) \| null | 0..1 |
| match_method | text \| null | `agent_exact` \| `agent_fuzzy_inferred` \| `agent_uncertain` |
| match_reasoning | text \| null | one-line natural-language justification |
| source_ref | jsonb \| null | `{sheet, row, col}` for traceback |
| raw_extras | jsonb \| null | discount %, source-specific fields |

### Negotiation

One thread per `(quotation, supplier)`. 4 per quotation
(source-supplier renegotiable too).

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| quotation_id | fk → quotation | |
| supplier_id | fk → supplier | |
| status | enum | `pending` → `active` → `concluded` (or `stalled`/`failed`) |
| final_unit_price_avg | numeric \| null | denormalized at conclusion |
| final_lead_time_days | int \| null | denormalized |
| final_payment_terms | jsonb \| null | denormalized |
| rounds_count | int | for analytics |
| price_concession_pct | float \| null | (initial − final) / initial |
| negotiation_duration_seconds | int \| null | wall-clock |
| winning_dimensions | text[] \| null | `['price','lead_time']` etc. |
| created_at, concluded_at | timestamptz | |

Outcome metrics are stored denormalized so future ML pipelines can
query analytics directly without replaying message history.

### NegotiationMessage

A turn in a negotiation thread.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| negotiation_id | fk → negotiation | |
| role | enum | `brand` \| `supplier` \| `system` |
| turn_index | int | monotonic per negotiation |
| content | text | natural language |
| offer | jsonb \| null | structured snapshot of the proposal at this turn |
| metadata | jsonb \| null | model used, inferred intent, event_type for system msgs |
| created_at | timestamptz | |

**System messages** are used to inject events into a thread (e.g. a
`supplier.message` event arrives — a system message is inserted with
`metadata.event_type = 'supplier_message_received'` for audit).

### PurchaseOrder

The committed deal. Immutable after `issued` (forward-only state machine
except for `cancelled`).

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| po_number | text unique | `PO-2026-0001` |
| brand_id | text | |
| quotation_id | fk → quotation | provenance |
| negotiation_id | fk → negotiation | the winning negotiation |
| supplier_id | fk → supplier | |
| status | enum | `draft` → `issued` → `acknowledged` → `fulfilled` (or `cancelled`) |
| currency | text | ISO 4217 |
| subtotal | numeric | |
| total_amount | numeric | |
| lead_time_days | int | |
| payment_terms | jsonb | |
| expected_delivery_date | timestamptz \| null | issued_at + lead_time |
| issued_at | timestamptz | |

### PurchaseOrderLine

Atomic line. Always references its originating `quotation_line_id` — full
audit trail from PO line back to the original row in the supplier file.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| po_id | fk → purchase_order | |
| quotation_line_id | fk → quotation_line | **traceability** |
| product_sku | fk → product | |
| description | text | |
| quantity | int | |
| unit_price | numeric | |
| line_total | numeric | |

## What's NOT here (and why)

- **No `QuotationDocument` separate from `Quotation`.** Single upload =
  single quotation. If multi-sheet, parser merges with `source_ref.sheet`
  tagging.
- **No `RFQ` (Request for Quotation).** Implicit at upload time; not
  modeled.
- **No `Offer` standalone table.** It's a JSONB field on
  `negotiation_message`. Current offer = latest message with `offer != null`.
- **No `WinnerSelection` standalone table.** Embedded in `quotation`.
  History as JSONB array.
- **No `SupplierEvent` table.** Events are ephemeral via Inngest;
  audit is captured as `negotiation_message` with `role: system`.

## Vocabulary contracts

- A **Quotation** is the file; an **Offer** is a structured proposal
  carried within a negotiation message; a **Recommendation** is the
  brand agent's verdict; a **PurchaseOrder** is the commit.
- **Bid** is reserved for supplier-side offers (rarely used in code —
  prefer "offer").
- **Counter** is a brand-side response to an offer.
- **Curveball** is informal — in code we always use
  `supplier.message` event.
- **Brand agent** = the orchestrating intelligence. **Supplier agent**
  = one of N counterparties. **Parser agent** = the file-parsing
  subagent.

## Naming conventions

- Entities: PascalCase singular (`Quotation`, `PurchaseOrder`).
- Tables: snake_case singular (`quotation`, `purchase_order_line`).
- Enum values: snake_case (`agent_fuzzy_inferred`).
- Files: kebab-case singular for schemas (`purchase-order.ts`).
- Currency: ISO 4217 uppercase (`USD`).
- Money: `numeric(14,4)` stored as string by Drizzle; converted at
  the boundary.
- Timestamps: `timestamp with time zone`, always UTC.
