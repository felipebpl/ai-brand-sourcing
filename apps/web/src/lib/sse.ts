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

/**
 * Subscribe to the SSE stream for a quotation. On every agent event we
 * invalidate the quotation detail query so React Query refetches the
 * authoritative state. We also expose the most recent event for the UI
 * to flash micro-narration above the supplier cards.
 */
export function useNegotiationStream(quotationId: string | undefined) {
  const queryClient = useQueryClient();
  const [lastEvent, setLastEvent] = useState<AgentEvent | null>(null);

  useEffect(() => {
    if (!quotationId) return;
    const url = `${API_BASE_URL}/quotations/${quotationId}/stream`;
    const source = new EventSource(url);

    const handle = (evt: MessageEvent) => {
      try {
        const parsed = JSON.parse(evt.data) as AgentEvent;
        setLastEvent(parsed);
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

  return { lastEvent };
}
