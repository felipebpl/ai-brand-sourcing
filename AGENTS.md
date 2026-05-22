# AGENTS.md — Index for Coding Agents

This repository is built with heavy AI-assisted coding. If you are a coding
agent dropped into this codebase, this file is your entry point. **Read it
end-to-end before making changes.**

## TL;DR

ai-brand-sourcing is a Bun monorepo (`apps/api`, `apps/web`, `packages/shared`)
that ingests messy XLSX supplier quotations, parses them with LLMs into
structured data, runs an AI-driven multi-agent negotiation against alternate
suppliers, and lets the user convert the winning negotiation into a Purchase
Order. The goal is to mirror the target startup's stack so the implementation
can ship as-is.

## Read in this order

1. **`README.md`** — humans-facing summary + quick start.
2. **`docs/ARCHITECTURE.md`** — system topology, request/event flow, where each
   responsibility lives. The single source of truth for "where do I put X?"
3. **`docs/ONTOLOGY.md`** — domain model. Defines `Quotation`, `ParsedItem`,
   `ProductCatalog`, `Supplier`, `Negotiation`, `NegotiationMessage`,
   `NegotiationOffer`, `WinnerSelection`, `PurchaseOrder`. **If you are
   introducing a new entity, update this file first.**
4. **`docs/DECISIONS.md`** — ADRs (Architecture Decision Records) and open TBDs.
   **Several large decisions are deferred** (agent framework choice, parser
   workflow specifics). Do not pick those for the user; surface a recommendation
   and wait. The conventions for the *small* decisions are documented here too.
5. **`docs/PARSER.md`** — XLSX → structured items pipeline. Will be filled in
   when ADR-002 lands.
6. **`docs/NEGOTIATION.md`** — agent negotiation protocol, turn structure,
   curveball handling. Will be filled in when ADR-001 lands.
7. **`docs/SETUP.md`** — exact commands to get everything running locally.
8. **`docs/GLOSSARY.md`** — naming conventions for the codebase.

## What's stable vs. what's TBD

| Area | Status |
|---|---|
| Monorepo shape (`apps/*`, `packages/*`) | Stable |
| Runtime (Bun) + API (Hono) + DB (Postgres/Drizzle) + Workflow (Inngest) | Stable |
| Zod schemas in `packages/shared` for cross-tier types | Stable |
| Frontend stack (Vite + React + TanStack Query + shadcn) | Stable |
| **Agent framework** (Mastra vs Claude Agent SDK) | **TBD — ADR-001** |
| **Parser workflow specifics** | **TBD — ADR-002** |
| LLM observability platform (Langfuse / Helicone / Braintrust) | TBD |
| Authentication | **Out of scope** for the work trial (hardcoded brand user) |

## Operating rules for agents

- **Read first, then edit.** Never invent code without confirming the file's
  current state via `Read`.
- **`docs/*.md` is the contract.** If you change behavior that contradicts a
  doc, update the doc in the same change.
- **Schema is the boundary.** Cross-tier types live in `packages/shared`. If
  you introduce a new payload, add the Zod schema there first and import it
  from both `apps/api` and `apps/web`.
- **No regex/keyword "intent capture."** Per the user's standing instruction:
  do not pattern-match human intent with regex or keyword lists. If
  classification is needed, use a typed LLM call or a deterministic rule
  grounded in an explicit field.
- **Drizzle `push` for local dev.** Don't generate migrations until the schema
  stabilizes.
- **No `--no-verify`, no `--force-with-lease` shortcuts.** If a hook fails,
  diagnose the underlying cause.
- **Tests live alongside the module they cover** (e.g.
  `apps/api/src/services/xlsx.test.ts`). Update them whenever you change a
  module under test — the user has a hard rule against stale tests.
- **Docstrings yes, inline comments no.** Per the user's CLAUDE.md, functions
  and classes get docstrings; line-level commentary is forbidden unless it
  explains a non-obvious `why`.
- **Do not generate Markdown files unless explicitly asked or the file is part
  of `docs/`.**

## Common entry points

| Need | Where to start |
|---|---|
| Add an API route | `apps/api/src/routes/*.ts` + register in `apps/api/src/index.ts` |
| Add an Inngest function | `apps/api/src/inngest/functions.ts` + export in `functions` list |
| Define a shared type | `packages/shared/src/*.ts` then re-export from `index.ts` |
| Change DB schema | `apps/api/src/db/schema.ts`, then `bun db:push` |
| Add a UI page | `apps/web/src/routes/*.tsx` (file-based routing) |
| Add a shadcn component | `bunx shadcn@latest add <component>` from `apps/web` |

## When stuck

- The user runs Claude Opus as their primary coding model. They prefer concise,
  technically rigorous outputs over verbose ones.
- The user prefers Portuguese for chat-level communication. Code, comments,
  docs in this repo stay in English (international audience).
- The user values "what would I do if this company depended on this feature?"
  Every detail matters. Surface trade-offs, don't hide them.

If a decision is genuinely architectural and ambiguous, **ask** instead of
guessing. See `docs/DECISIONS.md` for the rubric.
