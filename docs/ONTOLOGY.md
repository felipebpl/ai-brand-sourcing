# Ontology

The single source of truth for domain vocabulary. If a term appears in code,
prompts, or UI copy, it should match its definition here.

## Entities

### Quotation

A supplier-uploaded XLSX file representing a commercial proposal. It is the
**input** to the system. Always has a `sourceSupplierId` (the supplier who
sent it).

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| uploadedFilename | string | original filename, for audit |
| sourceSupplierId | string | supplier id who sent it |
| userInstruction | string \| null | free text — e.g. "prioritize lead time" |
| status | QuotationStatus | see below |
| extraction | jsonb | full structured extraction once parsed |

`QuotationStatus`: `uploaded → parsing → parsed → matched → negotiating →
awaiting_decision → completed | failed`.

### ParsedItem

A single line in a Quotation, after structured extraction.

| Field | Type | Notes |
|---|---|---|
| rawSku | string \| null | as it appeared in the XLSX |
| description | string | always present |
| quantity, unitPrice, lineTotal, unit, currency | numeric/string | |
| matchedSku | string \| null | post-matching, references `productCatalog.sku` |
| matchConfidence | numeric(0..1) \| null | |
| matchMethod | `exact` \| `bm25` \| `embedding` \| `llm_judge` \| `manual` |
| rawConfidence | numeric(0..1) \| null | extractor's self-reported confidence |

### ProductCatalog

The brand's source of truth for SKUs. Seeded from `assets/products.csv`.

### Supplier

A counterparty. Three are simulated by AI agents (see [NEGOTIATION.md]).

| Field | Type | Notes |
|---|---|---|
| id | string | `supplier-1`, `supplier-2`, `supplier-3` |
| qualityScore | numeric(0..5) | persistent quality rating |
| defaultLeadTimeDays | int | starting point |
| defaultPaymentTerms | jsonb | e.g. `[{percent: 100, dueDays: 0}]` |
| persona | string | system-prompt fragment defining the agent's stance |
| pricingProfile | string | `cheap`, `mid`, `premium` |

### Negotiation

A multi-turn dialogue between the brand agent and one supplier agent.
Outcome is a `NegotiationOutcome` (final offer + rationale + quality + total
cost) which feeds the `WinnerSelection`.

### NegotiationMessage

A single turn in a `Negotiation`. Role is `brand`, `supplier`, or `system`.
Stores both human-readable `content` and the structured `offer` when present.

### NegotiationOffer

A structured commercial proposal:

```ts
{
  productSku: string,
  quantity: number,
  unitPrice: number,
  leadTimeDays: number,
  paymentTerms: { installments: { percent, dueDays }[], display: string },
  currency: 'USD' | 'BRL' | 'EUR',
  fulfillablePercent: number,  // 1.0 = full order; 0.6 = curveball case
  validUntil: string | null,
}
```

### WinnerSelection

The brand agent's verdict at the end of negotiation. May be **single-source**
(one supplier wins outright) or **split-sourced** (e.g. 60% from S2 because of
quality + 40% from S3 because of lead time).

```ts
{
  primary: NegotiationOutcome,
  splitWith: NegotiationOutcome[],
  reasoning: string,
  tradeoffs: string[],
}
```

### PurchaseOrder

The durable commitment. Produced when the user clicks "Convert to PO" on a
`WinnerSelection`. In a real system this triggers supplier notification,
inventory locks, and payment workflows — we model it as a real commit action
even though those downstream effects are out of scope.

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| poNumber | string | human-readable, e.g. `PO-2026-0042` |
| quotationId, negotiationId, supplierId | fk | provenance |
| status | PurchaseOrderStatus | `draft → issued → acknowledged → fulfilled` |
| currency, subtotal, totalAmount | num | |
| leadTimeDays | int | |
| paymentTerms | jsonb | |
| lineItems | rel | child rows in `purchase_order_line_item` |

## Naming conventions

- **Entities**: PascalCase singular (`Quotation`, not `Quotations`).
- **Tables**: snake_case singular (`quotation`, `parsed_item`).
- **Enum values**: snake_case (`awaiting_decision`).
- **Files holding multiple related schemas**: kebab-case singular
  (`packages/shared/src/purchase-order.ts`).
- **Currency**: ISO 4217 three-letter (`USD`, `BRL`, `EUR`). Always uppercase.
- **Money**: stored as `numeric(14,4)` in Postgres. Converted at the boundary.
- **Time**: `timestamp with time zone`, always UTC.

## Vocabulary contracts

- A **quote** is *not* a `Quotation`. Avoid the word "quote" alone — say
  "quotation" (the file) or "offer" (a structured proposal).
- **Bid** is reserved for supplier-side offers within a negotiation.
- **Counter** is a brand-side counter-offer.
- **Curveball** is the canonical name for the mid-negotiation event that
  changes constraints. Do not call it "twist" or "change request" in code.
