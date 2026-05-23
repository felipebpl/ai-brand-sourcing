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

## ADR-013 — Parser as a dedicated subagent, not a skill on the brand agent

**Status:** Accepted.

**Decision:** The parser is a **separate Claude subagent** invoked by
the brand agent via the SDK's `Agent` tool. The `quotation-parser`
skill is loaded on the **parser subagent**, not on the brand agent.
The brand agent has no filesystem access (`Bash`/`Read`/`Write`) — its
toolset is `Agent` + `mcp__brand__*` only.

**Rationale:**

1. **Cost.** Parsing uses 5–15 Python turns over Bash. Sonnet 4.6 does
   it with the same quality as Opus 4.7 at ~30% the cost. Concentrating
   parsing in a subagent unlocks that saving cleanly.
2. **Security surface.** Brand agent processes inbound `supplier.message`
   events — natural-language content from outside the system, where
   prompt-injection is a real concern. Not giving the brand agent
   `Bash` is basic hygiene; the parser subagent runs `Bash` only on
   files we control (uploaded quotations), with `cwd` scoped to the
   workspace.
3. **Context cleanliness.** Brand agent's context is already packed
   (4 supplier conversations × N rounds × tool calls). Adding parsing
   transcripts on top causes compaction earlier and burns cache. The
   subagent runs in its own context window; the brand sees only the
   structured `QuotationExtraction` result + `ambiguities[]`.
4. **Separation of concerns.** Parsing is a closed task with a strict
   output schema; negotiation is an open-ended dialogue. Modeling them
   as separate agents with separate model tiers makes the design
   easier to evolve.

**Critically, this is NOT a "pipeline".** The parser subagent **is an
agent** — with its own reasoning, iteration, tool use, and structured
output. The distinction:

| Approach | Agent-first? |
|---|---|
| TS pipeline with regex/extractors hardcoded | ❌ No |
| Brand agent with skill loaded directly | ✅ Yes |
| Parser invoked as subagent via `Agent` tool | ✅ Yes |

We're picking the third because of the four reasons above — not
because we want less agent. We want more focused agents.

**Rejected alternatives:**

- **Skill on the brand agent (Variant A):** simpler conceptually, but
  forces Opus to do parsing (cost), exposes the brand agent to
  filesystem tools (security), and inflates the brand's context.
- **Standalone parser process via subprocess:** loses the agent-first
  framing; we'd be reimplementing what `Agent` tool already gives us.

**Implementation map:**
- `apps/api/src/infra/agent-sdk/adapters/parser.claude.ts` — spawns the
  subagent via `query()` (or registers it under the brand's `agents:`
  map and invokes via `Agent` tool — implementation detail).
- `apps/api/src/infra/agent-sdk/skills/quotation-parser/` — the skill
  bundle (already scaffolded).
- `apps/api/src/infra/agent-sdk/tools/lookup-catalog.ts` and
  `submit-extraction.ts` — MCP tools the parser subagent uses.

---

## ADR-014 — Parser validated against four sample quotations; no changes required

**Status:** Accepted.

**Decision:** The Step 3 parser subagent — `claude-sonnet-4-6` + the
inline `quotation-parser` system prompt + `lookup_catalog` /
`submit_extraction` MCP tools + the `stop-on-submit` hook — handles all
four real-world variabilities present in the challenge sample files
without modification. We ship this implementation as-is for Step 4 and
beyond.

**Validation summary** (full report in
[PARSER-VALIDATION.md](PARSER-VALIDATION.md)):

| File | Pattern | Outcome |
|---|---|---|
| quotation_1 | Tier pricing as duplicated rows; merged headers; empty col A; absent footer metadata | 40 lines, honest nulls for missing metadata, soft-signal ambiguity on L > XL pricing oddity |
| quotation_2 | Tier pricing as separate columns; typo'd SKUs; footer metadata | 48 lines (2 tiers × 24 SKUs), typo SKUs fuzzy-matched with reasoning, 3 thin-margin candidates flagged as `agent_uncertain` |
| quotation_3 | Multi-sheet (Quote 1 + Quote 2 scenarios); discount % per row; labeled metadata block | 46 lines merged with `sourceRef.sheet` provenance; discount applied to unit price; one unresolved SKU flagged |
| quotation_4 | Chinese labels; **column order swapped vs labels** | 23 lines, swap detected via magnitude analysis, validated via grand-total reconciliation, `language: "zh"` tagged |

**Key correctness wins:**

- Honest absence (`null` instead of inventing).
- Tier pricing unified across the two flavors (rows vs columns) into the
  same `min_qty`/`max_qty` shape.
- Multi-sheet merged with provenance (`sourceRef.sheet`).
- Magnitude-over-labels caught the q4 column-swap trap.
- Validation oracle (Σ ≈ grand total) used and cited.
- All three `matchMethod` values exercised; no confident-wrong matches
  observed across 157 total extracted lines.

**Cost envelope (real):** $0.04–$0.15 per parse, 125–325s wall-clock,
all four runs inside `maxBudgetUsd: 0.5` and `maxTurns: 25`.

**Rejected at this point:**

- Bulk `lookup_catalog([sku1, sku2, …])` — would save ~$0.05/run in
  worst case, but adds tool surface complexity and the agent already
  handles single-call latency fine.
