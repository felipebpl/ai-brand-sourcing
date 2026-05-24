# ai-brand-sourcing

Upload a messy supplier XLSX → an AI agent parses it → a brand agent runs a
multi-supplier negotiation against simulated supplier agents → recommendation
with reasoning → convert to Purchase Order. Every decision step is an agent
reasoning; the deterministic code around them is plumbing.

> Coding challenge — May 2026. Built to match the target startup's stack so
> the code can ship as-is if any piece is useful.

---

## TL;DR

- **Stack alignment**: Bun · Hono · Inngest · Drizzle · Supabase Postgres · Vite · React · TanStack Query · shadcn/ui. TypeScript end-to-end. Single `bun install`.
- **Agent framework**: Anthropic Claude Agent SDK. Adapters keep the SDK out of the domain layer.
- **Models by task**: Opus 4.7 (brand orchestrator), Sonnet 4.6 (parser), Haiku 4.5 (3 supplier agents + user-intent extractor).
- **Suppliers are independent Claude sessions**, not subagents — they communicate with the brand only through `negotiation_message` DB rows, exactly like real companies exchange emails.
- **Parser is agent-first**: runs `python3` with `openpyxl`/`pandas` via Bash, iterates over the file, resolves SKUs against a 10k-row catalog via Postgres `pg_trgm`. No template, no regex. Handles new file shapes (column swap, multi-sheet, Chinese labels) the same way a human would.
- **Every deal is a training row**: comparison matrix, reasoning, full thread, every counter-offer is persisted structurally. The data model is built so Amber can train an Amber-specific model on the negotiation history over time.

---

## 🤖 Copy for agent setup

Paste the entire block below into a fresh Claude Code / Codex / Cursor agent
session. It's self-contained — it tells the agent what the project is, what to
install, the exact commands, the known gotchas, and how to verify the stack is
healthy.

````markdown
You are a coding agent. Your job is to set up `ai-brand-sourcing` from scratch
on this machine and bring up the full local stack — API + Web + Inngest dev
server + Supabase Postgres — ready for end-to-end testing.

# Project shape

Bun monorepo. Three workspaces under `apps/*` and `packages/*`:

- `apps/api`    Hono on Bun, Inngest event-driven workflow, Drizzle ORM against
                Supabase local Postgres. Exposes REST + SSE + OpenAPI 3.1.
- `apps/web`    Vite + React 19 + TanStack Query + shadcn/ui.
- `packages/shared`   Zod schemas shared by API and Web.

The Claude Agent SDK lives ONLY in `apps/api/src/infra/agent-sdk/`. Domain layer
(`apps/api/src/domain/`) is pure types + ports.

# Prerequisites — install whatever's missing

- Bun >= 1.2.0       `curl -fsSL https://bun.sh/install | bash`
- Python >= 3.11     `brew install python@3.11`        (macOS)
- Docker Desktop     must be running before `bun db:start`
- Supabase CLI       `brew install supabase/tap/supabase`
- Anthropic API key  user provides — required

# Critical gotchas (these will bite you if you skip)

1. **macOS path matters.** Clone OUTSIDE `~/Documents/`. TCC silently revokes
   filesystem access from CLI processes inside Documents. A path like
   `~/code/personal/projects/ai-brand-sourcing/` works.

2. **The Python venv must be active in the shell running the API.** The parser
   agent invokes `python3` with `openpyxl`/`pandas` via Bash, and that
   subprocess inherits the parent's PATH. If you forget `source .venv/bin/activate`
   before `bun dev:api`, the parser will fail with `ModuleNotFoundError`.

3. **Inngest CLI install scripts.** `bunx inngest-cli@latest` may fail with
   "Inngest CLI binary not found" because Bun skips install scripts by default.
   Use the alternate launch command shown in step 9 below.

4. **drizzle-kit push warning is benign.** It will warn about "data loss
   statements" — that's just the trigram index churn (DROP + recreate). Pass
   `--force` to auto-approve; nothing actual is lost.

