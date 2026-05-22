# Decisions

ADRs (Architecture Decision Records) — locked-in and pending.

The format: each ADR has a one-line decision, the rationale, and what was
considered and rejected. Pending ADRs ("TBD") describe the question and the
options being weighed.

---

## ADR-000 — Build to the target startup's stack

**Status:** Accepted.

**Decision:** Adopt **Hono + Bun + Inngest + Postgres + Drizzle + Vite + React
+ TanStack Query + shadcn/ui** as the project stack, even though we'd be
faster in a Python/FastAPI/Next.js setup. Anthropic Claude is the LLM family.

**Rationale:** The work trial's first-order metric is "would the team use this
code in their product?" Matching the stack maximizes that probability.

**Trade-offs:** Slightly higher first-mile learning cost. Mitigated by the
ecosystem being mature and TS-friendly.

---

## ADR-001 — Agent framework: Mastra vs Claude Agent SDK

**Status:** **TBD — primary outstanding decision.**

**Question:** Which framework backs the brand and supplier agents?

**Candidates:**

- **Mastra** (`@mastra/core` 1.x). Pros: peer-to-peer agent model fits the
  multi-supplier negotiation naturally; first-class `@mastra/inngest`
  integration; suspend/resume primitive matches the curveball replanning;
  built-in observability bridges (Langfuse, OTEL).
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk` 0.3.x). Pros: lower
  conceptual surface area, structured outputs are first-class via Zod,
  familiar to the developer. Cons: hierarchical master/subagent paradigm
  doesn't map cleanly to N peers; no Inngest integration; recent API churn
  (V2 session API removed).

**Leaning:** Mastra, for the reasons above. Awaiting deeper validation
session before committing.

**What blocks deciding:** Hands-on prototype of a 2-turn brand↔supplier
exchange in each framework, plus a curveball replanning walk-through.

---

## ADR-002 — XLSX parsing pipeline

**Status:** **TBD.**

**Question:** What exact pipeline parses messy XLSX into typed line items?

**Direction (likely accepted):** Hybrid pipeline:

1. SheetJS reads the workbook with `cellStyles`, `cellNF`, `cellDates`,
   `sheetStubs` to capture merges/comments/numfmts.
2. Deterministic pre-processor forward-fills merged cells, segments tables
   (BFS over non-empty cells, split by ≥ 2 blank rows/cols), collapses
   multi-row headers, tags totalizer rows as `aggregate` (not dropped),
   infers locale.
3. Each region serialized as Markdown-KV and fed to **Claude Sonnet 4.6**
   with `response_format: json_schema` + a Zod schema; system prompt and
   catalog cached via `cache_control: ephemeral`.
4. Per-row self-reported confidence; rows below threshold trigger a
   **vision fallback** (LibreOffice headless → PNG → Claude Sonnet 4.6
   vision call against the same schema).
5. Totalizer rows used as a validation oracle (sum-of-line-totals reconciles
   with extracted grand total).
6. SKU matching: canonical-key exact match → BM25 → voyage-3-large
   embeddings → Reciprocal Rank Fusion → LLM-as-judge tie-breaker on
   thin-margin top-3.

**Blocks deciding:** Sample XLSX from the challenge package, products.csv,
and a quick spike to confirm token cost under prompt caching.

---

## ADR-003 — ORM: Drizzle (accepted)

**Status:** Accepted.

**Decision:** Drizzle. Reasons:
- TS-native; types derive from the schema.
- Zero codegen step (vs Prisma) — keeps iteration cycle tight.
- `drizzle-kit push` mode is ideal for an early-stage project.
- The target startup is itself weighing Drizzle vs Prisma; picking Drizzle
  aligns with their leaning.

**Driver:** `drizzle-orm/node-postgres` with `pg.Pool`. The `postgres` (a.k.a.
`postgres-js`) driver has intermittent issues with Bun prepared statements.

---

## ADR-004 — Local Postgres: Supabase CLI (accepted)

**Status:** Accepted.

**Decision:** `supabase start` for local Postgres + Studio. Mirrors the
target startup's production environment more faithfully than a bare
Postgres container.

**Trade-off:** Heavier on Docker resources (multiple containers) than the
`postgres:17-alpine`-only alternative.

---

## ADR-005 — Workflow orchestration: Inngest (accepted)

**Status:** Accepted.

**Decision:** Inngest dev server local. The negotiation flow is genuinely
multi-step (parse → match → fan-out 3 in parallel → wait for curveball →
replan → winner → PO). Inngest is what the target startup uses, and its
primitives (`step.run`, `step.waitForEvent`, fan-out via `Promise.all` over
`step.run`) match the shape of this problem.

---

## ADR-006 — Streaming bus: in-process pub/sub (accepted)

**Status:** Accepted.

**Decision:** Inngest steps are durable request/response and cannot stream
out of themselves. We use a single-process pub/sub bus inside the API to
carry agent deltas from Inngest steps to a Hono SSE endpoint. The frontend
subscribes via `EventSource` and merges deltas into TanStack Query cache.

**Trade-off:** Doesn't survive a server restart mid-stream — but the
durable result still does (saved as `negotiation_message` rows). Acceptable
for a single-node local deployment.

---

## ADR-007 — Authentication: out of scope (accepted)

**Status:** Accepted.

**Decision:** No auth in this work trial. A hardcoded `brandId` ("default
brand") attaches to every request. The target startup is mid-migration
between Supabase Auth and Better Auth + WorkOS — picking either side would
be wasted work.

---

## Standing conventions (not ADRs)

- Conventional commits (`feat:`, `fix:`, etc.).
- No `--no-verify`. If a hook fails, diagnose the cause.
- No "Generated with Claude Code" footer on PRs (project convention).
- One package manager: `bun`. No `npm install` calls.
- Don't introduce a new third-party dependency without alignment.

## Reviewing this document

If you (a coding agent) feel you need to make a decision that contradicts
something here, **stop and surface it**. The user wants to make those calls.
