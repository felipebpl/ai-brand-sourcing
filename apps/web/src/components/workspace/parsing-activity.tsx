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

type StepState = 'done' | 'active' | 'pending';

type Step = {
  key: string;
  label: string;
  detail?: string;
  state: StepState;
};

const STAGES: Array<{
  key: string;
  label: string;
}> = [
  { key: 'received', label: 'Quote received from the supplier' },
  { key: 'opened', label: 'Picking up the file' },
  { key: 'reading', label: 'Reading the workbook' },
  { key: 'matching', label: 'Matching SKUs against the catalog' },
  { key: 'handoff', label: 'Handing off to the negotiation engine' },
];

export function ParsingActivity({ events, lines, status }: Props) {
  const steps = useMemo(
    () => buildSteps(events, lines, status),
    [events, lines, status],
  );

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
          Open the file, find the products table, match every SKU against the
          catalog, normalize prices. We'll start the negotiation as soon as the
          extraction is finalized.
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
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
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
          <ul className="mt-2 space-y-1.5">
            {lines.slice(0, 12).map((line) => (
              <li key={line.id} className="text-[12px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    <span className="font-mono text-[11px] text-foreground">
                      {line.matchedSku ?? line.rawSku ?? '—'}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {line.rawDescription ?? '—'}
                    </span>
                  </span>
                  <span className="font-mono text-[11px] tabular text-muted-foreground">
                    qty {line.minQty} · {money(line.unitPrice, line.currency)}
                  </span>
                </div>
                {line.matchedSku &&
                line.rawSku &&
                line.matchedSku !== line.rawSku ? (
                  <div
                    className="ml-1 mt-0.5 truncate font-mono text-[10.5px] italic text-muted-foreground"
                    title={line.matchReasoning ?? undefined}
                  >
                    matched from {line.rawSku}
                    {line.matchConfidence
                      ? ` · ${Math.round(
                          Number.parseFloat(line.matchConfidence) * 100,
                        )}% confidence`
                      : ''}
                  </div>
                ) : null}
              </li>
            ))}
            {lines.length > 12 ? (
              <li className="pt-1 text-[11px] italic text-muted-foreground">
                + {lines.length - 12} more
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') {
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />;
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

function buildSteps(
  events: AgentEvent[],
  lines: QuotationLineRow[],
  status: Props['status'],
): Step[] {
  const completed = events.some((e) => e.kind === 'parser.completed');
  const hasLines = lines.length > 0;
  const isParsing = status === 'parsing';

  const latestToolHint = liveToolHint(events);
  const isMatching = isMatchingSkus(events);
  const isReading = isReadingWorkbook(events);

  const STATE: Record<string, StepState> = {
    received: 'done',
    opened: 'done',
    reading: completed || hasLines ? 'done' : isParsing ? 'active' : 'pending',
    matching: completed
      ? 'done'
      : hasLines || isMatching
      ? 'active'
      : 'pending',
    handoff: completed ? 'done' : 'pending',
  };

  return STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    detail:
      s.key === 'reading' && STATE.reading === 'active' && isReading
        ? latestToolHint
        : s.key === 'matching' && STATE.matching === 'active' && !isReading
        ? latestToolHint
        : undefined,
    state: STATE[s.key] ?? 'pending',
  }));
}

function liveToolHint(events: AgentEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e) continue;
    if (e.kind !== 'brand.thinking') continue;
    const payload = e.payload as {
      phase?: string;
      toolName?: string;
      toolInput?: unknown;
    };
    if (payload.phase !== 'pre_tool_use') continue;
    const hint = toolHint(payload.toolName ?? '', payload.toolInput);
    if (hint) return hint;
  }
  return undefined;
}

function isMatchingSkus(events: AgentEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.kind !== 'brand.thinking') continue;
    const payload = e.payload as { phase?: string; toolName?: string };
    if (payload.phase !== 'pre_tool_use') continue;
    return payload.toolName === 'mcp__parser__lookup_catalog';
  }
  return false;
}

function isReadingWorkbook(events: AgentEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.kind !== 'brand.thinking') continue;
    const payload = e.payload as { phase?: string; toolName?: string };
    if (payload.phase !== 'pre_tool_use') continue;
    return payload.toolName === 'Bash' || payload.toolName === 'Read';
  }
  return false;
}

function toolHint(toolName: string, input: unknown): string | undefined {
  const inputObj =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};

  if (toolName === 'Bash') {
    const cmd = typeof inputObj.command === 'string' ? inputObj.command : '';
    if (cmd.includes('wb.sheetnames')) return 'listing sheets';
    if (cmd.includes('merged_cells')) return 'resolving merged cells';
    if (cmd.includes('iter_rows')) return 'scanning the products table';
    if (cmd.includes('cell(') || cmd.includes('ws['))
      return 'reading individual cells';
    return 'looking through the file';
  }
  if (toolName === 'Read') return 'reading the file structure';
  if (toolName === 'mcp__parser__lookup_catalog') {
    const raw =
      typeof inputObj.rawSku === 'string'
        ? (inputObj.rawSku as string)
        : typeof inputObj.sku === 'string'
        ? (inputObj.sku as string)
        : null;
    return raw ? `looking up ${raw}` : 'matching SKUs';
  }
  if (toolName === 'mcp__parser__submit_extraction')
    return 'finalizing the structured extraction';
  return undefined;
}
