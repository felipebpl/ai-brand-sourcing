import { ChevronRight, Sparkles } from 'lucide-react';
import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { rfqNumber } from '@/lib/rfq';
import { supplierMeta } from '@/lib/suppliers';
import type { AgentEvent } from '@/lib/sse';
import { useStreamContext } from '@/lib/stream-context';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AskAmberPanel({ open, onOpenChange }: Props) {
  const { events, quotationId } = useStreamContext();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="size-3.5" />
            Ask Amber
          </div>
          <SheetTitle className="font-display text-[18px] font-semibold tracking-tight">
            Execution trace
          </SheetTitle>
          <SheetDescription className="text-[12.5px]">
            {quotationId ? (
              <>
                Live agent activity for{' '}
                <span className="font-mono text-foreground">
                  {rfqNumber({
                    id: quotationId,
                    createdAt: new Date().toISOString(),
                  })}
                </span>
                . {events.length} event{events.length === 1 ? '' : 's'}{' '}
                received so far.
              </>
            ) : (
              <>Open an RFQ to inspect the agents at work in real time.</>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!quotationId ? (
            <EmptyState />
          ) : events.length === 0 ? (
            <WaitingState />
          ) : (
            <ol className="space-y-2">
              {events.map((e, i) => {
                const prev = i > 0 ? events[i - 1] : null;
                return <EventRow key={e.id} event={e} prev={prev ?? null} />;
              })}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-[12.5px] text-muted-foreground">
      Open any RFQ from the list to start watching the agents.
    </div>
  );
}

function WaitingState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-[12.5px] text-muted-foreground">
      No events yet. Activity will appear here the moment the agents
      start working.
    </div>
  );
}

function EventRow({
  event,
  prev,
}: {
  event: AgentEvent;
  prev: AgentEvent | null;
}) {
  const [open, setOpen] = useState(false);
  const { kind, payload, occurredAt } = event;
  const summary = summarize(event);
  const tone = toneFor(kind);
  const showDelta =
    prev && msBetween(prev.occurredAt, occurredAt) > 0;

  return (
    <li className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-3 py-2 text-left"
      >
        <span
          className={cn(
            'mt-0.5 inline-flex shrink-0 items-center justify-center rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
            tone,
          )}
        >
          {actorFor(kind)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[12.5px] font-medium text-foreground">
              {summary.title}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {timeStamp(occurredAt)}
              {showDelta ? (
                <>
                  {' '}+{msBetween(prev!.occurredAt, occurredAt)}ms
                </>
              ) : null}
            </span>
          </div>
          {summary.detail ? (
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
              {summary.detail}
            </div>
          ) : null}
        </div>
        <ChevronRight
          className={cn(
            'mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
      {open ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-border bg-muted/30 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-foreground/85">
          {JSON.stringify(payload, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

function actorFor(kind: AgentEvent['kind']): string {
  if (kind.startsWith('parser')) return 'Parser';
  if (kind.startsWith('brand')) return 'Brand';
  if (kind.startsWith('supplier')) return 'Supplier';
  if (kind.startsWith('recommendation')) return 'Brand';
  if (kind === 'po.issued') return 'System';
  return 'Agent';
}

function toneFor(kind: AgentEvent['kind']): string {
  if (kind.startsWith('parser'))
    return 'bg-[oklch(0.92_0.05_195)] text-[oklch(0.38_0.12_200)]';
  if (kind.startsWith('brand'))
    return 'bg-primary/15 text-primary';
  if (kind.startsWith('supplier'))
    return 'bg-[oklch(0.92_0.06_30)] text-[oklch(0.45_0.16_30)]';
  if (kind.startsWith('recommendation'))
    return 'bg-success/15 text-success';
  if (kind === 'po.issued') return 'bg-foreground text-background';
  return 'bg-muted text-muted-foreground';
}

function summarize(e: AgentEvent): { title: string; detail?: string } {
  const p = e.payload as Record<string, unknown>;
  switch (e.kind) {
    case 'parser.started':
      return { title: 'Parser started' };
    case 'parser.progress':
      return {
        title: 'Parser progress',
        detail: typeof p.note === 'string' ? (p.note as string) : undefined,
      };
    case 'parser.completed':
      return { title: 'Parser completed' };
    case 'brand.thinking': {
      const phase =
        typeof p.phase === 'string' ? (p.phase as string) : 'thinking';
      const tool =
        typeof p.toolName === 'string' ? (p.toolName as string) : 'unknown';
      const isPre = phase === 'pre_tool_use';
      return {
        title: `${isPre ? '→' : '←'} ${tool}`,
        detail: detailForTool(tool, isPre ? p.toolInput : p.toolResponse),
      };
    }
    case 'brand.ask_sent': {
      const sid =
        typeof p.supplierId === 'string' ? (p.supplierId as string) : null;
      return {
        title: `Brand → ${sid ? supplierMeta(sid).shortLabel : 'supplier'}`,
        detail:
          typeof p.dimension === 'string'
            ? `dimension: ${p.dimension as string}`
            : undefined,
      };
    }
    case 'supplier.responded': {
      const sid =
        typeof p.supplierId === 'string' ? (p.supplierId as string) : null;
      const intent =
        typeof p.intent === 'string' ? (p.intent as string) : undefined;
      return {
        title: `${sid ? supplierMeta(sid).shortLabel : 'Supplier'} → Brand`,
        detail: intent ? `intent: ${intent}` : undefined,
      };
    }
    case 'brand.round_summary': {
      const round = typeof p.round === 'number' ? (p.round as number) : null;
      return { title: round ? `Round ${round} summary` : 'Round summary' };
    }
    case 'brand.recommendation_made':
      return { title: 'Recommendation made' };
    case 'recommendation.superseded':
      return {
        title: 'Recommendation superseded',
        detail:
          typeof p.reason === 'string' ? (p.reason as string) : undefined,
      };
    case 'po.issued':
      return { title: 'Purchase order issued' };
    default:
      return { title: e.kind };
  }
}

function detailForTool(tool: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  if (tool === 'Bash' && typeof obj.command === 'string') {
    const cmd = (obj.command as string).split('\n')[0] ?? '';
    return cmd.length > 80 ? `${cmd.slice(0, 80)}…` : cmd;
  }
  if (tool === 'Read' && typeof obj.file_path === 'string') {
    return obj.file_path as string;
  }
  if (tool === 'mcp__parser__lookup_catalog') {
    const sku =
      typeof obj.rawSku === 'string'
        ? (obj.rawSku as string)
        : typeof obj.sku === 'string'
        ? (obj.sku as string)
        : null;
    return sku ? `sku: ${sku}` : undefined;
  }
  return undefined;
}

function timeStamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function msBetween(a: string, b: string): number {
  return Math.max(0, Date.parse(b) - Date.parse(a));
}