5. **Boot order matters.** Start API first, THEN Inngest dev server. Inngest
   polls the API once on launch to discover registered functions.

6. **`apps/web/.env.local` is required and must point at the API.** Vite reads
   `VITE_API_BASE_URL` once at startup and bakes it into the bundle. If the
   API ends up on a different port (or the file got copied from somewhere
   stale), the browser will show "Failed to fetch" with no other clue.

# Setup steps (execute in order)

```bash
# 1. Clone and install JS deps
git clone git@github.com:felipebpl/ai-brand-sourcing.git
cd ai-brand-sourcing
bun install

# 2. Python venv for the parser agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -c "import openpyxl, pandas; print('python deps ok')"

# 3. Configure environment
cp .env.example .env
# Set ANTHROPIC_API_KEY in .env. Everything else defaults are sane.

echo "VITE_API_BASE_URL=http://localhost:3000" > apps/web/.env.local

# 4. Boot Postgres via Supabase CLI (Docker daemon must be up first)
bun db:start

# 5. Push the schema (idempotent, --force suppresses the trigram-index warning)
cd apps/api && bun --env-file=../../.env --bun drizzle-kit push --force && cd ../..

# 6. Seed: 10k products + 3 suppliers + 1 starter RFQ awaiting upload
bun --filter @app/api db:seed
```

# Run the three dev servers

Each in its own terminal. Keep them all running.

```bash
# Terminal A — API. Must have the venv active in this shell.
source .venv/bin/activate
bun dev:api          # listens on http://localhost:3000

# Wait until /health returns 200 before continuing to Terminal C.
until curl -sf http://localhost:3000/health >/dev/null; do sleep 1; done

# Terminal B — Web (Vite)
bun dev:web          # http://localhost:5173

# Terminal C — Inngest dev server. The fallback launch handles the bunx
# install-scripts issue from gotcha #3.
NPM_CONFIG_CACHE=$(mktemp -d) npx --yes --ignore-scripts=false inngest-cli@latest dev \
  -u http://localhost:3000/api/inngest
# Dashboard: http://localhost:8288
```

# Verify the stack is healthy

```bash
curl -s http://localhost:3000/health          # {"status":"ok","checks":{"database":"ok"}}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8288/   # 200

# Inngest must have synced the 2 functions registered by the API
curl -s 'http://localhost:8288/v0/gql' -H 'content-type: application/json' \
  -d '{"query":"{ apps { url functions { name } } }"}'
# Expect: app at http://localhost:3000/api/inngest with 2 functions.
```

Open http://localhost:5173 in a browser. You should see one RFQ in
`awaiting_quote` status, ready for upload. Sample quotation files live in
`assets/quotation_{1,2,3,4}.xlsx` — `quotation_4.xlsx` (Chinese labels,
column-order swap) is the most interesting parser demo.

# Reset to fresh seeded state at any time

```bash
docker exec supabase_db_setup-initial psql -U postgres -d postgres -c "
TRUNCATE TABLE
  purchase_order_line, purchase_order,
  negotiation_message, negotiation,
  quotation_line, quotation,
  agent_event, claude_session_entry
RESTART IDENTITY CASCADE;
"
bun --filter @app/api db:seed
```

This wipes all runtime tables (POs, negotiations, agent trace, SDK sessions)
and re-seeds the starter RFQ, while keeping the 10k products and 3 supplier
personas untouched. Useful between demo runs.

# Domain context (so you don't re-derive it)

- **Brand agent** (Opus 4.7) decides how many rounds, when to stop, who wins.
  No fixed round count — it reasons about convergence and leverage.
- **Parser subagent** (Sonnet 4.6) runs `python3` via Bash to inspect the
  workbook, then uses a `lookup_catalog` MCP tool (Postgres `pg_trgm`) to
  resolve SKUs against the 10k-row catalog.
- **3 supplier agents** (Haiku 4.5) are independent Claude sessions, each with
  its own persona. They communicate with the brand only via
  `negotiation_message` rows — information asymmetry is enforced at the data
  boundary, not by prompt discipline.
