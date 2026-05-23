import type {
  AgentEvent,
  EventBusPort,
  EventHandler,
  Unsubscribe,
} from '../../domain';

/**
 * In-process EventBus implementation.
 *
 * The frontend subscribes via SSE to receive these events; agent
 * activity (hooks, tool calls, structured output) publishes them.
 *
 * Single-process only — survives nothing. Durable state lives in
 * Postgres (`negotiation_message`, etc.). This bus is the live-view
 * channel, not the source of truth.
 */
export class InMemoryEventBus implements EventBusPort {
  private subscribers = new Map<string, Set<EventHandler>>();

  publish(event: AgentEvent): void {
    const handlers = this.subscribers.get(event.quotationId);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error(`[event-bus] handler error for ${event.kind}:`, err);
          });
        }
      } catch (err) {
        console.error(`[event-bus] handler error for ${event.kind}:`, err);
      }
    }
  }

  subscribe(quotationId: string, handler: EventHandler): Unsubscribe {
    let handlers = this.subscribers.get(quotationId);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(quotationId, handlers);
    }
    handlers.add(handler);
    return () => {
      const set = this.subscribers.get(quotationId);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) this.subscribers.delete(quotationId);
    };
  }

  /** Test helper. */
  subscriberCount(quotationId: string): number {
    return this.subscribers.get(quotationId)?.size ?? 0;
  }
}

/**
 * Single process-wide bus instance. Hono SSE handler and agent
 * adapters both reach for this one.
 */
export const eventBus = new InMemoryEventBus();
