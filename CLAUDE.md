# CLAUDE.md

Project-specific instructions for Claude Code. Read [AGENTS.md](AGENTS.md)
first for the broader index; this file holds Claude-specific operating
notes.

## Working agreement

- **Language**: chat in Portuguese; code, docs, and comments in English.
- **Style**: concise. The user reads diffs; he does not need recap
  paragraphs.
- **No inline comments** except for non-obvious `why`s. Docstrings on
  functions and classes are encouraged.
- **No emojis** in code, commits, PRs, or docs unless explicitly asked.
- **No "Generated with Claude Code" footer** on PRs.
- **No regex/keyword intent capture.** Use typed LLM calls or explicit
  fields.
- **Tests must follow source.** When you change a module that has tests,
  update its tests in the same change.

## Architecture conventions

- **Domain layer** (`apps/api/src/domain/`) is pure: types + ports
  (interfaces). Never imports framework code. If you're tempted to
  import from `@anthropic-ai/claude-agent-sdk` here, redesign the port.
- **Adapters** (`apps/api/src/infra/agent-sdk/`) are the only place
  that touches the Agent SDK. All `query()`, `Agent` tool, hooks,
  `createSdkMcpServer` live here.
- **Schemas in `packages/shared`.** Drizzle types live in
  `apps/api/src/db/schema.ts`; Zod runtime schemas (for transport, for
  agent tool validation, for cross-tier contracts) live in
  `@app/shared`. Drizzle inserts are typed by Drizzle; Zod converts at
  the wire.
- **API contracts** are OpenAPI 3.1 via `@hono/zod-openapi`. The
  frontend imports types from `@app/shared`, not from generated client
  code (for now).
- **Inngest functions** stay in `apps/api/src/inngest/functions/` —
  one file per event handler. Three events:
  `quotation.uploaded`, `supplier.message`, `purchase-order.requested`.
- **Agent state**: long-lived state in Postgres (via the
  `Postgres SessionStore` adapter). Short-lived turn state in the
  Inngest workflow memo.
- **Agent streaming**: hooks publish to in-process EventBus → Hono SSE.
  Never try to stream out of an Inngest step — Inngest is durable
  request/response.

## Code style (TypeScript)

- `strict: true`, `noUncheckedIndexedAccess: true`.
- Prefer `type X = ...` for unions / utility shapes, `interface X { ... }`
  only when extending external interfaces.
- Avoid default exports for modules with more than one named export.
- Numbers persisted from agent outputs go through Zod before reaching
  Drizzle. Drizzle treats `numeric()` as `string` — convert at the
  boundary.

## Agent SDK production hygiene

When wiring `query()` calls, **always**:

```ts
{
  settingSources: [],                // never load ~/.claude/* from host
  permissionMode: 'dontAsk',         // deny anything unauthorized
  allowedTools: ['mcp__<scope>__*'], // explicit whitelist
  sessionStore: pgSessionStore,      // for cross-host resume
  maxTurns,                          // hard cap
  maxBudgetUsd,                      // hard cap
}
```

Plus:
- Brand agent: `tools: []` (only `Agent` + the brand's MCP). Never
  give the brand `Bash` or `Read` — it has no business with the
  filesystem.
- Parser agent: needs `Bash`, `Read`, `Write` (scoped via `cwd`).
- Supplier agent: no built-in tools at all; only its `respond` MCP tool.

## Commits

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `test:`).
- One change per commit when feasible. The user reviews
  commit-by-commit.
- Do **not** amend published commits. Make a new commit.

## When to stop and ask

- Adding a new third-party dependency that isn't pinned.
- Choosing between two architecturally different options where the
  user has not previously stated a preference.
- A test or hook fails and the fix would require changing behavior
  the user hasn't approved.

## Documentation discipline

Markdown files only in:

- the repo root (`README.md`, `AGENTS.md`, `CLAUDE.md`)
- `docs/*.md`
- `apps/api/src/infra/agent-sdk/skills/<skill>/*.md` (skill bundles)

Do not create `NOTES.md`, `PLAN.md`, `STATUS.md` etc. unless the user
asks. Use task tracking and commit messages instead.

## Filesystem placement

This project lives at `~/code/personal/projects/ai-brand-sourcing/`,
**not** under `~/Documents/`. macOS TCC silently revokes Documents
access from CLI processes — keep the repo out of there.
