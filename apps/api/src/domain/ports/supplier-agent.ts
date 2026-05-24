import type { NegotiationOffer, SupplierProfile } from '../types';

/**
 * Supplier agent port. One implementation per supplier — each with its
 * persona, price floor, lead-time flexibility, and negotiation style.
 *
 * The brand agent invokes a supplier through this port for each round of
 * the negotiation. Implementations must respect information asymmetry:
 * a supplier never sees what other suppliers offered. Only the brand's
 * current ask and the supplier's own conversation history.
 *
 * The default implementation is a Claude subagent with the persona baked
 * into its system prompt — see
 * `src/infra/agent-sdk/adapters/supplier.claude.ts`.
 */
export interface SupplierAgentPort {
  readonly profile: SupplierProfile;

  /**
   * Respond to the brand's ask. May counter-offer, accept, walk away, or
   * request clarification. The implementation maintains its own history
   * via session/resume — caller only passes the new brand ask.
   */
  respond(input: SupplierAgentRespondInput): Promise<SupplierAgentResponse>;
}

export interface SupplierAgentRespondInput {
  /**
   * The quotation the supplier is responding within. Used to scope live
   * trace events to the right SSE subscriber on the frontend.
   */
  quotationId: string;
  negotiationId: string;
  /**
   * The brand's most recent message on this negotiation thread.
   * The supplier adapter pulls the full prior history from the DB
   * (`negotiation_message[]` rows) and reconstructs the conversation —
   * the caller doesn't pass history. Only the new ask.
   */
  brandMessage: string;
  /**
   * The structured ask the brand attached to its latest message, if any.
   * Suppliers respond to either or both (some brand messages are
   * clarifying questions with no new offer).
   */
  brandAsk: NegotiationOffer | null;
  /**
   * The line items under negotiation — copied from the parsed quotation.
   * Suppliers reason about realistic offer levels relative to total
   * volume and product mix.
   */
  quotedItems: ReadonlyArray<{
    productSku: string;
    description: string | null;
    quantity: number;
  }>;
  turnIndex: number;
}

export type SupplierAgentResponse =
  | {
      kind: 'counter_offer';
      offer: NegotiationOffer;
      message: string;
    }
  | {
      kind: 'accept';
      message: string;
    }
  | {
      kind: 'walk_away';
      reason: string;
      message: string;
    }
  | {
      kind: 'request_clarification';
      question: string;
      message: string;
    };
