# Glossary

Quick references for nomenclature that recurs across code, docs, and prompts.

| Term | Meaning |
|---|---|
| **Quotation** | The XLSX file uploaded by the brand user. *Not* a "quote." |
| **Offer / Bid** | A structured commercial proposal from a supplier. |
| **Counter** | A brand-side response to an offer. |
| **Curveball** | The mid-negotiation event that changes constraints. |
| **Split-sourcing** | Awarding the same order across two suppliers. |
| **Outcome** | The final state of a single supplier's negotiation. |
| **Winner selection** | The brand agent's verdict across all negotiations. |
| **Convert to PO** | The user's commit action: materializes a Purchase Order. |
| **Brand agent** | The single AI agent acting on the brand's behalf. |
| **Supplier agent** | One of three AI-simulated suppliers. |
| **Catalog** | The brand's source of truth for SKUs (`products.csv`). |
| **Confidence** | A self-reported `[0, 1]` from the parser or matcher. |
| **Ambiguity** | A flagged uncertainty from the parser, persisted as `{where, reason}`. |
| **Aggregate row** | A totalizer/subtotal/discount/freight row in a XLSX; used as a validation oracle, never dropped. |
| **Markdown-KV** | The serialization format we feed the parser LLM. Empirically beats CSV on tabular extraction. |
| **Hybrid match** | Canonical-exact → BM25 → embeddings → RRF → LLM-as-judge. |
| **Reciprocal Rank Fusion (RRF)** | Score-free rank fusion: `score(doc) = Σ 1/(k + rank_i)`. We use k=60. |

## Naming patterns

- Inngest events: `<domain>/<verb>.<state>` — e.g. `quotation/uploaded`,
  `negotiation/curveball.sent`.
- API routes: REST plural — `/quotations`, `/purchase-orders`.
- DB tables: snake_case singular — `quotation`, `negotiation_message`.
- Enum values: snake_case — `awaiting_decision`.
- Frontend hooks: `useXxx` camelCase — `useNegotiationStream`.
