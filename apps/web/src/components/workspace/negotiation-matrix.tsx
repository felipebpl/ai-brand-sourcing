import { Star, Trophy } from 'lucide-react';
import type {
  NegotiationMessageRow,
  NegotiationRow,
  QuotationDetailResponse,
  QuotationLineRow,
} from '@/lib/api';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { delta, money, shortenPaymentTerms } from '@/lib/format';
import { accentClasses, supplierMeta } from '@/lib/suppliers';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';

type Props = {
  quotationId: string;
  quotationStatus: QuotationDetailResponse['quotation']['status'];
  lines: QuotationLineRow[];
  negotiations: NegotiationRow[];
  winnerNegotiationId: string | null;
  comparison: QuotationDetailResponse['quotation']['recommendationComparison'];
};

export function NegotiationMatrix({
  quotationId,
  quotationStatus,
  lines,
  negotiations,
  winnerNegotiationId,
  comparison,
}: Props) {
  if (lines.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center text-[13px] text-muted-foreground">
        Line items will appear once parsing completes.
      </div>
    );
  }

  const isTerminal =
    quotationStatus === 'recommended' || quotationStatus === 'committed';

  const comparisonByNegId = new Map(
    (comparison ?? []).map((c) => [c.negotiationId, c]),
  );

  const latestSupplierOffer = (n: NegotiationRow) => {
    const m = [...n.messages]
      .reverse()
      .find((x) => x.role === 'supplier' && x.offer != null);
    return m?.offer ?? null;
  };

  const supplierLatestUnit = (n: NegotiationRow): number | null => {
    const o = latestSupplierOffer(n);
    if (o) return o.unitPriceAvg;
    if (n.finalUnitPriceAvg) return Number.parseFloat(n.finalUnitPriceAvg);
    const c = comparisonByNegId.get(n.id);
    if (c) return c.unitPriceAvg;
    return null;
  };

  const supplierLatestLead = (n: NegotiationRow): number | null => {
    const o = latestSupplierOffer(n);
    if (o?.leadTimeDays != null) return o.leadTimeDays;
    if (n.finalLeadTimeDays != null) return n.finalLeadTimeDays;
    const c = comparisonByNegId.get(n.id);
    if (c) return c.leadTimeDays;
    return null;
  };

  const supplierLatestPaymentDisplay = (n: NegotiationRow): string | null => {
    const o = latestSupplierOffer(n);
    if (o?.paymentTerms) return shortenPaymentTerms(o.paymentTerms);
    const c = comparisonByNegId.get(n.id);
    if (c?.paymentTerms) return shortenPaymentTerms(c.paymentTerms);
    return supplierMeta(n.supplierId).paymentTerms;
  };

  const leadingByPriceId = negotiations
    .map((n) => ({ id: n.id, price: supplierLatestUnit(n) }))
    .filter((x) => x.price != null)
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0]?.id;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full border-collapse">
        <thead>
          <tr className="align-top">
            <th className="sticky left-0 z-10 w-[320px] bg-card p-4 text-left">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                Line items
              </div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                {lines.length} SKUs · baseline from supplier quote
              </div>
            </th>
            {negotiations.map((n) => (
              <th
                key={n.id}
                className={cn(
                  'border-l border-border p-0 text-left align-top',
                  n.id === winnerNegotiationId && 'bg-success/5',
                )}
              >
                <SupplierColumnHeader
                  quotationId={quotationId}
                  negotiation={n}
                  isWinner={n.id === winnerNegotiationId}
                  isLeading={
                    n.id === leadingByPriceId && n.id !== winnerNegotiationId
                  }
                  isTerminal={isTerminal}
                  supplierAccent={accentClasses(
                    supplierMeta(n.supplierId).accent,
                  )}
                />
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {lines.map((line, i) => (
            <tr
              key={line.id}
              className={cn(
                'border-t border-border align-top',
                i % 2 === 1 ? 'bg-muted/20' : 'bg-card',
              )}
            >
              <td className="sticky left-0 z-10 w-[320px] bg-inherit p-4">
                <LineItemCell line={line} />
              </td>
              {negotiations.map((n) => {
                const offer = latestSupplierOffer(n);
                const price = supplierLatestUnit(n);
                const isLeader = n.id === leadingByPriceId && price != null;
                const isWinner = n.id === winnerNegotiationId;
                const d =
                  price != null
                    ? delta(price, Number.parseFloat(line.unitPrice))
                    : null;
                return (
                  <td
                    key={n.id}
                    className={cn(
                      'border-l border-border p-4 text-right align-top',
                      isWinner && 'bg-success/5',
                    )}
                  >
                    {price != null ? (
                      <div className="flex flex-col items-end">
                        <div
                          className={cn(
                            'font-mono text-[16px] tabular',
                            isWinner
                              ? 'text-success font-medium'
                              : isLeader
                              ? 'text-foreground font-medium'
                              : 'text-foreground',
                          )}
                        >
                          {money(price, line.currency)}
                        </div>
                        {d && d.tone !== 'flat' ? (
                          <div
                            className={cn(
                              'mt-0.5 font-mono text-[10.5px] tabular',
                              d.tone === 'down'
                                ? 'text-success'
                                : 'text-destructive',
                            )}
                          >
                            {d.label}
                          </div>
                        ) : null}
                        {offer?.fulfillablePct != null &&
                        offer.fulfillablePct < 1 ? (
                          <div className="mt-1 text-[10px] font-medium uppercase tracking-wider text-attention">
                            only {Math.round(offer.fulfillablePct * 100)}%
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="font-mono text-[14px] text-muted-foreground/60">
                        ·
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr className="border-t-2 border-border bg-muted/40 align-top">
            <td className="sticky left-0 z-10 w-[320px] bg-muted/40 p-4">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                Average / unit
              </div>
              <div className="mt-1 font-mono text-[16px] text-foreground tabular">
                {money(averageBaseline(lines))}
              </div>
            </td>
            {negotiations.map((n) => {
              const isWinner = n.id === winnerNegotiationId;
              const avg = supplierLatestUnit(n);
              const lead = supplierLatestLead(n);
              const payment = supplierLatestPaymentDisplay(n);
              return (
                <td
                  key={n.id}
                  className={cn(
                    'border-l border-border p-4 text-right align-top',
                    isWinner ? 'bg-success/10' : 'bg-muted/40',
                  )}
                >
                  <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Latest avg
                  </div>
                  <div
                    className={cn(
                      'mt-1 font-mono text-[18px] tabular',
                      isWinner
                        ? 'text-success font-semibold'
                        : 'text-foreground',
                    )}
                  >
                    {avg != null ? money(avg) : '—'}
                  </div>
                  {lead != null ? (
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground tabular">
                      {lead}d{payment ? ` · ${payment}` : ''}
                    </div>
                  ) : null}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function averageBaseline(lines: QuotationLineRow[]): number {
  if (lines.length === 0) return 0;
  const sum = lines.reduce((acc, l) => acc + Number.parseFloat(l.unitPrice), 0);
  return sum / lines.length;
}

function LineItemCell({ line }: { line: QuotationLineRow }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-mono text-muted-foreground">
        {(line.matchedSku ?? line.rawSku ?? '?').slice(0, 4)}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-foreground">
          {line.rawDescription ?? line.matchedSku ?? line.rawSku ?? '—'}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground tabular">
          <span>{line.matchedSku ?? line.rawSku}</span>
          <span className="text-muted-foreground/50">·</span>
          <span>
            qty {line.minQty}
            {line.maxQty && line.maxQty !== line.minQty
              ? `–${line.maxQty}`
              : ''}
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span>baseline {money(line.unitPrice, line.currency)}</span>
        </div>
        {line.matchedSku && line.rawSku && line.matchedSku !== line.rawSku ? (
          <div
            className="mt-0.5 truncate font-mono text-[10px] italic text-muted-foreground"
            title={line.matchReasoning ?? undefined}
          >
            matched from {line.rawSku}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SupplierColumnHeader({
  negotiation,
  isWinner,
  isLeading,
  isTerminal,
  supplierAccent,
}: {
  quotationId: string;
  negotiation: NegotiationRow;
  isWinner: boolean;
  isLeading: boolean;
  isTerminal: boolean;
  supplierAccent: ReturnType<typeof accentClasses>;
}) {
  const meta = supplierMeta(negotiation.supplierId);

  return (
    <div className="relative flex h-full flex-col p-4">
      {isWinner ? (
        <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-1 bg-success py-1 text-[9.5px] font-semibold uppercase tracking-wider text-success-foreground">
          <Trophy className="size-3" /> Recommended
        </div>
      ) : null}

      <div className={cn('flex items-start gap-2.5', isWinner && 'mt-4')}>
        <div
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold',
            supplierAccent.bg,
            supplierAccent.text,
          )}
        >
          {meta.initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[14px] font-semibold tracking-tight">
            {meta.label}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <Star className="size-2.5 fill-attention text-attention" />
            <span className="tabular text-foreground">
              {meta.qualityScore.toFixed(1)}
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span>{meta.country}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <StatusChip
          status={negotiation.status}
          isWinner={isWinner}
          isTerminal={isTerminal}
        />
        <span className="text-[10px] text-muted-foreground">
          {formatRelative(negotiation.updatedAt)}
        </span>
      </div>

      {isLeading && !isWinner && !isTerminal ? (
        <div className="mt-2 text-[9.5px] font-semibold uppercase tracking-wider text-primary">
          Leading on price
        </div>
      ) : null}

      <TurnGrid
        messages={negotiation.messages}
        supplierShort={meta.shortLabel}
        supplierAccent={supplierAccent}
      />
    </div>
  );
}

function TurnGrid({
  messages,
  supplierShort,
  supplierAccent,
}: {
  messages: NegotiationMessageRow[];
  supplierShort: string;
  supplierAccent: ReturnType<typeof accentClasses>;
}) {
  if (messages.length === 0) {
    return (
      <div className="mt-3 rounded-md border border-dashed border-border bg-muted/30 px-2 py-3 text-center text-[10.5px] italic text-muted-foreground">
        No turns yet.
      </div>
    );
  }

  const PARAM_LABELS = ['Unit', 'Lead', 'Payment'];
  const sorted = [...messages].sort((a, b) => a.turnIndex - b.turnIndex);

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-background">
      <div className="border-b border-border bg-muted/40 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        Turn-by-turn
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[10.5px] tabular">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-[58px] bg-background px-2 py-1 text-left font-medium text-muted-foreground" />
              {sorted.map((m) => {
                const isBrand = m.role === 'brand';
                return (
                  <th
                    key={m.id}
                    className={cn(
                      'min-w-[52px] border-l border-border px-1.5 py-1 text-center',
                      isBrand
                        ? 'bg-foreground/[0.04]'
                        : cn(supplierAccent.bg, 'opacity-60'),
                    )}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="flex flex-col items-center gap-0.5 text-[9px] uppercase tracking-wider text-foreground/80 hover:text-foreground"
                        >
                          <span className="font-semibold">
                            R{m.turnIndex + 1}
                          </span>
                          <span className="text-[8.5px]">
                            {isBrand ? 'Valden' : supplierShort}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TurnTooltip message={m} supplierShort={supplierShort} />
                    </Tooltip>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {PARAM_LABELS.map((label, i) => (
              <tr key={label} className="border-t border-border">
                <th className="sticky left-0 z-10 w-[58px] bg-background px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {label}
                </th>
                {sorted.map((m) => {
                  const isBrand = m.role === 'brand';
                  const value = paramValue(m, i);
                  return (
                    <td
                      key={m.id}
                      className={cn(
                        'min-w-[52px] border-l border-border px-1.5 py-1 text-center font-mono tabular',
                        isBrand
                          ? 'bg-foreground/[0.02] text-foreground'
                          : cn(supplierAccent.bg, 'opacity-95 text-foreground'),
                        !value && 'text-muted-foreground/50',
                      )}
                    >
                      {value ?? '·'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function paramValue(m: NegotiationMessageRow, index: number): string | null {
  if (!m.offer) return null;
  if (index === 0) return `$${m.offer.unitPriceAvg.toFixed(2)}`;
  if (index === 1) return `${m.offer.leadTimeDays}d`;
  if (index === 2) return shortenPaymentTerms(m.offer.paymentTerms);
  return null;
}

function TurnTooltip({
  message,
  supplierShort,
}: {
  message: NegotiationMessageRow;
  supplierShort: string;
}) {
  const isBrand = message.role === 'brand';
  const intent =
    message.metadata && typeof message.metadata === 'object'
      ? ((message.metadata as Record<string, unknown>).intent as
          | string
          | undefined)
      : undefined;
  const intentLabel = intent ? TURN_INTENT_LABEL[intent] : null;

  return (
    <TooltipContent side="bottom" className="max-w-[280px] p-3 text-[11.5px]">
      <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground/70">
        <span>
          Round {message.turnIndex + 1} ·{' '}
          {isBrand ? 'Valden' : supplierShort}
        </span>
        {intentLabel ? <span>{intentLabel}</span> : null}
      </div>
      {message.offer ? (
        <div className="mt-2 grid grid-cols-3 gap-1.5 font-mono text-[10px] tabular">
          <Param label="Unit" value={`$${message.offer.unitPriceAvg.toFixed(2)}`} />
          <Param label="Lead" value={`${message.offer.leadTimeDays}d`} />
          <Param label="Payment" value={shortenPaymentTerms(message.offer.paymentTerms)} />
        </div>
      ) : null}
      <p className="mt-2 text-[11.5px] leading-snug">{message.content}</p>
    </TooltipContent>
  );
}

function Param({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[8.5px] uppercase tracking-wider text-primary-foreground/60">
        {label}
      </div>
      <div className="text-primary-foreground">{value}</div>
    </div>
  );
}

const TURN_INTENT_LABEL: Record<string, string> = {
  counter_offer: 'Countered',
  accept: 'Accepted',
  walk_away: 'Walked away',
  request_clarification: 'Clarification',
};

export function effectiveRounds(negotiation: NegotiationRow): number {
  if (negotiation.roundsCount > 0) return negotiation.roundsCount;
  if (negotiation.messages.length === 0) return 0;
  const maxTurn = negotiation.messages.reduce(
    (m, msg) => Math.max(m, msg.turnIndex),
    -1,
  );
  return Math.max(0, Math.floor(maxTurn / 2) + 1);
}

function StatusChip({
  status,
  isWinner,
  isTerminal,
}: {
  status: NegotiationRow['status'];
  isWinner: boolean;
  isTerminal: boolean;
}) {
  if (isTerminal) {
    if (isWinner) {
      return (
        <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-success">
          <span className="size-1.5 rounded-full bg-success" />
          Won
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
        Outbid
      </span>
    );
  }
  if (status === 'concluded') {
    return (
      <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-success">
        <span className="size-1.5 rounded-full bg-success" />
        Concluded
      </span>
    );
  }
  if (status === 'stalled' || status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
        {status === 'stalled' ? 'Stalled' : 'Failed'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-primary">
      <span className="size-1.5 animate-pulse rounded-full bg-primary" />
      {status === 'pending' ? 'Opening' : 'Negotiating'}
    </span>
  );
}
