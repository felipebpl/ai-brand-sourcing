# Negotiation

The negotiation is orchestrated by the **brand agent** (Claude Opus 4.7),
which exchanges messages with **3 supplier agents** (Claude Haiku 4.5)
— one per supplier persona from the challenge brief. The brand decides
number of rounds, when to push harder, when to call it done, and writes
the final `Recommendation`.

## Agent topology — independent sessions, DB as channel

Suppliers are **NOT** subagents of the brand (via the SDK's `Agent`
tool). They are **independent Claude sessions** orchestrated in code,
communicating with the brand through `negotiation_message[]` rows in
Postgres. See [ADR-015](DECISIONS.md#adr-015) for the rationale; the
short version: this is the only design that maps cleanly onto the
real-world metaphor (suppliers are external entities exchanging emails)
and the only one that supports the curveball flow naturally (user
injects a `supplier.message` row directly, no LLM call on the supplier
side).

## Cast — exactly 3 suppliers (matches challenge brief)

| ID | Name | Quality | Pricing | Lead time | Payment | Tone |
|---|---|---|---|---|---|---|
| `supplier-1` | (set on upload from XLSX, e.g. "Thai Textiles") | 4.0 | Cheapest baseline | 50 days | 33/33/33 | Plain, direct, weary |
| `supplier-2` | Apex Manufacturing | 4.7 | Most expensive (15–25% above market) | 25 days | 40/60 | Confident, patient premium defender |
| `supplier-3` | Velocity Fabriks | 4.0 | Mid-range | 15 days | 100% upfront (non-negotiable) | Transactional, terse, speed-focused |

`supplier-1` is the supplier who originally uploaded the XLSX
(challenge brief). The team confirmed in scoping that S1 is also
renegotiable — the brand agent talks to all 3 in parallel, including
the source.

## Anatomy: one class, three instances

```ts
// Each supplier is an instance of the same class with a different profile
const supplierAdapters = {
  'supplier-1': new ClaudeSupplierAgentAdapter({ profile: s1Profile, ... }),
  'supplier-2': new ClaudeSupplierAgentAdapter({ profile: s2Profile, ... }),
  'supplier-3': new ClaudeSupplierAgentAdapter({ profile: s3Profile, ... }),
};

// Each round: 3 parallel API calls, completely isolated
const [r1, r2, r3] = await Promise.all([
  supplierAdapters['supplier-1'].respond({ negotiationId: nid1, ... }),
  supplierAdapters['supplier-2'].respond({ negotiationId: nid2, ... }),
  supplierAdapters['supplier-3'].respond({ negotiationId: nid3, ... }),
]);
```

```
                   Quotation X
                        │
         ┌──────────────┼──────────────┐
         │              │              │
    Negotiation     Negotiation    Negotiation
     (X × S1)       (X × S2)       (X × S3)
         │              │              │
         ▼              ▼              ▼
   ┌─────────┐    ┌─────────┐    ┌─────────┐
   │ Adapter │    │ Adapter │    │ Adapter │
   │ profile │    │ profile │    │ profile │
   │  = S1   │    │  = S2   │    │  = S3   │
   │ (Thai)  │    │ (Apex)  │    │(Velocity)│
   └────┬────┘    └────┬────┘    └────┬────┘
        │              │              │
        ▼              ▼              ▼
   Anthropic API  Anthropic API  Anthropic API
   call:          call:          call:
   - persona S1   - persona S2   - persona S3
   - history S1   - history S2   - history S3
   - latest ask   - latest ask   - latest ask
        │              │              │
        ▼              ▼              ▼
   S1 response    S2 response    S3 response
        │              │              │
        ▼              ▼              ▼
   INSERT         INSERT         INSERT
   negotiation_   negotiation_   negotiation_
   message        message        message
   (nid1)         (nid2)         (nid3)
```

Each column is **fully isolated**: distinct prompt, distinct history
(filtered by `negotiation_id` in SQL), distinct API call. Anthropic
receives 3 unrelated conversations in parallel. No cross-supplier
contamination is possible.

## Information asymmetry — guaranteed at the data boundary

A supplier agent's prompt for one turn contains exactly:
- Its **own persona** (the `PERSONA_BY_ID[supplierId]` text)
- The **items under negotiation** (the bundle of SKUs from the parsed
  quotation)
- The **history of this negotiation thread only**
  (`SELECT FROM negotiation_message WHERE negotiation_id = X`)
- The **latest brand message** + optional structured ask

It does NOT see:
- Other suppliers' offers (filtered at the SQL `WHERE` clause)
- The brand agent's internal reasoning / BATNA
- Cross-quotation history (same supplier in past deals)

The brand agent may *summarize* competing pressure in its outbound
message ("a competitor offered $X average") — and the supplier persona
is explicitly instructed that such citations may be exaggerated and
should not be trusted as ground truth. **Brand never copies raw offer
payloads across suppliers** (disciplined at the brand prompt level,
Step 5).

## Protocol — agentic loop

The brand agent runs an internal loop, not a hardcoded N-rounds count.
Each iteration:

1. **Plan ask.** Brand decides what to ask each supplier this round,
   possibly different per supplier (e.g. push S2 on price, push S3 on
   payment terms). May ask only a subset if some are stalled.
2. **Parallel send.** For each in-flight supplier:
   `supplierAdapter.respond({ negotiationId, brandMessage, brandAsk, quotedItems, turnIndex })`.
   `Promise.all` for concurrency.
3. **Each supplier replies** with a discriminated-union response:
   - `counter_offer` — structured proposal + 1–3 sentence rationale
   - `accept` — yes to the current ask
   - `walk_away` — done, with reason
   - `request_clarification` — needs more info before quoting
4. **Brand evaluates.** Reads responses, updates internal state.
5. **Decide.** Brand decides:
   - Run another round (still room to push)
   - Conclude — pick winner, submit `Recommendation`
   - Walk away from one or more suppliers (stalled)

## Brand agent's stopping criteria (open by design)

Per the team's "intentionally open — show how you think about it" framing
on the original brief, the brand agent reasons about stopping using
**all** of these signals (weighed, not threshold-checked):

- **Convergence**: deltas between rounds shrinking — last two rounds saw
  < 2% movement on most-pressured dimensions.
- **Leverage exhaustion**: tested the negotiable dimensions (price, lead
  time, payment terms) on each supplier; diminishing returns visible.
- **Constraint binding**: a supplier hit its hard limit
  ("we cannot go below $X", "we cannot ship faster than 15d").
- **Time pressure** from user instruction (e.g. "30-day deadline" →
  fewer rounds, faster close).
- **Confidence**: brand agent self-reports "I have enough signal to
  pick" — captured in the final reasoning.
- **Hard cap**: max 5 rounds (configurable). Failsafe.

The brand agent's final reasoning **explains its stop criterion** — this
becomes audit material: *"I stopped after 3 rounds because S2 hit its
floor on price and S3's lead time advantage is decisive given the
user's 30-day deadline."*

## Quality as a brand-positioning-weighted dimension

No hardcoded quality threshold. The brand agent infers a weighting from
brand positioning (Valden = premium outdoor → quality is high-priority)
and user instruction intent. Examples:

- Premium brand, no special instruction: prefer quality ≥ 4.5 even at
  ~10% cost premium.
- Premium brand, user says "prioritize cost this time": tolerate quality
  4.0 if cost gap exceeds ~20%.
- Speed-priority instruction: lead time outranks quality and cost in
  ties.

The brand agent reasons about this explicitly and includes the weighting
choice in the recommendation rationale.

## Realism mechanisms (why personas don't degenerate)

| Mechanism | What it does |
|---|---|
| Persona has cost floor numerically | "Below ~8–12% of default you lose money — don't cross it" |
| Walk-away criterion explicit | "Walking away is acceptable if brand insists below your floor" |
| Trade across dimensions | "If brand wants lower price, ASK for more volume / longer lead / aggressive terms in return" |
| Information asymmetry forced | "Brand may mention competing pressure but never trust raw numbers — may be exaggerated" |
| Not desperate | "You're not desperate — you have other buyers" |
| Persona re-injected every turn | System prompt is re-sent (no session resume) — persona never dilutes |
| Tone discipline | "1–3 sentences per turn. Buyers read fast." |

Validated against the 3 sample personas with the same brand opening
message — they produced radically distinct responses, each on-persona:

| Supplier | Opening response | Intent |
|---|---|---|
| S1 Thai | "We can beat $52. Before I quote: are you sourcing each SKU at the 1000-unit tier, 5000-unit tier, or both?" | `request_clarification` — won't quote blind |
| S2 Apex | "$59.50, 25-day lead time, 40/60. If you commit annual partnership: 5% off and 30/70" | `counter_offer` defending premium |
| S3 Velocity | "$50 with 15-day turnaround, 100% upfront — that's how we fund the speed. Quality 4/5, proven. Ready to move?" | `counter_offer` firm on speed + upfront |

Personas isolated, output distinct, no cross-contamination possible.

## Curveball — no special code path

Curveballs arrive via the **`supplier.message` Inngest event** — the
same event that carries any supplier-initiated inbound. Payload is the
natural-language message (e.g. *"Hi, after rechecking capacity we can
only fulfill 60% of the order"*).

The user creates this message directly through the UI ("Send supplier
message" form). The path:

1. `POST /supplier-messages` → inserts
   `negotiation_message(role=supplier, content=...)` row + emits
   `supplier.message` Inngest event.
2. **No LLM call on the supplier side** — the user is "playing"
   the supplier rep. The row is the supplier's word.
3. `handle.supplier-message` Inngest function invokes
   `BrandAgentPort.reactToSupplierMessage()`.
4. Brand agent reads the message + thread context, extracts the delta,
   and decides:
   - **Keep** current recommendation (delta is minor)
   - **Swap winner** (new info makes another supplier clearly better)
   - **Renegotiate** with affected suppliers (re-run negotiation rounds
     with the new constraint baked in)
5. Persists a new recommendation, pushing the prior one into
   `quotation.recommendation_history` with `superseded_reason`.

**One handler covers all curveball flavors** (capacity drops, price
hikes, lead-time slips, payment-term changes, walk-aways). The brand
agent does natural-language interpretation. New curveball types cost
zero code — just new content in the same event.

## Streaming to UI

Every brand and supplier agent activity publishes `AgentEvent` to the
in-process bus:
- `brand.thinking` — pre-call reasoning chunks
- `brand.ask_sent` — outbound to a supplier
- `supplier.responded` — supplier reply (including counter-offer
  payload)
- `brand.round_summary` — per-round evaluation
- `brand.recommendation_made` — final
- `recommendation.superseded` — on curveball replan

The frontend `useNegotiationStream(quotationId)` merges these into the
TanStack Query cache and renders 3 parallel "lanes" (one per supplier)
plus a brand-side reasoning track.

## Hard caps

```typescript
const NEGOTIATION_LIMITS = {
  maxRounds: 5,
  maxTurnsPerSupplier: 6,
  maxBudgetUsd: 2.00,    // for the whole negotiation
  timeout: 180_000,       // ms wall-clock
};
```

Hitting any → mark negotiations `stalled` and surface to user
("negotiation ran out of budget — review and decide").

## What the final Recommendation contains

Structured (`Recommendation` schema in `packages/shared/negotiation.ts`):

- `negotiationId` — the chosen negotiation.
- `supplierId` — denormalized for quick reads.
- `reasoning` — full natural-language justification. This is what the
  UI shows under "Why this winner?".
- `comparison` — array of `SupplierComparisonRow` (per supplier ×
  dimension matrix). Drives the UI's comparison table.
- `decidedAt` — timestamp.
- `supersededReason` — null at first; populated when a curveball replan
  supersedes this recommendation.

The `comparison` matrix is the dataset-of-the-future for the ML model
that will eventually predict negotiation strategy. Structured (not text)
from day one.

## How the design maps to the challenge brief

| Challenge requirement | Implementation |
|---|---|
| "The brand agent uses the parsed quote as a baseline" | Brand opens each negotiation with the S1 baseline (`unitPriceAvg` from parsed quotation) as leverage in the first message |
| "Initiates negotiations with the supplier agents" | `Promise.all` of `supplierAdapter.respond()` per round — parallel, independent |
| "Negotiation between brand agent and each supplier agent" | Multi-turn loop, each turn is a `negotiation_message` row; brand decides when to push and when to stop |
| "Brand agent selects the best supplier and explains the reasoning" | Terminal `submit_recommendation` call emits structured `Recommendation` with reasoning + comparison matrix |
| "Brand agent is aware of each supplier's quality ratings" | `supplier.quality_score` is included in brand's system prompt context; weighting is positioning-driven |
| "Supplier agents should behave realistically — find ways to win" | Personas with cost floors, trade-across-dimensions playbook, walk-away criterion. Validated empirically against 3 personas. |
| "Agents should communicate in English using natural language" | `message` field in every turn is natural English; structured `offer` carries the machine-readable payload alongside |
| "Mid-negotiation curveball: S2 can only fulfill 60%, re-evaluate without restarting from scratch" | `supplier.message` event → `handle.supplier-message` → brand agent re-evaluates without re-running parser or prior rounds. Generic mechanism — same handler covers any curveball variant. |
