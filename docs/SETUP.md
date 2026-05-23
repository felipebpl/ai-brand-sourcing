# Setup

End-to-end walkthrough for a fresh machine.

## Prerequisites

| Tool | Min version | Install |
|---|---|---|
| Bun | 1.2 | `curl -fsSL https://bun.sh/install \| bash` |
| Python | 3.11 | `brew install python@3.11` (or pyenv) |
| Docker Desktop | recent | https://docs.docker.com/desktop/ |
| Supabase CLI | 2.x | `brew install supabase/tap/supabase` |
| GitHub CLI | 2.x (optional) | `brew install gh` |
| Anthropic API key | n/a | https://console.anthropic.com |

> macOS note: keep the repo **outside** of `~/Documents/` (which is TCC-
> protected). A path like `~/code/personal/projects/ai-brand-sourcing/`
> avoids the EPERM hell.

## 1. Clone + install

```bash
git clone git@github.com:felipebpl/ai-brand-sourcing.git
cd ai-brand-sourcing
bun install
```

## 2. Python venv for the parser agent

The parser agent invokes Python via Bash. Create a local venv and install
the dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Activate `.venv` in every shell that runs the API (or set up
direnv/auto-activation).

## 3. Configure environment

```bash
cp .env.example .env
# Open .env and set ANTHROPIC_API_KEY (required)
```

The default `DATABASE_URL` matches Supabase CLI's local Postgres
defaults.

## 4. Boot Postgres

```bash
bun db:start
```

Supabase Studio is at http://127.0.0.1:54323. Use it to inspect tables
and data.

## 5. Push the schema

```bash
bun db:push
```

The schema lives in `apps/api/src/db/schema.ts`. In local dev we use
`push` mode (no migration files). The `pg_trgm` extension is enabled
automatically.

## 6. Run

Three terminals (or `bun dev` to run api + web in parallel):

```bash
# T1 — API
bun dev:api          # http://localhost:3000
                     #   /docs         Swagger UI
                     #   /health       health probe
                     #   /openapi.json
                     #   /api/inngest

# T2 — Inngest dev server
bun dev:inngest      # http://localhost:8288 — Inngest workflow UI

# T3 — Web
bun dev:web          # http://localhost:5173
```

> Boot order matters: the Inngest CLI polls the `-u` URL to discover
> functions, so the API must be up *first*.

## 7. Verify

- http://localhost:3000/health → `{"status":"ok","checks":{"database":"ok"}}`
- http://localhost:3000/docs → Swagger UI lists routes.
- http://localhost:5173 → Web app boots and reports API health.
- http://localhost:8288 → Inngest dashboard shows `ai-brand-sourcing`
  app connected (no functions yet during scaffolding; they fill in as
  we implement).

## Troubleshooting

- **`DATABASE_URL is not set`** — copy `.env.example` to `.env`.
- **`supabase start` hangs or fails on storage container** —
  `supabase/config.toml` ships with `[storage] enabled = false` to
  sidestep a known macOS-arm64 health-check issue.
- **`python: command not found`** when the parser agent runs — make
  sure `.venv` is activated in the shell running `bun dev:api`.
- **CORS in browser** — confirm `VITE_API_BASE_URL` in `.env` matches
  the API's port.
- **TCC EPERM on macOS** — repo should live in `~/code/...`, not
  `~/Documents/...`. macOS protects Documents and silently revokes
  process grants.
