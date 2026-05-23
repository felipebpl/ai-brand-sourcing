import { createContext, useContext, type ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { isSeedRfqId } from '@/lib/seed-rfq';
import { useNegotiationStream, type AgentEvent } from '@/lib/sse';

type StreamContextValue = {
  quotationId: string | undefined;
  events: AgentEvent[];
  lastEvent: AgentEvent | null;
};

const StreamContext = createContext<StreamContextValue>({
  quotationId: undefined,
  events: [],
  lastEvent: null,
});

export function NegotiationStreamProvider({ children }: { children: ReactNode }) {
  const { location } = useRouterState();
  const match = location.pathname.match(/^\/quotations\/([^/]+)/);
  const candidate = match?.[1];
  const quotationId =
    candidate && !isSeedRfqId(candidate) ? candidate : undefined;

  const { events, lastEvent } = useNegotiationStream(quotationId);

  return (
    <StreamContext.Provider value={{ quotationId, events, lastEvent }}>
      {children}
    </StreamContext.Provider>
  );
}

export function useStreamContext(): StreamContextValue {
  return useContext(StreamContext);
}
