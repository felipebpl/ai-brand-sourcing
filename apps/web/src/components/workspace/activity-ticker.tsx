import { useEffect, useState } from 'react';
import type { AgentEvent } from '@/lib/sse';
import { supplierMeta } from '@/lib/suppliers';

type Props = {
  lastEvent: AgentEvent | null;
};

export function ActivityTicker({ lastEvent }: Props) {
  const [visible, setVisible] = useState<string | null>(null);

  useEffect(() => {
    if (!lastEvent) return;
    const phrase = describe(lastEvent);
    if (!phrase) return;
    setVisible(phrase);
    const t = setTimeout(() => setVisible(null), 8_000);
    return () => clearTimeout(t);
  }, [lastEvent]);

  if (!visible) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background/80 px-3 py-1.5 text-[12px] text-foreground shadow-sm backdrop-blur">
      <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
      {visible}
    </div>
  );
}

function describe(event: AgentEvent): string | null {
  const payload = event.payload as Record<string, unknown>;
  switch (event.kind) {
    case 'parser.started':
      return 'Parsing the quotation file…';
    case 'parser.progress': {
      const note =
        typeof payload.note === 'string' ? (payload.note as string) : null;
      return note ?? 'Extracting line items…';
    }
    case 'parser.completed':
      return 'Parsed. Opening negotiations.';
    case 'brand.thinking':
      return 'Planning the next round.';
    case 'brand.ask_sent': {
      const sid =
        typeof payload.supplierId === 'string'
          ? (payload.supplierId as string)
          : null;
      if (!sid) return 'Sent ask to a supplier.';
      const name = supplierMeta(sid).shortLabel;
      const dim =
        typeof payload.dimension === 'string'
          ? (payload.dimension as string)
          : null;
      return dim
        ? `Pushing ${name} on ${dim}.`
        : `Sent an ask to ${name}.`;
    }
    case 'supplier.responded': {
      const sid =
        typeof payload.supplierId === 'string'
          ? (payload.supplierId as string)
          : null;
      if (!sid) return 'A supplier replied.';
      const name = supplierMeta(sid).shortLabel;
      const intent =
        typeof payload.intent === 'string' ? (payload.intent as string) : null;
      if (intent === 'counter_offer') return `${name} sent a counter.`;
      if (intent === 'accept') return `${name} accepted.`;
      if (intent === 'walk_away') return `${name} walked away.`;
      if (intent === 'request_clarification')
        return `${name} asked for clarification.`;
      return `${name} replied.`;
    }
    case 'brand.round_summary': {
      const round =
        typeof payload.round === 'number' ? (payload.round as number) : null;
      return round ? `Round ${round} closed.` : 'Round closed.';
    }
    case 'brand.recommendation_made':
      return 'Winner recommended.';
    case 'recommendation.superseded':
      return 'Recommendation updated after new supplier signal.';
    case 'po.issued':
      return 'Purchase order issued.';
    default:
      return null;
  }
}
