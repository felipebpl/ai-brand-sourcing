# Scaling Considerations (Future)

This project runs **locally** for the work trial. The notes here capture
what we'd think about for production scale (10k+ users, 100k+ quotations
per day). Nothing here is implemented now — the trial codebase is
deliberately simple.

## Where bottlenecks would appear, in order

1. **Anthropic rate limits.** Sonnet 4.6 has tier-based limits. Mitigation:
   - Inngest `concurrency: { limit: N }` per function.
   - **Batch API** (50% off) for non-interactive workflows.
   - Bedrock or Vertex for higher cotas.
   - Hard cap per file via `maxBudgetUsd` on each Agent SDK query.

2. **Parser agent latency.** Each parse is 8–20s with Python via Bash.
   Mitigation:
   - **Hot path**: detect simple/known XLSX templates and use a TS-only
     fast path (1–2s).
   - **Caching**: cache `(file_hash, parser_version) → extraction`.
   - **Pre-emptive parsing**: if upload chunks come in async, start parse
     before upload completes.

3. **Postgres connection pool**. At 100k parses/day, each writing
   negotiation messages + offers, plan ~50k writes/day. Mitigation:
   - Bulk inserts on parser stage.
   - PgBouncer in front.
   - Read replicas for the PO listing UI.

4. **CPU on parser-agent worker.** Python subprocess + openpyxl is single-
   threaded. Mitigation:
   - Worker scaling via Inngest concurrency.
   - Calamine (Rust) fast path for value-only reads.

## Production architecture (sketch)

```
[Cloud Run worker] ── consumes Inngest events
    ├── Hot path:   TS-only parser for known templates
    ├── Cold path:  Python subprocess for messy XLSX
    └── Always:     SessionStore writes to Postgres (cross-host resume)

[Inngest cloud]
    ├── concurrency limits per Anthropic key
    ├── batch API for non-realtime work
    └── retry policy with exponential backoff

[Postgres]
    ├── pg_trgm for SKU lookups
    ├── jsonb GIN indexes on metadata for queryability
    └── partitioned negotiation_message table once volume grows
```

## Observability metrics worth instrumenting

```typescript
metrics.histogram("parser.duration_ms", { strategy, lang });
metrics.histogram("parser.cost_usd", { model });
metrics.histogram("parser.confidence", { method });
metrics.counter("parser.ambiguity_flagged");
metrics.counter("parser.escalated_to_human");
metrics.histogram("negotiation.rounds_count");
metrics.histogram("negotiation.duration_seconds");
metrics.histogram("negotiation.price_concession_pct");
metrics.counter("negotiation.curveball_received", { supplier });
metrics.counter("recommendation.superseded");
metrics.gauge("anthropic.cache_hit_rate");
```

## Prompt caching strategy at scale

The 5-minute TTL is the binding constraint. If load is steady at
~1 req/sec, the catalog + system prompt cache effectively never expires
in hot path. For lower-volume tenants:

- Pre-warm via `max_tokens: 0` request every ~4 minutes with the same
  prefix (cheap heartbeat).
- Order cache breakpoints: catalog (most stable) → system prompt →
  tool defs → conversation history. Max 4 breakpoints per request.

## Idempotency at scale

- Inngest event idempotency key: `sha256(file_bytes) + parser_version`.
  Re-upload of same file = no duplicate work.
- PO numbers via Postgres sequence — never derived from app-side logic.
- Recommendation replans append to `quotation.recommendation_history`;
  superseded reason captured for audit.

## What stays the same

The 8-table schema and the Port-and-Adapters separation are scale-
agnostic. Nothing about going from 1 user to 100k changes the domain
shape — only the infrastructure underneath the adapters.
