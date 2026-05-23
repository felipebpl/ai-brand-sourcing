/**
 * EventBus port — internal pub/sub used to stream agent activity to the
 * frontend SSE channel. Adapter lives in `src/infra/event-bus/`.
 *
 * This is *not* the Inngest event system (which is for durable workflow
 * orchestration). This is the live-streaming pipe for the UI to watch
 * the agents think.
 */
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
    | 'po.issued';
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface EventBusPort {
  publish(event: AgentEvent): Promise<void> | void;
  subscribe(quotationId: string, handler: EventHandler): Unsubscribe;
}

export type EventHandler = (event: AgentEvent) => void | Promise<void>;
export type Unsubscribe = () => void;
