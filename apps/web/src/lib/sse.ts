import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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

const MAX_EVENTS = 200;

/**
 * Subscribe to the SSE stream for a quotation. Accumulates events for
 * rich narration panels and exposes the most recent event for any
 * compact ticker. On every agent event the quotation detail query is
 * invalidated so React Query refetches authoritative state (messages
 * persisted server-side).
 */
export function useNegotiationStream(quotationId: string | undefined) {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!quotationId) return;
    seenIds.current = new Set();
    setEvents([]);
    const url = `${API_BASE_URL}/quotations/${quotationId}/stream`;
    const source = new EventSource(url);

    const handle = (evt: MessageEvent) => {
      try {
        const parsed = JSON.parse(evt.data) as AgentEvent;
        if (seenIds.current.has(parsed.id)) return;
        seenIds.current.add(parsed.id);
        setEvents((prev) => {
          const next = [...prev, parsed];
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });
        queryClient.invalidateQueries({
          queryKey: ['quotation', quotationId],
        });
        if (
          parsed.kind === 'brand.recommendation_made' ||
          parsed.kind === 'recommendation.superseded'
        ) {
          queryClient.invalidateQueries({ queryKey: ['quotations'] });
        }
      } catch {
        // ignore malformed
      }
    };

    for (const kind of KINDS) source.addEventListener(kind, handle);
    source.addEventListener('message', handle);

    return () => {
      for (const kind of KINDS) source.removeEventListener(kind, handle);
      source.removeEventListener('message', handle);
      source.close();
    };
  }, [quotationId, queryClient]);

  const lastEvent = events.length > 0 ? events[events.length - 1] ?? null : null;
  return { events, lastEvent };
}
