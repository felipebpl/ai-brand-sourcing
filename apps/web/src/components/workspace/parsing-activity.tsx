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
  // The parser bounces between Bash, lookup_catalog, more Bash (e.g.
  // to extract footer metadata), more lookup_catalog, etc. Looking at
  // only the *latest* tool use makes the step indicator flicker
  // backwards. Instead, derive each step from whether the parser has
  // *ever* reached that phase — monotonic forward progression.
  const completed = events.some((e) => e.kind === 'parser.completed');
  const hasLines = lines.length > 0;
  const isParsing = status === 'parsing';

  const everSawBashOrRead = events.some(isPreToolEvent('Bash', 'Read'));
  const everSawLookup = events.some(
    isPreToolEvent('mcp__parser__lookup_catalog'),
  );
  const everSawSubmit = events.some(
    isPreToolEvent('mcp__parser__submit_extraction'),
  );

  // "Reading" advances to done the moment the parser starts matching
  // SKUs (it has, by then, opened and read the workbook). "Matching"
  // advances to done when lines land in the DB. "Handoff" lights up
  // once the terminal submit_extraction has been called.
  const STATE: Record<string, StepState> = {
    received: 'done',
    opened: 'done',
    reading:
      completed || hasLines || everSawLookup
        ? 'done'
        : everSawBashOrRead || isParsing
        ? 'active'
        : 'pending',
    matching: completed || hasLines
      ? 'done'
      : everSawLookup
      ? 'active'
      : 'pending',
    handoff: completed
      ? 'done'
      : hasLines || everSawSubmit
      ? 'active'
      : 'pending',
  };

  return STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    detail:
      STATE[s.key] === 'active'
        ? activeStepHint(s.key, events)
        : undefined,
    state: STATE[s.key] ?? 'pending',
  }));
}

/**
 * Surface a contextual sub-text for whichever step is currently active.
 * Uses the latest tool event to describe what's happening *right now*
 * (e.g. "looking up MB013-0BS-XL" during matching), but only on the
 * step that's actually active per the monotonic state machine — so the
 * hint never appears next to a "done" or "pending" row.
 */
function activeStepHint(
  stepKey: string,
  events: AgentEvent[],
): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.kind !== 'brand.thinking') continue;
    const payload = e.payload as {
      phase?: string;
      toolName?: string;
      toolInput?: unknown;
    };
    if (payload.phase !== 'pre_tool_use') continue;
    const tool = payload.toolName ?? '';
    const isFsTool = tool === 'Bash' || tool === 'Read';
    const isLookup = tool === 'mcp__parser__lookup_catalog';
    const isSubmit = tool === 'mcp__parser__submit_extraction';

    if (stepKey === 'reading' && isFsTool)
      return toolHint(tool, payload.toolInput);
    if (stepKey === 'matching' && isLookup)
      return toolHint(tool, payload.toolInput);
    if (stepKey === 'handoff' && isSubmit)
      return toolHint(tool, payload.toolInput);
  }
  return undefined;
}

function isPreToolEvent(...toolNames: string[]) {
  return (e: AgentEvent): boolean => {
    if (e.kind !== 'brand.thinking') return false;
    const payload = e.payload as { phase?: string; toolName?: string };
    if (payload.phase !== 'pre_tool_use') return false;
    return toolNames.includes(payload.toolName ?? '');
  };
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