- **Curveball**: Apex (supplier-2) reveals a 60% capacity ceiling when the
  brand pushes below standard tier. The constraint is structural in the
  supplier's persona (premium production lines ~60% available this window), so
  the reveal emerges from negotiation pressure rather than a turn-index script.

# Where to dig deeper before making changes

- `AGENTS.md`              — full index of operating rules + reading order
- `CLAUDE.md`              — Claude-Code-specific guidance
- `docs/ARCHITECTURE.md`   — system shape + Inngest flow + agent SDK layout
- `docs/DECISIONS.md`      — 16 ADRs with rejected alternatives
- `docs/PARSER.md`         — parser agent design + skill bundle
- `docs/NEGOTIATION.md`    — multi-agent negotiation protocol
- `docs/ONTOLOGY.md`       — domain model + table-by-table glossary

If you change behavior that contradicts an ADR, update the ADR in the same
change. If something is ambiguous, ask before implementing.
````

---

## 👤 Human setup

If you're a person reading this and want to run the demo yourself, here's the
short version of the same flow.

**Prereqs.** Install Bun, Python 3.11, Docker Desktop, the Supabase CLI, and
have an Anthropic API key handy. On macOS, install via Homebrew:

```bash
brew install bun python@3.11 supabase/tap/supabase
# Docker Desktop: https://docs.docker.com/desktop/
```