- Forcing object-typed `extraction` input schema (would eliminate
  string-JSON retry rounds) — locks the payload shape; defer until
  schema is stable.
- Per-run lookup memoization — premature; not a real cost driver yet.
- Switching parser model to Haiku 4.5 — Sonnet's reasoning on the q1
  L-vs-XL anomaly and the q4 swap detection are exactly the kind of
  judgment we don't want to lose. Cost gap is small in absolute terms.

**Future-scale considerations** (documented in `docs/SCALING.md` if
this code goes to production with thousands of parses/day): cache
known canonical SKUs, hot-path for templates we've seen before, stream
agent thinking to the UI so users don't watch a blank spinner for
3 minutes.

---

## ADR-015 — Suppliers as independent Claude sessions, not subagents of the brand

**Status:** Accepted.

**Decision:** Each supplier agent runs as its own top-level `query()`
call to the Claude API — a fully **independent session** orchestrated
in TypeScript code. The brand and the suppliers communicate through
`negotiation_message` rows in Postgres: that table is the source of
truth. Suppliers are NOT invoked via the SDK's `Agent` tool / `options.agents`
subagent mechanism.

**Why (over invoking suppliers as subagents):**

1. **Real-world metaphor maps cleanly.** Suppliers are external
   entities (manufacturers in different companies) exchanging emails
   with the brand. Each one has its own brain, memory, agenda. That's
   "two independent processes talking via a channel" — not "function
   call returning a value to a parent process". Independent sessions
   are the literal translation of that metaphor.
2. **Curveball injection is natural.** The challenge's curveball
   ("Supplier 2 came back saying they can only fulfill 60% of the
   order") originates from the supplier side. With independent
   sessions, the curveball is a `negotiation_message(role=supplier)`
   row inserted directly by the UI form — no LLM call required, since
   the user IS the supplier in that moment. The brand reacts via the
   `supplier.message` Inngest event. With subagent semantics
   (fire-and-forget, master-initiated), suppliers can't initiate at
   all — the curveball would need a synthetic, awkward inject mechanism.
3. **Information asymmetry is enforced at the data boundary.** Each
   supplier session loads its own history via
   `SELECT FROM negotiation_message WHERE negotiation_id = X` — there
   is no SQL path that leaks another supplier's offers. With subagent
   semantics, brand passes context as a string and discipline lives
   in the brand prompt; one slip leaks payloads.
4. **Multi-turn is trivial.** No session resume gymnastics, no
   subpath tracking. Each call re-reads the thread and reconstructs
   the prompt. Safe for Inngest cross-host re-execution; safe for
   Postgres-backed event-sourcing.
5. **Persona is per-instance.** Same `ClaudeSupplierAgentAdapter`
   class, different `profile` injected per instance — `s1Profile`,
   `s2Profile`, `s3Profile`. The Anthropic API only ever sees one
   persona + one history per call. No cross-contamination is possible.

**Empirical evidence (single round, same brand opening message):**

| Supplier | Persona | Response | Intent |
|---|---|---|---|
| S1 Thai Textiles | weary cost-cutter | "We can beat $52. Before I quote: 1k tier, 5k tier, or both?" | `request_clarification` (won't quote blind) |
| S2 Apex Manufacturing | premium defender | "$59.50, 25d, 40/60. Annual commitment buys you 5% and 30/70" | `counter_offer` (defends premium) |
| S3 Velocity Fabriks | terse speed merchant | "$50, 15d, 100% upfront — that's how we fund the speed. Ready?" | `counter_offer` (firm on upfront) |

Three radically distinct on-persona outputs from the same input.
Validation cost: ~$0.13 total / ~3 min wall-clock on Haiku 4.5. See
`ClaudeSupplierAgentAdapter` validation runs (Step 4 commit).

**Rejected alternatives:**

- **Subagents via `options.agents` + `Agent` tool** (Option A from
  earlier scoping conversation). Cons: fire-and-forget per call;
  supplier can't initiate (kills the curveball metaphor); info
  asymmetry by prompt discipline only; hierarchical master/sub doesn't
  match peer-entity reality. The cost saving was illusory (brand would
  still have to pass full history each call).
- **Hybrid (subagent with external session continuity)**: more
  complexity than either pure approach, no clear win.

**Implementation map:**

- `apps/api/src/domain/ports/supplier-agent.ts` — `SupplierAgentPort`
  interface + `SupplierAgentResponse` discriminated union.
- `apps/api/src/infra/agent-sdk/prompts/supplier-persona.ts` — three
  persona blocks keyed by supplier id + brand-context / info-asymmetry
  / output-contract boilerplate.
- `apps/api/src/infra/agent-sdk/adapters/supplier-agent.claude.ts` —
  `ClaudeSupplierAgentAdapter`. Constructor takes `profile`; `respond`
  reads `negotiation_message[]`, builds prompt, calls Haiku 4.5,
  persists reply.

**Channel format:** every turn is a row in `negotiation_message` with
`role IN ('brand', 'supplier', 'system')`, `turn_index`, `content`
(natural language), `offer` JSONB (structured proposal when present),
`metadata` JSONB (model used, cost, intent). System rows carry
curveball + audit events.

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
