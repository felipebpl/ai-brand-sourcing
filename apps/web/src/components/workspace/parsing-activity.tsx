import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import type { QuotationLineRow } from '@/lib/api';
import { money } from '@/lib/format';
import type { AgentEvent } from '@/lib/sse';
import { cn } from '@/lib/utils';

type Props = {
  events: AgentEvent[];
  lines: QuotationLineRow[];
  status: 'uploaded' | 'parsing';
};

type Step = {
  key: string;
  label: string;
  detail?: string;
  state: 'done' | 'active' | 'pending';
};

export function ParsingActivity({ events, lines, status }: Props) {
  const steps = useMemo(() => buildSteps(events, lines, status), [
    events,
    lines,
    status,
  ]);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-accent/30 px-6 py-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="size-3.5" />
          Reading the supplier quote
        </div>
        <h2 className="mt-1.5 font-display text-[20px] font-semibold tracking-tight text-foreground">
          Parsing in flight
        </h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          We open the file, find the products table, match SKUs against your
          catalog, and normalize prices. Usually under a minute.
        </p>
      </div>

      <ol className="divide-y divide-border">
        {steps.map((step) => (
          <li
            key={step.key}
            className="flex items-start gap-3 px-6 py-3 text-[13px]"
          >
            <StepIcon state={step.state} />
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  step.state === 'pending'
                    ? 'text-muted-foreground'
                    : 'text-foreground',
                  step.state === 'active' && 'font-medium',
                )}
              >
                {step.label}
              </div>
              {step.detail ? (
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {step.detail}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {lines.length > 0 ? (
        <div className="border-t border-border bg-muted/30 px-6 py-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Extracted so far
          </div>
          <ul className="mt-2 space-y-1">
            {lines.slice(0, 8).map((line) => (
              <li
                key={line.id}
                className="flex items-center justify-between gap-3 text-[12px]"
              >
                <span className="flex items-center gap-2 min-w-0 truncate">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {line.matchedSku ?? line.rawSku ?? '—'}
                  </span>
                  <span className="truncate text-foreground">
                    {line.rawDescription ?? '—'}
                  </span>
                </span>
                <span className="font-mono text-[11px] tabular text-muted-foreground">
                  qty {line.minQty} · {money(line.unitPrice, line.currency)}
                </span>
              </li>
            ))}
            {lines.length > 8 ? (
              <li className="pt-1 text-[11px] italic text-muted-foreground">
                + {lines.length - 8} more
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StepIcon({ state }: { state: Step['state'] }) {
  if (state === 'done') {
    return (
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
    );
  }
  if (state === 'active') {
    return (
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
    );
  }
  return (
    <span className="mt-1.5 inline-block size-2 shrink-0 rounded-full border border-border bg-background" />
  );
}

const TOOL_TO_PHRASE: Record<string, string> = {
  Bash: 'Opening the spreadsheet with Python',
  Read: 'Inspecting cells',
  mcp__parser__lookup_catalog: 'Looking up SKU against the catalog',
  mcp__parser__submit_extraction: 'Finalizing the structured extraction',
};

function buildSteps(
  events: AgentEvent[],
  lines: QuotationLineRow[],
  status: Props['status'],
): Step[] {
  const completed = events.some((e) => e.kind === 'parser.completed');
  const toolEvents = events.filter(
    (e) => e.kind === 'brand.thinking' || e.kind === 'parser.progress',
  );

  const seenTools: Array<{ tool: string; latestPhase: string }> = [];
  for (const e of toolEvents) {
    const payload = e.payload as {
      phase?: string;
      toolName?: string;
      note?: string;
    };
    const tool = payload.toolName ?? '';
    if (!tool) continue;
    const existing = seenTools.find((s) => s.tool === tool);
    if (existing) {
      existing.latestPhase = payload.phase ?? existing.latestPhase;
    } else {
      seenTools.push({ tool, latestPhase: payload.phase ?? 'pre_tool_use' });
    }
  }

  const toolSteps: Step[] = seenTools.map((s) => ({
    key: `tool:${s.tool}`,
    label: TOOL_TO_PHRASE[s.tool] ?? humanizeTool(s.tool),
    state: s.latestPhase === 'post_tool_use' ? 'done' : 'active',
  }));

  const head: Step[] = [
    {
      key: 'opened',
      label: 'Quote received from the supplier',
      state: 'done',
    },
    {
      key: 'starting',
      label: 'Parser agent picking up the file',
      state:
        status === 'uploaded' && toolSteps.length === 0 ? 'active' : 'done',
    },
  ];

  const tail: Step[] = [];
  if (lines.length > 0 || completed) {
    tail.push({
      key: 'extracted',
      label: `Extracted ${lines.length || '…'} line item${
        lines.length === 1 ? '' : 's'
      }`,
      state: completed ? 'done' : lines.length > 0 ? 'active' : 'pending',
    });
  }
  tail.push({
    key: 'done',
    label: 'Handing off to the brand agent for negotiation',
    state: completed ? 'done' : 'pending',
  });

  return [...head, ...toolSteps, ...tail];
}

function humanizeTool(name: string): string {
  return (
    name
      .replace(/^mcp__[a-z_]+__/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Working'
  );
}
