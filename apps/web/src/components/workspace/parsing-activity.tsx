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
          Open the file, find the products table, match every SKU against your
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

function StepIcon({ state }: { state: Step['state'] }) {
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

type ToolPhrase = {
  label: string;
  describe?: (input: Record<string, unknown>) => string | undefined;
};

const TOOLS: Record<string, ToolPhrase> = {
  Bash: {
    label: 'Inspecting the workbook',
    describe: (input) => {
      const cmd = typeof input.command === 'string' ? input.command : '';
      if (cmd.includes('wb.sheetnames')) return 'Listing sheets';
      if (cmd.includes('ws[') || cmd.includes('cell(')) return 'Reading cells';
      if (cmd.includes('merged_cells')) return 'Resolving merged cells';
      if (cmd.includes('iter_rows')) return 'Scanning the products table';
      return undefined;
    },
  },
  Read: { label: 'Reading the file structure' },
  mcp__parser__lookup_catalog: {
    label: 'Matching SKU against the catalog',
    describe: (input) => {
      const raw =
        typeof input.rawSku === 'string'
          ? (input.rawSku as string)
          : typeof input.sku === 'string'
          ? (input.sku as string)
          : null;
      return raw ? `lookup · ${raw}` : undefined;
    },
  },
  mcp__parser__submit_extraction: {
    label: 'Finalizing the structured extraction',
  },
};

function describeToolStep(
  toolName: string,
  input: unknown,
): { label: string; detail?: string } {
  const cfg = TOOLS[toolName];
  if (!cfg) {
    return {
      label: humanizeUnknownTool(toolName),
    };
  }
  const inputObj =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const detail = cfg.describe?.(inputObj);
  return { label: cfg.label, detail };
}

function buildSteps(
  events: AgentEvent[],
  lines: QuotationLineRow[],
  status: Props['status'],
): Step[] {
  const completed = events.some((e) => e.kind === 'parser.completed');
  const toolEvents = events.filter((e) => e.kind === 'brand.thinking');

  // Each (toolName, optional detail) becomes its own step. We dedupe by
  // (tool + detail) so repeated identical actions collapse, while
  // different SKU lookups stay separate.
  const seen = new Map<
    string,
    { toolName: string; label: string; detail?: string; latestPhase: string }
  >();
  for (const e of toolEvents) {
    const payload = e.payload as {
      phase?: string;
      toolName?: string;
      toolInput?: unknown;
    };
    const tool = payload.toolName ?? '';
    if (!tool) continue;
    const { label, detail } = describeToolStep(tool, payload.toolInput);
    const key = detail ? `${tool}:${detail}` : tool;
    const existing = seen.get(key);
    if (existing) {
      existing.latestPhase = payload.phase ?? existing.latestPhase;
    } else {
      seen.set(key, {
        toolName: tool,
        label,
        detail,
        latestPhase: payload.phase ?? 'pre_tool_use',
      });
    }
  }

  const toolSteps: Step[] = [];
  for (const [key, entry] of seen) {
    toolSteps.push({
      key: `tool:${key}`,
      label: entry.label,
      detail: entry.detail,
      state: entry.latestPhase === 'post_tool_use' ? 'done' : 'active',
    });
  }

  const head: Step[] = [
    {
      key: 'received',
      label: 'Quote received from the supplier',
      state: 'done',
    },
    {
      key: 'starting',
      label: 'Picking up the file',
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
    key: 'handoff',
    label: 'Handing off to the negotiation engine',
    state: completed ? 'done' : 'pending',
  });

  return [...head, ...toolSteps, ...tail];
}

function humanizeUnknownTool(name: string): string {
  return (
    name
      .replace(/^mcp__[a-z_]+__/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Working'
  );
}
