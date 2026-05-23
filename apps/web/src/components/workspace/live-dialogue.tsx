import { Brain, Building2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type {
  NegotiationMessageRow,
  NegotiationRow,
  QuotationDetailResponse,
} from '@/lib/api';
import { money } from '@/lib/format';
import type { AgentEvent } from '@/lib/sse';
import { accentClasses, supplierMeta } from '@/lib/suppliers';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';

type TimelineItem =
  | {
      kind: 'message';
      id: string;
      at: string;
      msg: NegotiationMessageRow;
      negotiation: NegotiationRow;
    }
  | {
      kind: 'round';
      id: string;
      at: string;
      round: number;
    }
  | {
      kind: 'thinking';
      id: string;
      at: string;
      label: string;
    };

type Props = {
  quotation: QuotationDetailResponse['quotation'];
  negotiations: NegotiationRow[];
  events: AgentEvent[];
};

export function LiveDialogue({ quotation, negotiations, events }: Props) {
  const items = useMemo(
    () => buildTimeline(negotiations, events),
    [negotiations, events],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastItemId = items[items.length - 1]?.id ?? null;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lastItemId]);

  const maxRound = Math.max(0, ...negotiations.map((n) => n.roundsCount));
  const isLive =
    quotation.status === 'negotiating' || quotation.status === 'parsed';
  const title = isLive ? 'Live negotiation' : 'Negotiation history';

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-full bg-accent text-primary">
            <Sparkles className="size-3.5" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </div>
            <div className="text-[12.5px] font-medium text-foreground">
              {isLive
                ? `Round ${maxRound || 1} · in progress`
                : `Concluded after ${maxRound} round${maxRound === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>
        {isLive ? (
          <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-primary">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            Streaming
          </div>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        className="max-h-[560px] overflow-y-auto px-5 py-4"
      >
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          <ol className="space-y-3">
            {items.map((item) => (
              <li key={item.id}>
                {item.kind === 'round' ? (
                  <RoundDivider round={item.round} />
                ) : item.kind === 'thinking' ? (
                  <ThinkingNote label={item.label} />
                ) : (
                  <MessageCard
                    msg={item.msg}
                    negotiation={item.negotiation}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="px-2 py-6 text-center">
      <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Brain className="size-4" />
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Brand agent is preparing the opening ask. Watch this space.
      </p>
    </div>
  );
}

function RoundDivider({ round }: { round: number }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Round {round}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function ThinkingNote({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-2 text-[11.5px] italic text-muted-foreground">
      <Brain className="mt-0.5 size-3 shrink-0" />
      <span>{label}</span>
    </div>
  );
}

function MessageCard({
  msg,
  negotiation,
}: {
  msg: NegotiationMessageRow;
  negotiation: NegotiationRow;
}) {
  const supplier = supplierMeta(negotiation.supplierId);
  const isBrand = msg.role === 'brand';
  const accent = accentClasses(supplier.accent);

  if (isBrand) {
    return (
      <div className="flex gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/90 text-[10px] font-semibold uppercase text-background">
          V
        </div>
        <div className="min-w-0 flex-1 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center justify-between text-[10.5px] uppercase tracking-wider text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">Valden</span> →{' '}
              {supplier.shortLabel}
            </span>
            <span className="tabular">{formatRelative(msg.createdAt)}</span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground">
            {msg.content}
          </p>
          {msg.offer ? <OfferChip offer={msg.offer} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
          accent.bg,
          accent.text,
        )}
      >
        {supplier.initials}
      </div>
      <div
        className={cn(
          'min-w-0 flex-1 rounded-lg border p-3',
          'border-border bg-muted/30',
        )}
      >
        <div className="flex items-center justify-between text-[10.5px] uppercase tracking-wider text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">
              {supplier.shortLabel}
            </span>{' '}
            → Valden
          </span>
          <span className="tabular">{formatRelative(msg.createdAt)}</span>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground">
          {msg.content}
        </p>
        {msg.offer ? <OfferChip offer={msg.offer} /> : null}
        {msg.metadata && typeof msg.metadata === 'object' ? (
          <IntentTag metadata={msg.metadata} />
        ) : null}
      </div>
    </div>
  );
}

function OfferChip({
  offer,
}: {
  offer: NonNullable<NegotiationMessageRow['offer']>;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 font-mono text-foreground tabular">
        <Building2 className="size-2.5 text-muted-foreground" />
        {money(offer.unitPriceAvg, offer.currency)}/unit
      </span>
      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 font-mono text-foreground tabular">
        {offer.leadTimeDays}d
      </span>
      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 font-mono text-foreground">
        {offer.paymentTerms.display}
      </span>
      {offer.fulfillablePct < 1 ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-attention/40 bg-attention/10 px-2 py-0.5 font-mono text-attention-foreground">
          only {Math.round(offer.fulfillablePct * 100)}%
        </span>
      ) : null}
    </div>
  );
}

function IntentTag({ metadata }: { metadata: Record<string, unknown> }) {
  const intent =
    typeof metadata.intent === 'string' ? (metadata.intent as string) : null;
  if (!intent) return null;
  const label = INTENT_LABEL[intent] ?? intent.replace(/_/g, ' ');
  return (
    <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
  );
}

const INTENT_LABEL: Record<string, string> = {
  counter_offer: 'Countered',
  accept: 'Accepted',
  walk_away: 'Walked away',
  request_clarification: 'Asked for clarification',
};

function buildTimeline(
  negotiations: NegotiationRow[],
  events: AgentEvent[],
): TimelineItem[] {
  const negotiationById = new Map(negotiations.map((n) => [n.id, n]));
  const messages: TimelineItem[] = [];
  for (const n of negotiations) {
    for (const m of n.messages) {
      messages.push({
        kind: 'message',
        id: m.id,
        at: m.createdAt,
        msg: m,
        negotiation: n,
      });
    }
  }

  const roundSummaries: TimelineItem[] = events
    .filter((e) => e.kind === 'brand.round_summary')
    .map((e) => ({
      kind: 'round' as const,
      id: e.id,
      at: e.occurredAt,
      round:
        typeof e.payload.round === 'number' ? (e.payload.round as number) : 0,
    }));

  const thinkingNotes: TimelineItem[] = events
    .filter((e) => e.kind === 'brand.thinking')
    .map((e) => {
      const payload = e.payload as {
        phase?: string;
        toolName?: string;
      };
      if (payload.phase !== 'pre_tool_use') return null;
      const label = describeBrandThinking(payload.toolName ?? '');
      if (!label) return null;
      return {
        kind: 'thinking' as const,
        id: e.id,
        at: e.occurredAt,
        label,
      };
    })
    .filter((x): x is Exclude<typeof x, null> => x != null);

  // De-dupe identical thinking notes back-to-back.
  const dedupedThinking: TimelineItem[] = [];
  for (const t of thinkingNotes) {
    const last = dedupedThinking[dedupedThinking.length - 1];
    if (
      last &&
      last.kind === 'thinking' &&
      t.kind === 'thinking' &&
      last.label === t.label
    ) {
      continue;
    }
    dedupedThinking.push(t);
  }

  const all = [...messages, ...roundSummaries, ...dedupedThinking];
  all.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  void negotiationById; // reserved for future per-negotiation grouping
  return all;
}

function describeBrandThinking(toolName: string): string | null {
  if (!toolName) return null;
  if (toolName.endsWith('submit_recommendation')) {
    return 'Finalizing the recommendation.';
  }
  if (toolName.endsWith('ask_supplier') || toolName === 'Agent') {
    return 'Drafting the next ask.';
  }
  if (toolName.endsWith('submit_extraction')) {
    return null;
  }
  return null;
}