Clone the repo somewhere **outside** `~/Documents/` (macOS TCC silently revokes
CLI access inside Documents — you'll spend an afternoon debugging "permission
denied" with no helpful error).

**Steps.**

1. **Install + venv**
   ```bash
   git clone git@github.com:felipebpl/ai-brand-sourcing.git
   cd ai-brand-sourcing
   bun install
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Env**
   ```bash
   cp .env.example .env       # set ANTHROPIC_API_KEY
   echo 'VITE_API_BASE_URL=http://localhost:3000' > apps/web/.env.local
   ```

3. **Database**
   ```bash
   bun db:start                                                       # Supabase via Docker
   cd apps/api && bun --env-file=../../.env --bun drizzle-kit push --force && cd ../..
   bun --filter @app/api db:seed                                      # 10k products + 3 suppliers + 1 starter RFQ
   ```

4. **Run** — three terminals, in this order. Keep the venv active in Terminal A.
   ```bash
   # Terminal A
   source .venv/bin/activate
   bun dev:api          # http://localhost:3000 (wait for /health → 200)

   # Terminal B
   bun dev:web          # http://localhost:5173

   # Terminal C
   NPM_CONFIG_CACHE=$(mktemp -d) npx --yes --ignore-scripts=false \
     inngest-cli@latest dev -u http://localhost:3000/api/inngest    # http://localhost:8288
   ```

5. **Demo**
   - Open <http://localhost:5173>. You'll see one RFQ in `awaiting_quote`.
   - Click it, upload `assets/quotation_4.xlsx` (Chinese labels, swapped
     columns — the hardest one), add an intent like *"prioritize lead time and
     quality, push hard on price"*, hit upload.
   - Watch the Ask Amber panel stream parser activity (Bash calls, catalog
     lookups, structured submit).
   - Negotiation workspace opens automatically with three supplier lanes.
   - Brand agent decides rounds, picks a winner, shows the comparison matrix
     and reasoning.
   - Click **Place Order**, confirm. PO appears in `/orders`.

**Useful URLs during the demo:**

| URL | What |
|---|---|
| <http://localhost:5173>          | Web app |
| <http://localhost:3000/docs>     | Swagger UI for the API |
| <http://localhost:8288>          | Inngest dashboard (function runs + event history) |
| <http://127.0.0.1:54323>         | Supabase Studio (SQL + schema visualizer) |

**Troubleshooting.**

- `"Failed to fetch"` in the browser → `apps/web/.env.local` got out of sync.
  Make sure it has `VITE_API_BASE_URL=http://localhost:3000` and **restart
  Vite** (the env is baked at startup; HMR won't pick it up).
- API crashes with `Connection terminated unexpectedly` → Docker Desktop was
  closed or restarted. Restart Docker, then `bun db:start` to bring the
  Supabase containers back, then restart the API.
- Parser fails with `ModuleNotFoundError: openpyxl` → the venv isn't active in
  the shell running `bun dev:api`. Stop the API, `source .venv/bin/activate`,
  start again.
- Inngest CLI exits with *"binary not found"* → use the
  `NPM_CONFIG_CACHE=$(mktemp -d) npx --ignore-scripts=false` launch from step 4.

---

## What it actually does (under the hood)

**Parser.** Spreadsheet lands on disk. A Claude Sonnet 4.6 subagent boots with
two MCP tools (`lookup_catalog`, `submit_extraction`) plus `Bash` + `Read`.
It runs a Python inspector script first (`openpyxl` dump of sheets, dims,
formulas, the first/last rows), reasons about layout, extracts line items,
and resolves SKUs against the 10k-row catalog via Postgres trigram similarity
— deciding for each candidate whether it's an exact, a fuzzy inference (with
written reasoning), or genuinely uncertain. Confidently-wrong matches are
treated as the worst outcome; ambiguity is surfaced as `ambiguities[]` for
human review. The parser also catches structural traps — column-order swaps,
mixed-language metadata, multi-sheet quote variants — by trusting magnitudes
over labels.

**Negotiation.** Once parsing lands, the brand agent (Opus 4.7) opens three
independent Claude sessions, one per supplier. Each supplier has its own
persona prompt with a price floor, lead-time/payment-term constraints, and
realistic internal economics. They are **not** subagents — they don't share
context. They communicate with the brand only through `negotiation_message`
rows in Postgres, which is also what enforces information asymmetry
structurally (each supplier loads only its own thread via SQL).

The brand decides how many rounds — there's no hardcoded round count. It uses
the `ask_suppliers` tool to engage one or more suppliers in parallel per
round, reasons about convergence and leverage exhaustion, optionally calls
`walk_away_from` to close stalled tracks, and submits a final
`Recommendation` via the terminal `submit_recommendation` tool. The
recommendation carries a per-supplier comparison matrix with `winsOn`
dimensions and full natural-language reasoning.

**Curveball.** The challenge's mid-negotiation surprise (*"Supplier 2 can only
fulfill 60% of the order"*) emerges from supplier-2's persona, not a script.
Apex's premium production lines are modeled as ~60% available this window;
deals that fit standard tier route through booked slots and accept full
volume, but deals pushed below standard tier (lower price, faster lead,
tighter payment) can only run on the remaining slack — which caps deliverable
volume at 60%. The supplier doesn't lead with this on first contact (premium
houses don't advertise operational limits to new buyers); it surfaces after
multiple rounds of brand pressure, which is exactly the "after the first
round completes" beat from the challenge brief.

**Live trace.** Every agent's tool call, reasoning, and text reply is
mirrored to the frontend via an in-process EventBus → Hono SSE pipeline, and
to a durable `agent_event` table. The SSE handler replays the durable
history on every client connect before attaching to the live bus, so closing
the browser mid-negotiation and reopening 10 minutes later restores the full
trace.

**Purchase Order.** When the user clicks "Place Order", Inngest materializes
a `purchase_order` plus one `purchase_order_line` per matched SKU,
transactionally. Each PO line carries the `quotation_line_id` it came from,
giving end-to-end traceability: PO line → quotation line → original cell.

---

## Why the data model matters

Every deal is structured. The `Recommendation` has:

- A per-supplier comparison matrix with the final `unitPriceAvg`,
  `leadTimeDays`, `paymentTerms`, `fulfillablePct`, `qualityScore`, and which
  dimensions each supplier won on.
- Full natural-language reasoning explaining who won, why, why the others
  lost, why the brand stopped negotiating when it did, and how quality was
  weighed against price.
- A complete `negotiation_message` thread per supplier — every counter-offer,
  every walk-away, every clarification — typed and time-ordered.

Over months, that's proprietary negotiation data that no one else has. It's
the substrate for training an Amber-specific brand agent that gets sharper
with every deal: learns which suppliers concede on which dimensions, picks
better opening positions for new categories on day one, gets proactive
instead of reactive. The data model was built for that from day one.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Bun** | Target's stack. Single binary, fast install, native TS. |
| API | **Hono + @hono/zod-openapi** | Lightweight, OpenAPI 3.1 auto-generated from Zod. |
| Workflow | **Inngest** | Durable, event-driven steps. Auto-retries on transient failure. |
| DB | **Postgres** via Supabase CLI | Mirrors target prod. `pg_trgm` for SKU matching. |
| ORM | **Drizzle** | TS-native, Zod-friendly, `push` mode for fast iteration. |
| Frontend | **Vite + React 19 + TanStack Query + shadcn/ui** | Target's stack. |
| Agent framework | **Claude Agent SDK** | Anthropic-native; multi-model, subagents, skills, structured outputs, session store. Isolated in `infra/agent-sdk/`. |
| Models | **Opus 4.7 / Sonnet 4.6 / Haiku 4.5** | Tier by task — strategic / tactical / worker. Centralized in `model-router.ts`. |
| SKU matching | **Postgres `pg_trgm`** | Trigram similarity via `lookup_catalog` MCP tool. No embeddings, no external API. |

---

## Repo layout

```
.
├── apps/
│   ├── api/                Hono + Bun + Inngest + Drizzle.
│   │   └── src/
│   │       ├── domain/         Pure types + ports. No framework imports.
│   │       ├── infra/
│   │       │   └── agent-sdk/  Claude Agent SDK adapters (the only place
│   │       │                   that imports @anthropic-ai/claude-agent-sdk).
│   │       ├── db/             Drizzle schema (8 tables + 1 SDK session table).
│   │       ├── inngest/        Event-driven workflow functions.
│   │       ├── quotations/     Parse pipeline (state machine: uploaded → parsed).
│   │       ├── negotiations/   Negotiation pipeline (parsed → recommended).
│   │       ├── purchase-orders/ Materialization (recommended → committed).
│   │       └── routes/         Hono routes (REST + SSE) with OpenAPI 3.1.
│   └── web/                Vite + React + TanStack Query + shadcn/ui.
├── packages/
│   └── shared/             Zod schemas shared by API and Web.
├── docs/                   Architecture, ontology, ADRs, parser/negotiation specs.
├── assets/                 Sample XLSX quotes, products.csv (10k SKU catalog).
├── supabase/               Local Supabase config (storage container disabled).
├── requirements.txt        Python deps (openpyxl, pandas) for the parser agent.
├── AGENTS.md               Index for coding agents — read first.
├── CLAUDE.md               Claude Code-specific operating notes.
└── README.md
```

---

## What's intentionally out of scope

- **Authentication / multi-tenant isolation.** Hardcoded `brand_id = 'valden'`
  everywhere. See ADR-007.
- **Email/inbox ingestion.** In production, uploads would arrive from Amber's
  email pipeline rather than a manual upload button. The upload route is the
  same shape — just swap the trigger.
- **Real supplier integrations.** All three suppliers are LLM-simulated.
- **Observability beyond the trace UI.** No Langfuse wiring, no structured
  logs to external systems, no metrics.
- **Production hardening.** Three known production-readiness issues are
  filed as GitHub issues with the appropriate fix sketched
  ([#6](https://github.com/felipebpl/ai-brand-sourcing/issues/6),
  [#7](https://github.com/felipebpl/ai-brand-sourcing/issues/7),
  [#8](https://github.com/felipebpl/ai-brand-sourcing/issues/8)) — none block
  the demo.

If you want any of these wired up, the architecture supports it: routes are
OpenAPI-typed, the brand_id column is already on every table, the upload
route doesn't care where the multipart came from.

---

## License

Private. Submitted as a work-trial deliverable.
