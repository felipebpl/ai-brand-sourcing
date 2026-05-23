# Decisions

ADRs (Architecture Decision Records) — all locked-in for this trial.

The format: each ADR has a one-line decision, the rationale, and what was
considered and rejected.

---

## ADR-000 — Build to the target startup's stack

**Status:** Accepted.

**Decision:** Adopt **Hono + Bun + Inngest + Postgres + Drizzle + Vite +
React + TanStack Query + shadcn/ui**. Anthropic Claude is the LLM family.

**Rationale:** The work trial's first-order metric is "would the team use
this code in their product?" Matching the stack maximizes that probability.

---

## ADR-001 — Agent framework: Claude Agent SDK

**Status:** Accepted.

**Decision:** Use **`@anthropic-ai/claude-agent-sdk`** (TypeScript) for
all agents (brand, parser, suppliers).

**Rationale:**
- Anthropic builds the harness closest to the models, so capabilities
  (skills, structured outputs, hooks, sessions) ship there first.
- Native peer-to-peer-ish subagent pattern via `Agent` tool fits the
  brand-orchestrator-with-suppliers shape.
- Skill system lets us package domain knowledge (the
  `quotation-parser` skill) cleanly.
- Multi-model orchestration is native — brand=Opus, parser=Sonnet,
  suppliers=Haiku.

**Rejected:** Mastra (no peer-to-peer multi-agent natively until very
recently; less aligned to Anthropic's release cadence; more abstraction
to fight when something breaks).

**Modular guard:** every Agent SDK touchpoint lives in
`src/infra/agent-sdk/`. Domain code never imports from
`@anthropic-ai/claude-agent-sdk`. Swapping frameworks one day = rewrite
that folder only.

**Production hygiene (always set):**
- `settingSources: []` — never load `~/.claude/*` from the host.
- `tools: []` for the brand agent (only `Agent` + custom MCP tools).
- `permissionMode: 'dontAsk'` — deny anything not in `allowedTools`.
- `sessionStore` = Postgres-backed adapter (workers cross-host on
  Inngest).

---

## ADR-002 — Parser pipeline: agent + skill, Python via Bash

**Status:** Accepted.

**Decision:** A **parser subagent** with the `quotation-parser` skill
loaded. Skill carries domain context (brand profile, known patterns).
Agent runs Python via Bash (`openpyxl`/`pandas`) to inspect and extract,
resolves SKUs via the `lookup_catalog` MCP tool (Postgres `pg_trgm`),
and submits a typed `QuotationExtraction` via the terminal
`submit_extraction` tool.

**Rationale:**
- Anthropic's official Claude Code skill for xlsx is Python-based for
  good reason: openpyxl/pandas have a decade of battle-testing against
  every XLSX horror.
- Agent iteration ("read file → see structure → adjust → read again")
  is what gives resilience to formats we've never seen. Pipeline-based
  TS parsers crack silently on unfamiliar shapes.
- Skill packaging keeps domain knowledge editable as a Markdown file,
  not buried in code. Adding a new format (PDF, DOCX) later is a new
  skill, not a new pipeline.

**Rejected:**
- TS-only pipeline with ExcelJS + hand-written segmentation/header
  detection — fragile to unknown layouts.
- BM25 + embeddings + RRF + LLM judge as a separate matching pipeline —
  overkill when the parser agent is already there with full context.
  We use a single `lookup_catalog(query, limit)` tool backed by
  `pg_trgm` and let the agent reason about candidates.
- Vision fallback as a primary path — defer to future iteration if
  text + Python proves insufficient (it should not for typical XLSX).

**Hard caps:** `maxTurns: 20`, `maxBudgetUsd: 0.20`, `timeout: 60s` per
file. Confidence < threshold OR oracle violation → flag in
`ambiguities[]` for human review.

---

## ADR-003 — ORM: Drizzle

**Status:** Accepted. TS-native, Zod-friendly, `push` mode for fast
iteration. Driver: `drizzle-orm/node-postgres` with `pg.Pool`.

---

## ADR-004 — Local Postgres: Supabase CLI

