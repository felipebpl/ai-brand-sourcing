# Architecture

## One-paragraph summary

A user uploads an XLSX quotation through the React UI. The API stores
the file, inserts a `quotation` row, and emits `quotation.uploaded` to
Inngest. A handler runs the **parse-and-persist pipeline** — invoking
the **parser subagent** (Claude Sonnet 4.6 with the `quotation-parser`
skill, running Python via Bash) to extract structured line items and
resolve SKUs against the catalog (Postgres `pg_trgm` fuzzy lookup) —
then opens **3 parallel negotiations** (one per supplier from the
challenge brief; the source supplier from the XLSX is renegotiable
too). Each supplier is an **independent Claude session** (Haiku 4.5)
with its own persona, communicating with the brand through
`negotiation_message[]` rows — not a subagent of the brand. The brand
agent (Opus 4.7) orchestrates multi-round dialogue, then emits a
**Recommendation** with reasoning. The user clicks "Convert to PO" to
materialize a Purchase Order. At any point in the system's life, a
`supplier.message` event (the canonical curveball channel) can land
and trigger a re-evaluation — the brand decides whether to keep the
current recommendation, swap winner, or renegotiate.

## Topology

```
┌─────────────────┐         ┌────────────────────────────────────────────────┐
│ apps/web (Vite) │  REST   │ apps/api (Hono on Bun)                         │
│ React + shadcn  │ ──────▶ │  ├── POST /rfqs                (create empty)  │
│ TanStack Query  │  SSE    │  ├── POST /quotations/:id/quote (attach file)  │
│                 │ ◀────── │  ├── POST /quotations          (legacy upload) │
│                 │         │  ├── POST /supplier-messages   (curveball UI)  │
│                 │         │  ├── POST /purchase-orders     (convert button)│
│                 │         │  ├── GET  /quotations · /quotations/:id        │
│                 │         │  ├── GET  /quotations/:id/stream  (SSE)        │
│                 │         │  ├── GET  /purchase-orders · /:id              │
│                 │         │  ├── /docs (Swagger), /openapi.json            │
│                 │         │  └── /api/inngest (Inngest handler)            │
└─────────────────┘         └─────────────────┬──────────────────────────────┘
                                              │
                ┌─────────────────────────────┴───────────────────────────────┐
                ▼                                                             ▼
       ┌──────────────────────┐                                  ┌───────────────────┐
       │ Inngest event-driven │                                  │ Postgres          │
       │ functions:           │                                  │ (Supabase local)  │
       │  • handle.quotation- │   ◀── drizzle ──────────────▶   │ ext: pg_trgm      │
       │    uploaded          │                                  │                   │
       │  • handle.supplier-  │                                  │ tables:           │
       │    message           │                                  │ • product         │
       │  • handle.po-        │                                  │ • supplier        │
       │    requested         │                                  │ • quotation       │
       │                      │                                  │ • quotation_line  │
       │ idempotency=hash(...)│                                  │ • negotiation     │
       └──────────┬───────────┘                                  │ • negotiation_msg │
                  │                                              │ • purchase_order  │
                  ▼                                              │ • po_line         │
       ┌────────────────────────────────────────────┐            └───────────────────┘
       │ Claude Agent SDK adapters                  │
       │  (src/infra/agent-sdk/)                    │
       │   ┌───────────────────────────────────┐    │
       │   ┌───────────────────────────┐            │
       │   │ Parser Subagent (Sonnet)  │            │
       │   │   skill: quotation-parser │            │
       │   │   tools: Bash, Read,      │            │
       │   │     mcp__parser__*        │            │
       │   │   Python via Bash for     │            │
       │   │     openpyxl/pandas       │            │
       │   └───────────────────────────┘            │
       │                                            │
       │   ┌─────────────────────────────────────┐  │
       │   │ Brand Agent (Opus 4.7) — Step 5     │  │
       │   │   tools: mcp__brand__*              │  │
       │   │   orchestrates rounds; reads/       │  │
       │   │   writes negotiation_message rows;  │  │
       │   │   calls Supplier adapters in parallel│  │
       │   │   output: Recommendation            │  │
       │   └─────────────┬───────────────────────┘  │
       │                 │                          │
       │   ┌─────────────▼─────────────────────────┐│
       │   │ Supplier Agents × 3 (Haiku 4.5)        ││
       │   │   independent Claude sessions          ││
       │   │   one per persona (S1/S2/S3)           ││
       │   │   information-asymmetric (each sees    ││
       │   │     only its own negotiation_message[])││
       │   │   channel = DB rows, NOT Agent tool    ││
       │   │   structured output: counter_offer /   ││
       │   │     accept / walk_away / clarification ││
       │   └────────────────────────────────────────┘│
       └────────────────────────────────────────────┘

       UI streaming bus:
       Hooks (PreToolUse, PostToolUse) → in-process EventBus → Hono SSE
```

