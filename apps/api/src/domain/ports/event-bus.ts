/**
 * EventBus port — internal pub/sub used to stream agent activity to the
 * frontend SSE channel. Adapter lives in
 * `src/infra/agent-sdk/event-bus.ts` (in-process implementation that
 * mirrors every publish to the `agent_event` table for durable replay
 * on SSE reconnect).
 *
 * This is *not* the Inngest event system (which is for durable workflow
 * orchestration). This is the live-streaming pipe for the UI to watch
 * the agents think.
 */
export type AgentActor =
  | { kind: 'brand' }
  | { kind: 'parser' }
  | { kind: 'supplier'; supplierId: string };

export interface AgentEvent {
  id: string;
  quotationId: string;
  kind:
    | 'parser.started'
    | 'parser.progress'
    | 'parser.completed'
    | 'brand.thinking'
    | 'brand.ask_sent'
    | 'supplier.responded'
    | 'brand.round_summary'
    | 'brand.recommendation_made'
    | 'recommendation.superseded'
    | 'agent.text'
    | 'agent.session_started'
    | 'agent.session_completed'
    | 'po.issued';
  /**
   * When the event originates from an agent session (parser, brand,
   * supplier), payload carries `actor: AgentActor` and `sessionId:
   * string` so the UI can group + color-code by run. Domain-level
   * events (po.issued, recommendation.*) may omit them.
   */
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface EventBusPort {
  publish(event: AgentEvent): Promise<void> | void;
  subscribe(quotationId: string, handler: EventHandler): Unsubscribe;
}

export type EventHandler = (event: AgentEvent) => void | Promise<void>;
export type Unsubscribe = () => void;