**Status:** Accepted. `supabase start` boots Postgres + Studio locally.
Mirrors the target's prod environment.

**Trade-off:** Storage container can be flaky on first boot; we disable
`storage` in `supabase/config.toml` since this project doesn't use it.

**Required Postgres extension:** `pg_trgm` (for fuzzy SKU lookup tool).

---

## ADR-005 — Workflow orchestration: Inngest

**Status:** Accepted. Event-driven (not stepped). 3 events:
`quotation.uploaded`, `supplier.message`, `purchase-order.requested`.
Each event has its own handler function. **No hardcoded
`waitForEvent` for the curveball** — `supplier.message` is the generic
inbound channel.

---

## ADR-006 — Streaming bus: in-process pub/sub

**Status:** Accepted. Inngest steps cannot stream out. We publish
`AgentEvent` via an in-process EventBus and relay through Hono SSE.
Durable state goes to Postgres.

---

## ADR-007 — Authentication: out of scope

**Status:** Accepted. Hardcoded `brand_id = 'valden'` everywhere.

---

## ADR-008 — Supplier events: generic, not specific

**Status:** Accepted.

**Decision:** Use **one event** for any supplier-side change:
`supplier.message`. Payload is the natural-language content.
The brand agent parses it and extracts the structured delta
(capacity / price / lead time / payment terms / intent).

**Rejected:** specific event types (`supplier.capacity_changed`,
`supplier.price_changed`, etc.) — they multiply forever and one
real-world message can change multiple dimensions at once.

**UI:** "Send supplier message" form (supplier dropdown + free textarea).
Maps 1:1 to a real-world inbound email/whatsapp ingestion later.

---

## ADR-009 — SKU matching: agent-first via lookup_catalog tool

**Status:** Accepted.

**Decision:** No separate matcher module. The parser agent does the
matching during extraction, using the **`lookup_catalog(query, limit)`
MCP tool**. Tool implementation: trigram similarity via Postgres
`pg_trgm` extension. Agent picks the right match using contextual
reasoning (description, color) and reports `match_method` +
`match_reasoning` on each line.

**Rejected:** BM25 + embeddings + RRF + LLM judge pipeline — overkill
for ~10k SKUs and not needed when an LLM is already reasoning about
each line. Voyage API key would be an extra dependency.

---

## ADR-010 — Model tiers

**Status:** Accepted.

| Task | Model | Why |
|---|---|---|
| Brand agent (planner, judge, recommendation, react-to-supplier-message) | **Opus 4.7** | Reasoning depth, decision quality, audit-ready reasoning |
| Parser agent (iterative XLSX extraction) | **Sonnet 4.6** | Strong tool use, structured output, much cheaper than Opus |
| Supplier agents (persona-driven dialogue) | **Haiku 4.5** | Personas are fixed playbooks; cheap & fast |
| User instruction intent extraction | **Haiku 4.5** | Light classification |

Centralized in `apps/api/src/infra/agent-sdk/model-router.ts`.

---

## ADR-011 — Local-only execution; no Docker for the app

**Status:** Accepted.

**Decision:** The app runs natively on Bun + a local Python venv. The
only Docker dependency is the Supabase CLI (for local Postgres). README
gives a 6-command clone-and-run.

**Future-scale notes** moved to [SCALING.md](SCALING.md), explicitly out
of scope for the trial.

---

## ADR-012 — Single supplier wins (no first-class split-sourcing)

**Status:** Accepted (per team guidance during scoping).

**Decision:** The recommendation always names one winning negotiation.
The schema (recommendation_history JSONB) can capture split-sourcing if
the brand agent chooses it during a curveball replan, but UI and PO
flow treat single-supplier as the default.

---

## Standing conventions (not ADRs)

- Conventional commits (`feat:`, `fix:`, `chore:`, …).
- No `--no-verify`. If a hook fails, diagnose root cause.
- No "Generated with Claude Code" footer on PRs.
- One package manager: `bun`. No `npm install`.
- Don't introduce a new third-party dependency without alignment.

## Reviewing this document

If you (a coding agent) feel you need to make a decision that
contradicts something here, **stop and surface it**. The user wants to
make those calls.
