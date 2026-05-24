import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { API_BASE_URL } from './api';

export type AgentEventKind =
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

export type AgentEvent = {
  id: string;
  quotationId: string;
  kind: AgentEventKind;
  payload: Record<string, unknown>;
  occurredAt: string;
};

const KINDS: AgentEventKind[] = [
  'parser.started',
  'parser.progress',
  'parser.completed',
  'brand.thinking',
  'brand.ask_sent',
  'supplier.responded',
  'brand.round_summary',
  'brand.recommendation_made',
  'recommendation.superseded',
  'po.issued',
];

const MAX_EVENTS = 300;

const eventsByQid = new Map<string, AgentEvent[]>();
const seenByQid = new Map<string, Set<string>>();
const subscribersByQid = new Map<string, Set<() => void>>();
const streamsByQid = new Map<string, EventSource>();

function appendEvent(qid: string, event: AgentEvent): boolean {
  let seen = seenByQid.get(qid);
  if (!seen) {
    seen = new Set();
    seenByQid.set(qid, seen);
  }
  if (seen.has(event.id)) return false;
  seen.add(event.id);

  const prev = eventsByQid.get(qid) ?? [];
  const next = [...prev, event];
  eventsByQid.set(
    qid,
    next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next,
  );
  notify(qid);
  return true;
}

function notify(qid: string) {
  const subs = subscribersByQid.get(qid);
  if (!subs) return;
  for (const cb of subs) cb();
}

function subscribe(qid: string, cb: () => void): () => void {
  let set = subscribersByQid.get(qid);
  if (!set) {
    set = new Set();
    subscribersByQid.set(qid, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

/**
 * Open exactly one EventSource per quotationId for the entire app
 * lifetime. We deliberately do not close it on unmount so the events
 * persist across route navigation; the user can leave and come back
 * to a workspace without losing the trace history.
 */
function ensureStream(qid: string, queryClient: QueryClient) {
  if (streamsByQid.has(qid)) return;
  const source = new EventSource(`${API_BASE_URL}/quotations/${qid}/stream`);
  const handle = (evt: MessageEvent) => {
    try {
      const parsed = JSON.parse(evt.data) as AgentEvent;
      const added = appendEvent(qid, parsed);
      if (!added) return;
      queryClient.invalidateQueries({ queryKey: ['quotation', qid] });
      if (
        parsed.kind === 'brand.recommendation_made' ||
        parsed.kind === 'recommendation.superseded' ||
        parsed.kind === 'po.issued'
      ) {
        queryClient.invalidateQueries({ queryKey: ['quotations'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      }
    } catch {
      // ignore malformed
    }
  };
  for (const kind of KINDS) source.addEventListener(kind, handle);
  source.addEventListener('message', handle);
  streamsByQid.set(qid, source);
}

export function useNegotiationStream(quotationId: string | undefined) {
  const queryClient = useQueryClient();
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!quotationId) return;
    ensureStream(quotationId, queryClient);
    const unsub = subscribe(quotationId, () => setVersion((v) => v + 1));
    return unsub;
  }, [quotationId, queryClient]);

  const events = quotationId ? eventsByQid.get(quotationId) ?? [] : [];
  const lastEvent =
    events.length > 0 ? events[events.length - 1] ?? null : null;
  return { events, lastEvent };
}
