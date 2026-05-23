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
  negotiationId: string;
  brandAsk: NegotiationOffer;
  brandMessage: string;
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
