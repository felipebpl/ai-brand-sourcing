# AGENTS.md — Index for Coding Agents

This repository is built with heavy AI-assisted coding. If you are a
coding agent dropped into this codebase, this file is your entry point.
**Read it end-to-end before making changes.**

## TL;DR

ai-brand-sourcing ingests messy supplier XLSX quotations, parses them
with an AI agent (Claude Sonnet 4.6 + custom `quotation-parser` skill +
Python via Bash), runs a multi-agent negotiation orchestrated by the
**brand agent** (Claude Opus 4.7) against 4 supplier subagents (Claude
Haiku 4.5), produces an auditable `Recommendation`, and lets the user
convert it into a Purchase Order. All wrapped in an **event-driven**
Inngest workflow.

## Read in this order

1. **`README.md`** — humans-facing summary + clone-and-run.
2. **`docs/ARCHITECTURE.md`** — system topology, event-driven flow,
   layer responsibilities. The single source of truth for "where do I
   put X?"
3. **`docs/ONTOLOGY.md`** — domain model (8 entities). **If you are
   introducing a new entity, update this file first.**
4. **`docs/DECISIONS.md`** — ADRs (all locked-in: Claude Agent SDK,
   parser via skill+Python, Drizzle, agent-first matching, generic
   `supplier.message` event, Opus/Sonnet/Haiku tiers, etc.).
5. **`docs/PARSER.md`** — parser agent design + skill + tools.
6. **`docs/NEGOTIATION.md`** — agent negotiation protocol + stopping
   criteria + information asymmetry rules.
7. **`docs/SETUP.md`** — exact commands to get everything running.
8. **`docs/SCALING.md`** — future scale considerations (out of scope
   for this trial).
9. **`docs/GLOSSARY.md`** — naming conventions.

## What "agent-first" means in this codebase

"Agent-first" does NOT mean "one giant agent does everything." It means:

| Pattern | Agent-first? |
|---|---|
| TS code with regex/extractors hardcoded | ❌ No |
| LLM `query()` with tools that iterates over messy input | ✅ Yes |
| Subagent invoked via `Agent` tool (focused, own context) | ✅ Yes |
| Brand agent with skills loaded directly | ✅ Yes |

We have **multiple focused agents** — brand (Opus, orchestrator), parser
(Sonnet, with quotation-parser skill), supplier × 3 (Haiku, persona-
driven). Each is genuinely an agent (reasons, uses tools, iterates),
just specialized. The brand agent invokes others via the `Agent` tool
when its task calls for it.

## Stable architecture

| Area | Status |
|---|---|
| Monorepo shape (`apps/*`, `packages/*`) | Stable |
| Runtime (Bun) + API (Hono) + DB (Postgres/Drizzle) | Stable |
| Workflow (Inngest event-driven, 3 events) | Stable |
| Agent framework (Claude Agent SDK in `src/infra/agent-sdk/`) | Stable |
| Domain layer (`src/domain/`) ports + types | Stable |
| 8-table data model | Stable |
| Quotation lifecycle (`awaiting_quote` → … → `committed`) | Stable — see ADR-016 |
| SKU matching (agent-first via `pg_trgm`) + catalog guard at persistence | Stable — see ADR-016 |
| Frontend (RFQs list, RFQ workspace, Orders, Ask Amber trace panel) | Stable |
| Local-only execution (no app Docker) | Stable |
| Authentication | **Out of scope** (hardcoded brand `valden`) |

## Operating rules for agents

- **Read first, then edit.** Never invent code without confirming the
  file's current state via `Read`.
- **`docs/*.md` is the contract.** If you change behavior that
  contradicts a doc, update the doc in the same change.
- **Domain stays clean.** Code in `apps/api/src/domain/` never imports
  from `@anthropic-ai/claude-agent-sdk`, Inngest, Drizzle, or anything
  framework-specific. Adapters in `src/infra/` handle that.
- **`packages/shared` is the cross-tier boundary.** Zod schemas live
  there; both API and Web import from `@app/shared`.
- **No regex/keyword "intent capture."** Per the user's standing
  instruction: do not pattern-match human intent with regex or keyword
  lists. Use typed LLM calls or explicit fields.
- **Drizzle `push` for local dev.** Don't generate migrations until the
  schema stabilizes.
- **No `--no-verify`, no force shortcuts.** If a hook fails, diagnose
  the cause.
- **Tests live alongside the module they cover** (e.g.
  `apps/api/src/parser/parser.test.ts`). Update them whenever you
  change a module under test.
- **Docstrings yes, inline comments no.** Per the user's CLAUDE.md.
- **Do not generate Markdown files** unless explicitly asked or the
  file is part of `docs/`.

## Common entry points

| Need | Where to start |
|---|---|
| Add an API route | `apps/api/src/routes/*.ts` + register in `apps/api/src/index.ts` |
| Add an Inngest function | `apps/api/src/inngest/functions/*.ts` |
| Define a shared type | `packages/shared/src/*.ts` then re-export from `index.ts` |
| Change DB schema | `apps/api/src/db/schema.ts`, then `bun db:push` |
| Add a UI page | `apps/web/src/routes/*.tsx` (file-based routing) |
| Add a shadcn component | `bunx shadcn@latest add <component>` from `apps/web` |
| Add an agent tool | `apps/api/src/infra/agent-sdk/tools/*.ts` |
| Edit parser behavior | `apps/api/src/infra/agent-sdk/skills/quotation-parser/SKILL.md` |
| Add a new agent | `apps/api/src/infra/agent-sdk/adapters/*.ts` (implements a port from `domain/`) |

## When stuck

- The user runs Claude Opus 4.7 as primary coding model. He prefers
  concise, technically rigorous outputs.
- The user chats in Portuguese; code/docs/comments stay in English
  (international audience).
- The user values "what would I do if this company depended on this
  feature?" Every detail matters. Surface trade-offs, don't hide them.
- The user **wants** push-back when something is suboptimal — silent
  acceptance of weak plans is worse than respectful disagreement.

If a decision is genuinely architectural and ambiguous, **ask** instead
of guessing. See `docs/DECISIONS.md` for the rubric.
