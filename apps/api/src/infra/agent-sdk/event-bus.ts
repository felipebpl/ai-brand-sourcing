import type { DB } from '../../db';
import { agentEvent } from '../../db/schema';
import type {
  AgentEvent,
  EventBusPort,
  EventHandler,
  Unsubscribe,
} from '../../domain';

/**
 * In-process EventBus implementation.
 *
 * Fan-out for the live SSE channel — every event published goes to all
 * subscribers registered for the same quotation. Single-process and
 * stateless; the bus itself is the live-view pipe.
 *
 * The bus also accepts an optional `persister` so each event gets
 * mirrored to a durable store (the `agent_event` table when wired in
 * production composition). Persist failures are logged but never
 * block subscribers — live UX must not depend on durable writes.
 */
export type EventPersister = (event: AgentEvent) => Promise<void> | void;

export class InMemoryEventBus implements EventBusPort {
  private subscribers = new Map<string, Set<EventHandler>>();

  constructor(private readonly persister?: EventPersister) {}

  publish(event: AgentEvent): void {
    if (this.persister) {
      Promise.resolve()
        .then(() => this.persister!(event))
        .catch((err) => {
          console.error(
            `[event-bus] persister failed for ${event.kind} (${event.id}):`,
            err,
          );
        });
    }

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
 * DB-backed persister. Writes one row per event to `agent_event`,
 * keyed by quotation. Replay over (quotation_id, occurred_at) is
 * how the SSE endpoint reconstructs the trace on reconnect.
 */
export function makeDbAgentEventPersister(db: DB): EventPersister {
  return async (event) => {
    await db.insert(agentEvent).values({
      id: event.id,
      quotationId: event.quotationId,
      kind: event.kind,
      payload: event.payload as Record<string, unknown>,
      occurredAt: new Date(event.occurredAt),
    });
  };
}

/**
 * Process-wide bus. Composition root (db/index.ts) attaches the
 * persister once the DB handle is available so we don't ship a stale
 * import cycle.
 */
export const eventBus = new InMemoryEventBus();

/**
 * Bind a persister to the singleton bus. Called once at boot.
 * Safe to call again — second call replaces the previous binding.
 */
export function attachAgentEventPersister(persister: EventPersister): void {
  // Re-create the singleton's behavior by swapping its private field
  // through a typed cast — keeps the export reference stable for
  // every module that already imported `eventBus`.
  (eventBus as unknown as { persister?: EventPersister }).persister =
    persister;
}
