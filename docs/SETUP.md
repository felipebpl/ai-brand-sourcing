# Setup

End-to-end walkthrough for a fresh machine.

## Prerequisites

| Tool | Min version | Install |
|---|---|---|
| Bun | 1.2 | `curl -fsSL https://bun.sh/install \| bash` |
| Docker Desktop | recent | https://docs.docker.com/desktop/ |
| Supabase CLI | 2.x | `brew install supabase/tap/supabase` |
| GitHub CLI | 2.x | `brew install gh` |
| An Anthropic API key | n/a | https://console.anthropic.com |

## 1. Clone + install

```bash
git clone git@github.com:felipebpl/ai-brand-sourcing.git
cd ai-brand-sourcing
bun install
```

## 2. Configure environment

```bash
cp .env.example .env
# Open .env and set ANTHROPIC_API_KEY
```

## 3. Boot Postgres

```bash
bun db:start
# Note the "DB URL" Supabase prints — should look like
#   postgresql://postgres:postgres@127.0.0.1:54322/postgres
# It already matches the .env default.
```

Supabase Studio is at http://127.0.0.1:54323. Use it to inspect tables and
data.

## 4. Push the schema

```bash
bun db:push
```

The schema lives in `apps/api/src/db/schema.ts`. In local dev we use
`push` mode (no migration files). When the schema stabilizes we'll switch
to `generate` + `migrate`.

## 5. Run

Three terminals (or use `bun dev` to run api + web in parallel):

```bash
# T1 — API
bun dev:api          # http://localhost:3000
                     #   /docs        Swagger UI
                     #   /health      health probe
                     #   /openapi.json
                     #   /api/inngest

# T2 — Inngest dev server
bun dev:inngest      # http://localhost:8288  — Inngest workflow UI

# T3 — Web
bun dev:web          # http://localhost:5173
```

> Boot order matters: the Inngest CLI polls the `-u` URL to discover
> functions, so the API must be up *first*.

## 6. Verify

- http://localhost:3000/health → `{"status":"ok","checks":{"database":"ok"}}`
- http://localhost:3000/docs → Swagger UI lists `/health` and the inngest
  handler.
- http://localhost:5173 → Web app boots, makes a request to `/health` and
  prints the result.
- http://localhost:8288 → Inngest dashboard shows the `ai-brand-sourcing`
  app connected (no functions yet — they're TBD).

## Troubleshooting

- **`DATABASE_URL is not set`** — you didn't copy `.env.example` to `.env`.
- **`supabase start` hangs** — Docker isn't running, or another container
  holds port 54322. Try `bun db:stop` first.
- **Inngest dashboard shows "app disconnected"** — restart the CLI; it
  re-polls every few seconds.
- **CORS errors in the browser** — confirm `VITE_API_BASE_URL` in `.env`
  matches the API's actual port.
