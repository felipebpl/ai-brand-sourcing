# CLAUDE.md

Project-specific instructions for Claude Code. Read [AGENTS.md](AGENTS.md) first
for the broader index; this file holds Claude-specific operating notes.

## Working agreement

- **Language**: chat in Portuguese; code, docs, and comments in English.
- **Style**: concise. The user reads diffs; he does not need recap paragraphs.
- **No inline comments** except for non-obvious `why`s. Docstrings on functions
  and classes are encouraged.
- **No emojis** in code, commits, PRs, or docs unless explicitly asked.
- **No "Generated with Claude Code" footer** on PRs.
- **No regex/keyword intent capture.** Use typed LLM calls or explicit fields.
- **Tests must follow source.** When you change a module that has tests,
  update its tests in the same change. The user has a hard rule on this.

## Architecture conventions

- Schemas in `packages/shared`. Drizzle inserts derive types from them where
  possible.
- API contracts are OpenAPI 3.1 via `@hono/zod-openapi`. The frontend imports
  types from `packages/shared`, not from generated client code (for now).
- Inngest functions stay in `apps/api/src/inngest/functions.ts` until the
  registry outgrows a single file (>5 functions).
- Long-lived agent state lives in the DB; short-lived turn state lives in the
  Inngest workflow step memo.
- Agent streams publish deltas to an in-process bus; the SSE handler in Hono
  is what the frontend subscribes to. **Never** try to stream out of an
  Inngest step — Inngest is request/response durable; streaming dies with
  the step boundary.

## Code style (TypeScript)

- `strict: true`, `noUncheckedIndexedAccess: true`. Treat `undefined` as
  load-bearing.
- Prefer `type X = ...` for unions / utility shapes, `interface X { ... }`
  only when extending external interfaces.
- Avoid default exports for modules with more than one named export.
- Numbers persisted from agent outputs go through Zod before they reach
  Drizzle. Drizzle treats `numeric()` as `string` — convert at the boundary.

## Commits

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `test:`).
- One change per commit when feasible. The user reviews commit-by-commit.
- Do **not** amend published commits. Make a new commit.

## When to stop and ask

- Adding a new third-party dependency that isn't already pinned.
- Choosing between two architecturally different options where the user has
  not previously stated a preference.
- A test or hook fails and the fix would require changing behavior the user
  hasn't approved.

## Documentation discipline

Markdown files only in:

- the repo root (`README.md`, `AGENTS.md`, `CLAUDE.md`)
- `docs/*.md`

Do not create `NOTES.md`, `PLAN.md`, `STATUS.md` etc. unless the user asks.
Use task tracking and commit messages instead.