## Layers and responsibility

| Layer | Owns | Does NOT own |
|---|---|---|
| `apps/web` | UI rendering, SSE consumption, UX flow | Business rules |
| `apps/api/src/routes` | HTTP transport, request/response shape | Computation, agents |
| `apps/api/src/domain` | Pure types + ports (interfaces) | Implementations |
| `apps/api/src/infra/agent-sdk` | Every line that touches `@anthropic-ai/claude-agent-sdk` | Domain logic |
| `apps/api/src/inngest/functions` | Workflow orchestration (event-triggered durable execution) | Agents themselves |
| `apps/api/src/db` | Drizzle schema, the typed `db` instance | Anything else |
| `packages/shared` | Zod schemas, event types | Runtime beyond schemas |

## Event catalog

Three Inngest events drive the system. Two are user-driven (specific
payloads); one is the canonical **supplier-side channel** (generic free-
form message, parsed by the brand agent).

| Event | Trigger | Handler |
|---|---|---|
| `quotation.uploaded` | User upload via UI | `handle.quotation-uploaded` — parse → negotiate → recommend |
| `supplier.message` | UI form simulating any inbound (curveball case) OR future email/webhook | `handle.supplier-message` — brand agent re-evaluates |
| `purchase-order.requested` | User clicks "Convert to PO" | `handle.po-requested` — materialize PO row + lines |

**No event for "curveball" specifically.** Curveballs (`Supplier 2 can
only fulfill 60%`) are a particular `supplier.message` whose content is a
natural-language note — the brand agent interprets the delta and decides
whether to keep, swap, or renegotiate. New curveball flavors (price
changes, lead time slips, walk-aways) cost zero new code — just new
content in the same event.

## Data flow: the happy path

1. **Create RFQ.** `POST /rfqs` inserts a `quotation` row with status
   `awaiting_quote` — `uploaded_filename` and `storage_uri` are nullable
   and stay null at this point. The UI navigates into the RFQ workspace
   in awaiting-reply state. A starter `awaiting_quote` row is also
   seeded by `bun db:seed` so the first demo run always has one ready.

2. **Attach quote.** `POST /quotations/:id/quote` accepts a multipart
   file + optional `userInstruction`, saves the bytes under the storage
   path (local fs by default), updates the existing row to status
   `uploaded`, and emits `quotation.uploaded`. (The legacy
   `POST /quotations` route still creates + uploads in one step for
   backward compatibility, but the canonical flow is create-then-attach.)

3. **Parse.** Brand agent boots, invokes parser agent via
   `Agent('parser', filePath)`. Parser agent runs Python via Bash, reads
   the XLSX iteratively (using `openpyxl`), resolves raw SKUs via
   `lookup_catalog` tool, and calls `submit_extraction` to return a
   typed `QuotationExtraction`. `quotation_line` rows persisted via
   `persistParseResult`, which applies a **catalog guard**: every
   `matched_sku` is validated against `product.sku` before insert;
   orphans are demoted to `agent_uncertain` + appended to `ambiguities[]`
   so a single bad match never crashes the whole batch. Status becomes
   `parsed`.

4. **Negotiate.** Brand agent opens **3 negotiations** (one per supplier
   from the challenge brief; the source supplier from the XLSX is
   renegotiable too). For each round: parallel
   `supplierAdapter.respond({ negotiationId, brandMessage, … })` calls
   across the 3 supplier instances. Each supplier is an independent
   Claude session — same `ClaudeSupplierAgentAdapter` class, different
   `profile` injected per instance — communicating with the brand via
   `negotiation_message` rows. Each supplier reads only its own
   thread (filtered by `negotiation_id` in SQL), preserving information
   asymmetry. Brand evaluates responses, decides whether to push another
   round or to conclude. Status becomes `negotiating`. See
   [NEGOTIATION.md](NEGOTIATION.md) for the loop detail and ADR-015
   for the "independent sessions vs subagent" choice.

