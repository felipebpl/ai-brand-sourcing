# ai-brand-sourcing

A brand sourcing tool: upload a messy supplier quotation (XLSX) → AI parses it →
multi-agent negotiation against alternate suppliers → brand picks a winner →
convert into a Purchase Order.

> Coding challenge — May 2026. Built to match the target startup's stack so the
> code can ship as-is if they like it.

---

## Quick start (clone-and-run, local-only)

```bash
# 0. Prerequisites
#    - Bun >= 1.2     (curl -fsSL https://bun.sh/install | bash)
#    - Python >= 3.11 (for the parser agent's Bash + openpyxl/pandas workflow)
#    - Docker         (Supabase CLI uses it for local Postgres)
#    - Supabase CLI   (brew install supabase/tap/supabase)
#    - GitHub CLI     (gh — optional, for repo operations)
#    - An Anthropic API key

# 1. Clone and install
git clone git@github.com:felipebpl/ai-brand-sourcing.git
cd ai-brand-sourcing
bun install

# 2. Python venv for the parser agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Open .env and set ANTHROPIC_API_KEY at minimum

# 4. Boot Postgres (Supabase local — Docker)
bun db:start
# Studio UI: http://127.0.0.1:54323

# 5. Push the schema
bun db:push

# 6. Run everything (3 terminals — or `bun dev` to parallelize api + web)
bun dev:api          # http://localhost:3000  →  /docs for OpenAPI UI
bun dev:web          # http://localhost:5173
bun dev:inngest      # http://localhost:8288  →  Inngest DevServer
```

---

## What's in here

```
.
├── apps/
│   ├── api/                  Hono + Bun + Inngest + Drizzle. REST + SSE + OpenAPI 3.1.
│   │   └── src/
│   │       ├── domain/       Pure domain types and ports (framework-agnostic).
│   │       ├── infra/
│   │       │   └── agent-sdk/  Claude Agent SDK adapters (the only place that
│   │       │                   imports @anthropic-ai/claude-agent-sdk).
│   │       ├── db/           Drizzle schema (8-table model).
│   │       ├── inngest/      Event-driven workflow functions.
│   │       └── routes/       Hono routes (REST + SSE).
│   └── web/                  Vite + React + TanStack Query + shadcn/ui.
├── packages/
│   └── shared/               Zod schemas shared by API and Web.
├── docs/                     Architecture, ontology, ADRs, parser/negotiation specs.
├── assets/                   Sample XLSX quotes, products.csv catalog.
├── supabase/                 Local Supabase config (config.toml).
├── requirements.txt          Python deps (consumed by the parser agent via Bash).
├── AGENTS.md                 Index for coding agents — read this first.
├── CLAUDE.md                 Claude Code-specific instructions.
└── README.md
```

## Reading order (humans)

1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system shape, event-driven flow.
2. [docs/ONTOLOGY.md](docs/ONTOLOGY.md) — domain model, vocabulary.
3. [docs/DECISIONS.md](docs/DECISIONS.md) — ADRs (locked-in calls).
4. [docs/PARSER.md](docs/PARSER.md) — parser agent design.
5. [docs/NEGOTIATION.md](docs/NEGOTIATION.md) — agent negotiation protocol.
6. [docs/SCALING.md](docs/SCALING.md) — production scale considerations (future).

## Reading order (coding agents)

Start at [AGENTS.md](AGENTS.md). It indexes everything in dependency order.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Bun** | Target startup's stack. Single binary, fast install, native TS. |
| API | **Hono + @hono/zod-openapi** | Lightweight, OpenAPI 3.1 auto-generated. |
| Workflow orchestration | **Inngest** | Durable, event-driven, multi-handler reactive. |
| DB | **Postgres** (Supabase local) | Mirrors target's prod stack. |
| ORM | **Drizzle** | TS-native, Zod-friendly, `push` mode for fast iteration. |
| Frontend | **Vite + React + TanStack Query + shadcn/ui** | Stack alignment. |
| Agent framework | **Claude Agent SDK** | Anthropic-native; multi-model, skills, subagents, structured outputs. Adapters isolate it from domain. |
| LLMs | **Opus 4.7 / Sonnet 4.6 / Haiku 4.5** | Tier by task — strategic (brand) / tactical (parser) / worker (suppliers). |
| Parser | **Agent + skill `quotation-parser`** | Subagent runs Python (openpyxl) via Bash, iterates over messy XLSX, agent-first SKU matching. |
| SKU matching | **Postgres pg_trgm** | Trigram similarity via `lookup_catalog` MCP tool. No embeddings, no external API. |

## License

Private. Submitted as a work-trial deliverable.
