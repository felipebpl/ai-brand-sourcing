# Negotiation

> **Status: TBD — gated on ADR-001.** This file holds the protocol design; the
> framework binding lands when we close ADR-001 (Mastra vs Claude Agent SDK).

## Cast

- **Brand agent.** One per quotation. Knows the parsed line items, the
  product catalog, supplier quality ratings, and the user's instruction.
  Acts on the brand's behalf.
- **Supplier agents.** Three, one per simulated supplier. Each has a
  persona/system prompt encoding its starting position:
  - **supplier-1:** medium quality (4.0), cheapest, lead 50d, terms 33/33/33.
    This is also the supplier who originally sent the XLSX (used as the
    baseline reference).
  - **supplier-2:** high quality (4.7), most expensive, lead 25d, terms
    40/60.
  - **supplier-3:** medium quality (4.0), mid-range price, lead 15d, terms
    100% upfront.

## Protocol

Hybrid: structured offers + free-form rationale per turn.

Each turn produces a `NegotiationMessage` with:

- `content`: the natural-language move (1–3 sentences).
- `offer`: a structured `NegotiationOffer` if the move includes one (it
  usually does).

The brand agent opens with a counter pointing at the supplier-1 baseline.
The supplier agent answers with a counter-offer. Continue up to N turns
(target: 4–6). The agent either:

- **Concludes** by accepting an offer (sets `negotiation.status =
  'concluded'`, persists the final offer).
- **Walks away** if the gap is unbridgeable (`status = 'failed'`).

## Curveball mid-negotiation

After the first round completes, the workflow waits for
`negotiation/curveball.sent` for up to 30 minutes. The challenge specifies:

> "Supplier 2 came back saying they can only fulfill 60% of the order."

On receipt, the workflow re-runs each negotiation with the new constraint
included in context. **Critically**, the brand agent can choose **split
sourcing**: e.g., take 60% from supplier-2 (because of quality) and 40%
from supplier-3 (because of lead time). The `WinnerSelection.splitWith`
field captures this.

## Winner selection

The brand agent receives:
- The three final `NegotiationOutcome` rows.
- The user's free-text instruction.
- The supplier quality ratings.
- The curveball (if any) and its implications.

It produces a `WinnerSelection` with `reasoning` and explicit `tradeoffs[]`.
Persisted to `winner_selection`.

The user can then accept → click "Convert to PO" → PO materializes. The user
can also override (reject the recommendation) — TBD whether to expose this
in the UI for the work trial.

## Streaming to the UI

Each token emitted by an agent is published to the in-process bus keyed by
`quotationId`. SSE relays to the frontend. The UI renders three side-by-side
streams (one per supplier negotiation) plus a summary track for the brand
agent's reasoning.

## Open questions (block ADR-001 / NEGOTIATION-final)

- Maximum turns per negotiation (4? 6? unbounded with a budget)?
- Do supplier agents see each others' offers? **Default: no** (they only
  see what the brand tells them). Confirm.
- LLM choice per agent: Opus for brand reasoning, Sonnet for suppliers?
- Should supplier-1 (who sent the original XLSX) have a different opening
  posture vs the other two?