5. **Recommend.** Brand agent submits a `Recommendation` (single winner
   in this scope per the team's guidance — split-sourcing not modeled
   first-class but possible via the curveball replan flow). Comparison
   matrix + reasoning saved in `quotation`. Status becomes `recommended`.

6. **Curveball (optional, can happen any time).** If a `supplier.message`
   event arrives — at any point during the run, after recommendation,
   or even after PO if we wanted to model that — `handle.supplier-message`
   re-invokes the brand agent with the new context. Brand agent decides:
   keep / swap / renegotiate. Previous recommendation pushed into
   `quotation.recommendation_history`; new one becomes current.

7. **Convert to PO.** User clicks "Create Draft Order" → confirms in the
   Place Order modal → `POST /purchase-orders` → emits
   `purchase-order.requested`. Handler reads the current recommendation,
   materializes a `purchase_order` + `purchase_order_line` rows (each
   line references the originating `quotation_line_id` for end-to-end
   traceability). Status becomes `committed`. PO shows up in the
   `/orders` list and detail view.

## Why this shape

- **Brand agent IS the orchestrator** — not a hidden imperative loop in
  TypeScript. It plans, decides number of rounds, chooses winner, reacts
  to events. Inngest is durable wrap, not micro-orchestrator.
- **Subagents from the Agent SDK** model supplier conversations
  naturally; each `Agent()` call is fire-and-forget per round, exactly
  the pattern Anthropic recommends for multi-agent (info asymmetric)
  flows.
- **Custom skill carries domain context**, not Excel mechanics. Claude
  already knows how to run `openpyxl` via Bash — the skill teaches it
  about *this brand's* quotations.
- **Event-driven beats stepped flow** — a `supplier.message` is a real
  inbound event, not a hardcoded `step.waitForEvent`. Handles arbitrary
  reactive flows over the system's lifetime without code changes.
- **Port-and-Adapters keeps the framework swappable** — domain stays
  pure, all SDK touchpoints localized to `infra/agent-sdk/`.

## Streaming agents to the UI

Inngest steps are durable request/response — you cannot stream out of
them. Pattern:

1. Inside an Inngest step, agent activity streams tokens.
2. Lifecycle hooks (`PreToolUse`, `PostToolUse`, plus token-level events
   from `includePartialMessages: true`) publish `AgentEvent` to an
   **in-process EventBus** keyed by `quotation_id`.
3. `GET /quotations/:id/stream` (Hono SSE) subscribes to the bus and
   relays events to the frontend.
4. Frontend `useNegotiationStream(quotationId)` opens an `EventSource`
   and merges events into TanStack Query cache.
5. The step persists only the durable, structured result to DB
   (`Recommendation`, `quotation_line[]`, etc.). Stream contents are
   ephemeral.

## Replay and idempotency

- Inngest steps are deterministic memos. Side effects (DB writes, LLM
  calls) always inside `step.run`, never around.
- Idempotency key on `handle.quotation-uploaded`: `sha256(file_bytes) +
  parser_version`. Re-upload = no duplicate work.
- `negotiation_message.turn_index` is explicit so replays land in order.
- Brand agent state survives across handlers via custom `SessionStore`
  (Postgres) — Inngest worker can be on a different host between events.

## Local-only setup

This is a clone-and-run trial. No Docker for the app itself — just Bun.
The only Docker dependency is the Supabase CLI (one-shot Postgres+Studio).
Python (`openpyxl`, `pandas`) is installed in a local venv that the parser
agent invokes via `Bash`. See [SETUP.md](SETUP.md).

For production scale considerations (Cloud Run, batch APIs, hot-path
caching), see [SCALING.md](SCALING.md) — explicitly out of scope for the
trial.

## Out of scope (this work trial)

- Authentication / multi-tenant separation (single hardcoded brand `valden`).
- Real supplier integrations (suppliers are LLM-simulated).
- Currency conversion across quotations.
- Split-sourcing as first-class output (per team guidance — modeled only
  as an option the brand agent can choose during curveball replan).
- Long-term performance tracking of suppliers (schema is prepared via
  nullable fields but not populated).
