# infra/agent-sdk/

Claude Agent SDK adapter layer. Contains every line of code that touches
`@anthropic-ai/claude-agent-sdk` directly. Domain code (`src/domain/`)
never imports from here — it only uses the ports.

## Structure

```
infra/agent-sdk/
├── adapters/
│   ├── parser.claude.ts      ParserPort impl   — subagent w/ quotation-parser skill
│   ├── brand-agent.claude.ts BrandAgentPort impl — main agent (Opus 4.7)
│   └── supplier.claude.ts    SupplierAgentPort impl — per-persona (Haiku 4.5)
├── tools/                    MCP tools (in-process) exposed to agents
│   ├── lookup-catalog.ts     fuzzy SKU search against product_catalog
│   ├── persist-extraction.ts persist parser output (called by parser agent)
│   ├── persist-message.ts    append message to negotiation thread
│   └── emit-event.ts         publish AgentEvent to the streaming bus
├── hooks/                    SDK lifecycle hooks for observability
│   ├── cost-guard.ts         abort if budget exhausted
│   ├── trace.ts              Langfuse/OTel spans
│   └── stream-bridge.ts      forward token-level events to the bus
├── skills/
│   └── quotation-parser/     custom skill bundle
│       ├── SKILL.md
│       ├── domain-context.md
│       ├── known-patterns.md
│       └── scripts/          optional Python helpers
├── session-store.pg.ts       Postgres-backed SessionStore (cross-host resume)
└── model-router.ts           "task tier" → claude model id mapping
```

## Why this lives here, not in domain

The Agent SDK has a particular paradigm (sessions, tool-use shape, hooks,
permission modes, settingSources, skill loading). Spreading those concepts
into the domain code would lock the project to this framework. Keeping
adapters here means swapping frameworks one day = rewriting this folder,
not the rest of the app.

The contract is enforced by the ports in `src/domain/ports/`. If you find
yourself wanting to leak an SDK type past those interfaces, redesign the
interface first.
