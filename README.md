# ai-brand-sourcing

A brand sourcing tool: upload a messy supplier quotation (XLSX) → AI parses it →
multi-agent negotiation against alternate suppliers → brand picks a winner →
convert into a Purchase Order.

> Coding challenge — May 2026. Built to match the target startup's stack so the
> code can ship as-is if they like it.

---

## Quick start

```bash
# 0. Prerequisites: Bun >= 1.2, Docker, Supabase CLI, gh, an Anthropic API key.
cp .env.example .env  # fill ANTHROPIC_API_KEY

# 1. Install deps
bun install

# 2. Boot local Postgres (Supabase)
bun db:start
# Copy the `DB URL` printed by Supabase into DATABASE_URL in .env

# 3. Push the schema
bun db:push

# 4. Run everything (3 terminals)
bun dev:api          # http://localhost:3000  → /docs for OpenAPI UI
bun dev:web          # http://localhost:5173
bun dev:inngest      # http://localhost:8288  → Inngest DevServer
```

---

## What's in here

```
.
├── apps/
│   ├── api/          Hono + Bun + Inngest + Drizzle. REST + SSE + OpenAPI 3.1.
│   └── web/          Vite + React + TanStack Query + shadcn/ui.
├── packages/
│   └── shared/       Zod schemas shared by API and Web.
├── docs/             Architecture, ontology, ADRs, parser/negotiation specs.
├── assets/           Sample XLSX quotes, products.csv catalog.
├── supabase/         Local Supabase config (config.toml etc).
├── AGENTS.md         Index for coding agents — read this first.
├── CLAUDE.md         Claude Code-specific instructions.
└── docs/SETUP.md     Full setup walkthrough.
```

## Reading order (humans)

1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system shape and data flow.
2. [docs/ONTOLOGY.md](docs/ONTOLOGY.md) — domain model, vocabulary.
3. [docs/DECISIONS.md](docs/DECISIONS.md) — ADRs, what's pending.
4. [docs/PARSER.md](docs/PARSER.md) — XLSX pipeline design.
5. [docs/NEGOTIATION.md](docs/NEGOTIATION.md) — agent negotiation design.

## Reading order (coding agents)

Start at [AGENTS.md](AGENTS.md). It indexes everything in dependency order.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Bun** | Target startup's stack. Single binary, fast install, native TS. |
| API | **Hono + @hono/zod-openapi** | Lightweight, OpenAPI 3.1 auto-generated, zero-cost cross-platform. |
| Workflow orchestration | **Inngest** | Durable steps, fan-out parallel, `waitForEvent` for mid-flight curveball replanning. |
| DB | **Postgres** (Supabase local) | Mirrors prod stack. RLS available if/when needed. |
| ORM | **Drizzle** | TS-native, Zod-friendly, `push` mode for fast iteration. |
| Frontend | **Vite + React + TanStack Query + shadcn/ui** | Stack alignment. |
| Agents | TBD — see ADR-001 in docs/DECISIONS.md | Mastra vs Claude Agent SDK still under evaluation. |
| LLMs | **Anthropic Claude** | Sonnet 4.6 for parsing/most agents, Opus 4.7 for analytical brand decisions. |
| Parser | TBD — see ADR-002 in docs/DECISIONS.md | Hybrid SheetJS + Claude structured outputs pipeline planned. |
| Observability | TBD | Langfuse the leading candidate, plug-and-play via Mastra. |

## License

Private. Submitted as a work-trial deliverable.
