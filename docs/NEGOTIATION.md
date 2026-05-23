# Negotiation

The negotiation is orchestrated by the **brand agent** (Claude Opus 4.7).
Each supplier is a **subagent** (Claude Haiku 4.5) with its own persona,
invoked via the SDK's `Agent` tool. The brand agent decides number of
rounds, when to push harder, when to call it done, and writes the final
`Recommendation`.

## Cast

- **Brand agent.** One per quotation. Knows: brand profile (Valden,
  premium outdoor), user instruction intent, parsed quotation baseline,
  supplier profiles (quality, defaults, persona), conversation history.
  Tools: `Agent` + custom MCP (`emit_event`, `submit_recommendation`,
  `persist_message`).
- **Supplier agents (4).** One per supplier — source supplier included
  (it's renegotiable). Each has:
  - persona: stance and style (premium / cost-cutting / speed-focused / etc.)
  - implicit price floor, lead-time flexibility, payment-term
    preferences
  - **information asymmetry**: never sees what the other suppliers said

## Protocol

The brand agent runs an internal **agentic loop**, not a hardcoded
N-rounds loop. Each iteration:

1. **Plan ask.** Brand agent decides, given history so far, what to ask
   each supplier this round. May ask different things to different
   suppliers (e.g. push S2 on price, push S3 on lead time).
2. **Parallel calls.** For each supplier still in the running:
   `Agent('supplier-N', { brandAsk, brandMessage, turnIndex })`.
3. **Each supplier agent** answers via `mcp__supplier__respond` with a
   discriminated-union response:
   - `counter_offer` — structured proposal + rationale
   - `accept` — yes to the current ask
   - `walk_away` — done, with reason
   - `request_clarification` — needs more info
4. **Brand evaluates.** Compares responses, updates internal state.
5. **Decide.** Brand decides:
   - Run another round (still room to push)
   - Conclude — pick winner, submit recommendation
   - Walk away from one or more suppliers (stalled)

## Brand agent's stopping criteria (the open question, made concrete)

Per the team's "intentionally open — show how you think about it"
framing, the brand agent reasons about stopping using **all** of these
signals (it weighs them, doesn't follow a hardcoded threshold):

- **Convergence**: deltas between rounds shrinking — last two rounds
  saw < 2% movement on most-pressured dimensions.
- **Leverage exhaustion**: tested all four dimensions (price, lead
  time, payment terms, quality concessions) on each supplier. Diminishing
  returns visible.
- **Constraint binding**: a supplier hit its hard limit ("we cannot go
  below $X", "we cannot ship faster than Y").
- **Time pressure** from user instruction (e.g. "30-day deadline" →
  fewer rounds, faster close).
- **Confidence**: brand agent self-reports "I have enough signal to
  pick" — captured in the final reasoning.
- **Hard cap**: max 5 rounds (configurable). Failsafe.

The brand agent's final reasoning *explains its stop criterion* — this
becomes audit material. "I stopped after 3 rounds because S2 hit its
floor on price and S3's lead time advantage is decisive given the user's
30-day deadline."

## Quality as a brand-positioning-weighted dimension

The brand agent does not use a hardcoded quality threshold. Instead it
infers a weighting from the brand's positioning (Valden = premium
outdoor technical apparel → quality is high-priority) and from the user's
instruction intent. Examples:

- Premium brand, no special instruction: prefer quality ≥ 4.5 even at
  ~10% cost premium.
- Premium brand, user says "prioritize cost this time": tolerate quality
  4.0 if the cost gap exceeds ~20%.
- Speed-priority instruction: lead time outranks quality and cost in
  ties.

The brand agent reasons about this explicitly and includes the weighting
choice in the recommendation rationale.

## Information asymmetry

A supplier agent's prompt context contains:
- its persona
- its own conversation history with the brand
- the current brand ask
- the current turn index

It does **not** contain:
- the brand agent's full state
- other suppliers' offers
- the brand's BATNA

This is enforced at the adapter level: `Agent()` invocations to a
supplier carry only that supplier's history (loaded via the custom
Postgres `SessionStore`). The brand agent may *summarize* a competing
offer in its message ("S2 just offered $X — can you beat it?") if it
chooses to, but never copies offer payloads across suppliers.

## Curveball (no special code path)

Curveballs arrive via the **`supplier.message` Inngest event**, the same
event that would carry any supplier-initiated inbound. Payload is the
natural-language message (e.g. *"Hi, after rechecking capacity we can
only fulfill 60% of the order"*).

The `handle.supplier-message` Inngest function:
1. Loads the active quotation and current recommendation.
2. Appends a `negotiation_message` with `role: system` and the message
   content (for audit).
3. Invokes `BrandAgentPort.reactToSupplierMessage()`.
4. Brand agent reads the message, extracts the delta, and decides:
   - **Keep** current recommendation (delta is minor).
   - **Swap winner** (new info makes another supplier clearly better).
   - **Renegotiate** with affected suppliers (re-run negotiation rounds
     with the new constraint baked in).
5. Persists a new recommendation, pushing the prior one into
   `quotation.recommendation_history` with `superseded_reason`.

**No code per curveball type.** The same handler covers capacity drops,
price hikes, lead-time slips, payment-term changes, and walk-aways.
Brand agent does the natural-language interpretation.

## Streaming to UI

Every brand and supplier agent activity publishes `AgentEvent` to the
in-process bus:
- `brand.thinking` — pre-call reasoning chunks
- `brand.ask_sent` — outbound to a supplier
- `supplier.responded` — supplier reply (including counter-offer payload)
- `brand.round_summary` — per-round evaluation
- `brand.recommendation_made` — final
- `recommendation.superseded` — on curveball replan

The frontend `useNegotiationStream(quotationId)` merges these into the
TanStack Query cache and renders 4 parallel "lanes" (one per supplier)
plus a brand-side reasoning track.

## Hard caps

```typescript
const NEGOTIATION_LIMITS = {
  maxRounds: 5,
  maxTurnsPerSupplier: 6,
  maxBudgetUsd: 2.00,     // for the whole negotiation
  timeout: 180_000,        // ms wall-clock
};
```

Hitting any → mark negotiations `stalled` and surface to user
("negotiation ran out of budget — review and decide").

## What the final Recommendation contains

Structured (`Recommendation` schema in `packages/shared/negotiation.ts`):

- `negotiationId` — the chosen negotiation.
- `supplierId` — denormalized for quick reads.
- `reasoning` — full natural-language justification. This is what the UI
  shows under "Why this winner?".
- `comparison` — array of `SupplierComparisonRow` (one per supplier ×
  dimension matrix). Drives the UI's comparison table.
- `decidedAt` — timestamp.
- `supersededReason` — null at first; populated when a curveball replan
  supersedes this recommendation.

The `comparison` matrix is the dataset-of-the-future for the ML model
that will eventually predict negotiation strategy. We ensure it's
structured (not text) from day one.
