# Architecture

## One-paragraph summary

A user uploads an XLSX quotation through the React UI. The API stores the file,
records a `Quotation` row, and dispatches an Inngest event. An Inngest workflow
parses the XLSX into structured line items (LLM + structured outputs), matches
SKUs against the product catalog, and then fans out three parallel
`Negotiation` runs — one per simulated alternate supplier — each driven by an
AI agent. While the negotiations run they stream tokens into an in-process bus;
an SSE endpoint relays those deltas to the UI. When the first round finishes,
the workflow waits up to N minutes for a `curveball` event (e.g. "Supplier 2
can only fulfill 60%"). If the event fires, the workflow re-evaluates by
running a second round of negotiation informed by the new constraint. A brand
agent then selects a winner (potentially split-sourcing across two suppliers)
with reasoning. The user reviews the recommendation and clicks "Convert to PO";
the API materializes a `PurchaseOrder` row plus line items and surfaces it in
the global PO list.

## Topology

```
┌─────────────────┐         ┌──────────────────────────────────────────────┐
│ apps/web (Vite) │  REST   │ apps/api (Hono on Bun)                       │
│ React + shadcn  │ ──────▶ │  ├── /quotations (POST upload)               │
│ TanStack Query  │  SSE    │  ├── /quotations/:id (GET, status, items)    │
│                 │ ◀────── │  ├── /quotations/:id/stream  ◀── SSE         │
│                 │         │  ├── /quotations/:id/curveball (POST)        │
│                 │         │  ├── /purchase-orders (GET list, POST issue) │
│                 │         │  ├── /docs  (Swagger UI)                     │
│                 │         │  └── /api/inngest   (Inngest handler)        │
└─────────────────┘         └──────────────┬───────────────────────────────┘
                                           │
              ┌────────────────────────────┴───────────────────────────┐
              ▼                                                        ▼
     ┌──────────────────┐                                  ┌────────────────────┐
     │ Inngest DevSrv   │                                  │ Postgres (Supabase)│
     │ Workflow runner  │   ──── drizzle ──────────────▶   │ quotation,         │
     │ + DAG UI         │                                  │ parsed_item,       │
     └──────────────────┘                                  │ product_catalog,   │
              │                                            │ supplier,          │
              ▼                                            │ negotiation,       │
     ┌──────────────────────────────┐                      │ negotiation_message│
     │ Inngest workflow steps       │                      │ winner_selection,  │
     │  1. parseXlsx                │                      │ purchase_order,    │
     │  2. matchCatalog             │                      │ purchase_order_li.. │
     │  3. negotiate (× 3 parallel) │                      └────────────────────┘
     │  4. waitForEvent(curveball)  │
     │  5. replan (× 3 if needed)   │
     │  6. selectWinner             │
     │  7. (on confirm) issuePO     │
     └──────────────┬───────────────┘
                    │
                    ▼
         ┌────────────────────────────────────────┐
         │ AI Agents (TBD framework — ADR-001)    │
         │  brand-agent      ↔  3 supplier agents │
         │  (Claude Sonnet 4.6 default;           │
         │   Opus 4.7 for winner reasoning)       │
         └────────────────────────────────────────┘
```

## Layers and responsibility

| Layer | Owns | Does NOT own |
|---|---|---|
| `apps/web` | UI rendering, optimistic state, SSE consumption, UX flow | Business rules, validation |
| `apps/api/src/routes` | HTTP transport, request/response shape, status codes | Computation, agents |
| `apps/api/src/services` | Pure-ish business logic: XLSX parse, catalog match, scoring | Persistence specifics, HTTP |
| `apps/api/src/inngest` | Workflow orchestration, step memoization, fan-out, suspend/resume | Agents themselves |
| `apps/api/src/agents` | LLM calls, prompts, persona definitions, streaming | DB writes (delegated to services) |
| `apps/api/src/db` | Drizzle schema, the typed `db` instance | Anything else |
| `packages/shared` | Zod schemas, event types, enums shared across tiers | Runtime code beyond schemas |

## Data flow: the happy path

1. **Upload.** `POST /quotations` accepts a multipart file. The API saves it
   under `apps/api/.storage/`, inserts a `quotation` row with status
   `uploaded`, and emits `quotation/uploaded`.
2. **Parse.** Inngest step `parseXlsx` reads the file, runs the parser
   pipeline (see [PARSER.md](PARSER.md)), writes `parsed_item` rows, sets
   status to `parsed`.
3. **Match.** Step `matchCatalog` runs hybrid SKU matching against
   `product_catalog`. Persists `matched_sku`, `match_confidence`,
   `match_method` on each `parsed_item`. Sets status to `matched`.
4. **Negotiate (3 in parallel).** For each of the three suppliers, step
   `negotiate-${supplierId}` creates a `negotiation` row, runs the agent loop
   (multiple turns), persists messages + offers, and returns the final
   `NegotiationOutcome`. Status becomes `negotiating`.
5. **Wait for curveball.** `step.waitForEvent('negotiation/curveball.sent',
   timeout: '30m')`. If the event arrives, all three negotiations re-run with
   the new constraint as part of their context.
6. **Pick winner.** Step `selectWinner` calls the brand agent (analytical
   model — Opus) with all three outcomes + the user's instruction + supplier
   quality ratings. Returns `WinnerSelection` (possibly split-sourcing).
   Persists `winner_selection`. Status becomes `awaiting_decision`.
7. **Issue PO.** User clicks the convert button. `POST /purchase-orders`
   inserts a `purchase_order` row + line items derived from the winning
   offer. Status becomes `completed`. The PO list pages reflect it.

## Streaming agents to the UI

Inngest steps are durable request/response — you cannot stream out of them.
The pattern this project uses:

1. Inside an Inngest step, an agent run streams tokens from Claude.
2. As each token chunk arrives, the agent publishes a `AgentDelta` event to an
   **in-process `agentMessageBus`** keyed by `quotationId`.
3. A Hono route, `GET /quotations/:id/stream`, opens an SSE connection and
   subscribes to the bus for that id, relaying every event downstream.
4. The frontend opens a single `EventSource` per quotation and the
   `useNegotiationStream` hook merges deltas into TanStack Query cache.
5. When the step finishes, only the durable, structured result (the final
   `Offer` / `Outcome`) is returned from `step.run`. Stream contents are
   ephemeral and saved as `negotiation_message` rows in the DB for replay.

## Replay and idempotency

- Inngest steps are deterministic memos. Side effects (DB writes, LLM calls)
  always go *inside* `step.run`, never around it.
- Each negotiation message carries an explicit `turn` index so replays land in
  the same order.
- The agent prompts include the negotiation history pulled from
  `negotiation_message`. That makes reasoning auditable and survives restarts.

## Out of scope (this work trial)

- Authentication / multi-tenant separation
- Production hardening (rate limits, retries beyond Inngest defaults)
- Real supplier integrations (the three suppliers are LLM-simulated)
- Currency conversion across quotations
