import {
  Brain,
  ChevronRight,
  CircuitBoard,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { rfqNumber } from '@/lib/rfq';
import type { AgentActor, AgentEvent, AgentEventKind } from '@/lib/sse';
import { useStreamContext } from '@/lib/stream-context';
import { accentClasses, supplierMeta } from '@/lib/suppliers';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ActorKey = 'brand' | 'parser' | string;

type SessionGroup = {
  key: string;
  sessionId: string;
  actor: AgentActor;
  actorKey: ActorKey;
  label: string;
  events: AgentEvent[];
  startedAt: string;
  endedAt: string | null;
  costUsd: number | null;
  turns: number | null;
};

export function AskAmberPanel({ open, onOpenChange }: Props) {
  const { events, quotationId } = useStreamContext();

  const groups = useMemo(() => groupBySession(events), [events]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="size-3.5" />
            Ask Amber · execution trace
          </div>
          <SheetTitle className="font-display text-[18px] font-semibold tracking-tight">
            Behind the negotiation
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
                . Three independent Claude sessions — parser (Sonnet 4.6),
                brand orchestrator (Opus 4.7), and supplier agents (Haiku 4.5) —
                emit their tool calls, reasoning, and reads here as it
                happens.
              </>
            ) : (
              <>Open an RFQ to inspect the agents at work in real time.</>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto bg-muted/20">
          {!quotationId ? (
            <EmptyState />
          ) : groups.length === 0 ? (
            <WaitingState />
          ) : (
            <ol className="space-y-3 px-4 py-4">
              {groups.map((g) => (
                <SessionBlock key={g.key} group={g} />
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EmptyState() {
  return (
    <div className="m-4 rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-[12.5px] text-muted-foreground">
      Open any RFQ from the list to start watching the agents.
    </div>
  );
}

function WaitingState() {
  return (
    <div className="m-4 rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-[12.5px] text-muted-foreground">
      No events yet. Activity will appear here the moment the agents start
      working.
    </div>
  );
}

function SessionBlock({ group }: { group: SessionGroup }) {
  const [open, setOpen] = useState(true);
  const palette = paletteFor(group.actor);

  return (
    <li className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40',
          palette.border,
        )}
      >
        <span
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold uppercase tracking-wider',
            palette.bg,
            palette.text,
          )}
        >
          {palette.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[13px] font-semibold tracking-tight text-foreground">
              {palette.title}
            </span>
            <span className="text-[10.5px] text-muted-foreground">
              {palette.modelTag}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {group.label}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[10.5px] text-muted-foreground">
          <span>{group.events.length} events</span>
          {group.endedAt ? (
            <span className="font-mono tabular">
              {durationMs(group.startedAt, group.endedAt)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-primary">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              live
            </span>
          )}
          <ChevronRight
            className={cn(
              'size-3.5 transition-transform',
              open && 'rotate-90',
            )}
          />
        </div>
      </button>

      {open ? (
        <ol className="divide-y divide-border/70 bg-background">
          {group.events.map((e) => (
            <EventRow key={e.id} event={e} palette={palette} />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

type Palette = {
  initials: string;
  title: string;
  modelTag: string;
  bg: string;
  text: string;
  border: string;
};

function paletteFor(actor: AgentActor): Palette {
  if (actor.kind === 'parser') {
    return {
      initials: 'PS',
      title: 'Parser agent',
      modelTag: 'Sonnet 4.6 · subagent on the upload',
      bg: 'bg-[oklch(0.92_0.05_195)]',
      text: 'text-[oklch(0.30_0.12_200)]',
      border: 'border-l-[oklch(0.65_0.13_200)]',
    };
  }
  if (actor.kind === 'brand') {
    return {
      initials: 'BR',
      title: 'Brand orchestrator',
      modelTag: 'Opus 4.7 · negotiation lead',
      bg: 'bg-primary/15',
      text: 'text-primary',
      border: 'border-l-primary',
    };
  }
  const meta = supplierMeta(actor.supplierId);
  const accent = accentClasses(meta.accent);
  return {
    initials: meta.initials,
    title: `${meta.shortLabel}`,
    modelTag: 'Haiku 4.5 · supplier session',
    bg: accent.bg,
    text: accent.text,
    border: borderFromAccent(meta.accent),
  };
}

function borderFromAccent(accent: 'teal' | 'indigo' | 'coral'): string {
  switch (accent) {
    case 'indigo':
      return 'border-l-[oklch(0.55_0.16_255)]';
    case 'coral':
      return 'border-l-[oklch(0.62_0.16_30)]';
    case 'teal':
    default:
      return 'border-l-[oklch(0.62_0.13_195)]';
  }
}

function EventRow({
  event,
  palette,
}: {
  event: AgentEvent;
  palette: Palette;
}) {
  const [open, setOpen] = useState(false);

  if (event.kind === 'agent.text') {
    return (
      <TextRow event={event} palette={palette} />
    );
  }

  if (event.kind === 'agent.session_started') {
    return (
      <li className="flex items-center gap-2 px-4 py-1.5 text-[10.5px] text-muted-foreground">
        <span className="size-1 rounded-full bg-muted-foreground/60" />
        Session started
        <span className="ml-auto font-mono tabular">
          {timeStamp(event.occurredAt)}
        </span>
      </li>
    );
  }

  if (event.kind === 'agent.session_completed') {
    const payload = event.payload as {
      costUsd?: number;
      turns?: number;
      aborted?: boolean;
    };
    return (
      <li className="flex items-center gap-2 border-t border-border/60 bg-muted/30 px-4 py-1.5 text-[10.5px] text-muted-foreground">
        <span className="size-1 rounded-full bg-muted-foreground/60" />
        {payload.aborted ? 'Session aborted' : 'Session completed'}
        {payload.turns != null ? (
          <span className="font-mono tabular">{payload.turns} turns</span>
        ) : null}
        {payload.costUsd != null ? (
          <span className="font-mono tabular">
            ${payload.costUsd.toFixed(4)}
          </span>
        ) : null}
        <span className="ml-auto font-mono tabular">
          {timeStamp(event.occurredAt)}
        </span>
      </li>
    );
  }

  const summary = summarize(event);
  const isTool = event.kind === 'brand.thinking';

  return (
    <li className="border-l-2 border-transparent">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2.5 px-4 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border bg-muted text-muted-foreground">
          {isTool ? (
            <Wrench className="size-3" />
          ) : (
            <CircuitBoard className="size-3" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[12px] text-foreground">
              {summary.title}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {timeStamp(event.occurredAt)}
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
            'mt-1 size-3 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
      {open ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-border/60 bg-muted/20 px-4 py-2 font-mono text-[10.5px] leading-relaxed text-foreground/85">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

function TextRow({
  event,
  palette,
}: {
  event: AgentEvent;
  palette: Palette;
}) {
  const payload = event.payload as { variant?: string; text?: string };
  const text = payload.text ?? '';
  const isThinking = payload.variant === 'thinking';

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        {isThinking ? (
          <Brain className={cn('size-3', palette.text)} />
        ) : (
          <span
            className={cn('inline-block size-1.5 rounded-full', palette.bg)}
          />
        )}
        <span>{isThinking ? 'Thinking' : 'Reasoning'}</span>
        <span className="ml-auto font-mono text-muted-foreground">
          {timeStamp(event.occurredAt)}
        </span>
      </div>
      <p
        className={cn(
          'mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed',
          isThinking
            ? 'italic text-muted-foreground'
            : 'text-foreground',
        )}
      >
        {text}
      </p>
    </li>
  );
}

function groupBySession(events: AgentEvent[]): SessionGroup[] {
  const byId = new Map<string, SessionGroup>();
  const orphan: SessionGroup = {
    key: 'orphan',
    sessionId: 'orphan',
    actor: { kind: 'brand' },
    actorKey: 'brand',
    label: 'Domain events',
    events: [],
    startedAt: events[0]?.occurredAt ?? new Date().toISOString(),
    endedAt: null,
    costUsd: null,
    turns: null,
  };

  for (const e of events) {
    const payload = e.payload as {
      sessionId?: string;
      actor?: AgentActor;
      label?: string;
      costUsd?: number;
      turns?: number;
    };
    const sid = payload.sessionId;
    if (!sid) {
      orphan.events.push(e);
      orphan.endedAt = e.occurredAt;
      continue;
    }
    let group = byId.get(sid);
    if (!group) {
      group = {
        key: sid,
        sessionId: sid,
        actor: payload.actor ?? { kind: 'brand' },
        actorKey:
          payload.actor?.kind === 'supplier'
            ? payload.actor.supplierId
            : payload.actor?.kind ?? 'brand',
        label: payload.label ?? '—',
        events: [],
        startedAt: e.occurredAt,
        endedAt: null,
        costUsd: null,
        turns: null,
      };
      byId.set(sid, group);
    }
    if (e.kind === 'agent.session_started' && payload.label) {
      group.label = payload.label;
    }
    if (e.kind === 'agent.session_completed') {
      group.endedAt = e.occurredAt;
      if (typeof payload.costUsd === 'number') group.costUsd = payload.costUsd;
      if (typeof payload.turns === 'number') group.turns = payload.turns;
    }
    group.events.push(e);
  }

  const groups = Array.from(byId.values());
  if (orphan.events.length > 0) groups.push(orphan);

  groups.sort(
    (a, b) =>
      new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
  return groups;
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
        title: `${isPre ? '→' : '←'} ${prettyTool(tool)}`,
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
      return { title: e.kind as AgentEventKind };
  }
}

function prettyTool(name: string): string {
  if (name === 'Bash') return 'Bash · run script';
  if (name === 'Read') return 'Read · file';
  if (name === 'Write') return 'Write · file';
  if (name === 'Agent') return 'Agent · spawn subagent';
  if (name.startsWith('mcp__'))
    return (
      name
        .replace(/^mcp__[a-z_]+__/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()) + ' · MCP tool'
    );
  return name;
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

function durationMs(start: string, end: string): string {
  const ms = Math.max(0, Date.parse(end) - Date.parse(start));
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return `${m}m${rest}s`;
}
