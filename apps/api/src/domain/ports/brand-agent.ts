import type {
  Recommendation,
  NegotiationOffer,
  SupplierComparisonRow,
  UserInstructionIntent,
  BrandProfile,
  SupplierProfile,
  BaselineOffer,
} from '../types';

/**
 * Brand agent port.
 *
 * The brand agent is the orchestrating intelligence of the system. It:
 *  - Plans negotiation strategy from the brand's positioning + user
 *    instruction intent + supplier profiles + the parsed quotation baseline.
 *  - Drives the multi-round, multi-supplier negotiation, deciding when to
 *    push harder on each supplier and when to call it done.
 *  - Produces a single Recommendation (which negotiation wins) with
 *    auditable reasoning.
 *  - Handles re-evaluation when a `supplier.message` event arrives mid-life
 *    (e.g. supplier capacity drop) — produces a new Recommendation that
 *    supersedes the previous one.
 */
export interface BrandAgentPort {
  /**
   * Run the full negotiation flow for a quotation: opens negotiations with
   * all suppliers, conducts multi-round dialogue, decides winner, returns
   * the Recommendation. Streams progress events via the event bus.
   */
  negotiate(input: BrandAgentNegotiateInput): Promise<Recommendation>;

  /**
   * React to a `supplier.message` event after a recommendation already
   * exists. Brand agent loads the supplier's natural-language message,
   * extracts the delta (price/lead/capacity/terms changes), and decides
   * how to respond — may renegotiate with affected suppliers, swap winner,
   * or keep the current recommendation.
   */
  reactToSupplierMessage(
    input: BrandAgentReactInput,
  ): Promise<Recommendation>;
}

export interface BrandAgentNegotiateInput {
  quotationId: string;
  brand: BrandProfile;
  userInstruction: string | null;
  intent: UserInstructionIntent;
  suppliers: SupplierProfile[];
  baseline: BaselineOffer;
  /**
   * The bundle of items the brand is negotiating across all suppliers.
   * Each supplier gets the same list (information asymmetry is preserved
   * by *what was asked*, not by hiding the goods).
   */
  items: ReadonlyArray<{
    productSku: string;
    description: string | null;
    quantity: number;
  }>;
}

export interface BrandAgentReactInput {
  quotationId: string;
  supplierId: string;
  messageContent: string;
  currentRecommendation: Recommendation;
}

export interface NegotiationConclusion {
  negotiationId: string;
  finalOffer: NegotiationOffer;
  rationale: string;
  comparison: SupplierComparisonRow[];
}
