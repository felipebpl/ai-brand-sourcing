import { ArrowDownCircle, CheckCircle2, History } from 'lucide-react';
import type { QuotationDetailResponse } from '@/lib/api';
import { money } from '@/lib/format';
import { supplierMeta } from '@/lib/suppliers';
import { cn } from '@/lib/utils';

type Variant = 'modal' | 'inline';

type Props = {
  q: QuotationDetailResponse['quotation'];
  variant?: Variant;
  onJumpToHistory?: () => void;
};

export function WhyThisWinner({
  q,
  variant = 'inline',
  onJumpToHistory,
}: Props) {
  if (!q.recommendationReasoning || !q.recommendedNegotiationId) return null;
  const comparison = q.recommendationComparison ?? [];
  const winner = comparison.find(
    (c) => c.negotiationId === q.recommendedNegotiationId,
  );
  const winnerMeta = winner ? supplierMeta(winner.supplierId) : null;

  const Header = (
    <div>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
        <CheckCircle2 className="size-3.5" />
        Recommendation
      </div>
      <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.15] tracking-tight text-foreground">
        Why {winnerMeta?.label ?? 'this supplier'}
      </h2>
    </div>
  );

  const Reasoning = (
    <p className="mt-4 text-[14.5px] leading-[1.7] text-foreground">
      {q.recommendationReasoning}
    </p>
  );

  const HistoryRail =
    q.recommendationHistory && q.recommendationHistory.length > 0 ? (
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          <History className="size-3" />
          Previous recommendations
        </div>
        <ul className="mt-2 space-y-1.5">
          {q.recommendationHistory.map((h, i) => {
            const supplier = supplierMeta(h.supplierId);
            return (
              <li
                key={i}
                className="flex items-center gap-2 text-[12px] text-muted-foreground"
              >
                <span className="font-mono text-[10.5px]">v{i + 1}</span>
                <span className="text-foreground">{supplier.shortLabel}</span>
                <span className="text-muted-foreground/60">·</span>
                <span className="italic">
                  {h.supersededReason ?? 'superseded'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    ) : null;

  const JumpLink = onJumpToHistory ? (
    <button
      type="button"
      onClick={onJumpToHistory}
      className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
    >
      <ArrowDownCircle className="size-3.5" />
      See negotiation history
    </button>
  ) : null;

  if (variant === 'modal') {
    return (
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
        <div className="border-b border-border px-6 py-5">{Header}</div>
        <div className="max-h-[64vh] overflow-y-auto px-6 py-5">
          {Reasoning}
          {comparison.length > 0 ? (
            <ComparisonGrid
              comparison={comparison}
              winningNegotiationId={q.recommendedNegotiationId}
              dense
            />
          ) : null}
          {HistoryRail}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div>
          {Header}
          {Reasoning}
          {JumpLink}
          {HistoryRail}
        </div>
        {comparison.length > 0 ? (
          <ComparisonGrid
            comparison={comparison}
            winningNegotiationId={q.recommendedNegotiationId}
            dense
            stacked
          />
        ) : null}
      </div>
    </section>
  );
}

function ComparisonGrid({
  comparison,
  winningNegotiationId,
  dense,
  stacked,
}: {
  comparison: NonNullable<
    QuotationDetailResponse['quotation']['recommendationComparison']
  >;
  winningNegotiationId: string;
  dense?: boolean;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'gap-3',
        stacked
          ? 'flex flex-col'
          : dense
          ? 'mt-6 grid grid-cols-1 md:grid-cols-3'
          : 'mt-6 grid grid-cols-1 md:grid-cols-3',
      )}
    >
      {comparison.map((row) => {
        const meta = supplierMeta(row.supplierId);
        const isWinner = row.negotiationId === winningNegotiationId;
        return (
          <div
            key={row.negotiationId}
            className={cn(
              'rounded-lg border p-3.5',
              isWinner
                ? 'border-success/60 bg-success/5'
                : 'border-border bg-background',
            )}
          >
            <div className="flex items-center justify-between">
              <div className="font-display text-[13.5px] font-semibold tracking-tight">
                {meta.shortLabel}
              </div>
              {isWinner ? (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-success">
                  Winner
                </span>
              ) : null}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-2 text-[11px]">
              <Metric label="Unit" value={money(row.unitPriceAvg)} />
              <Metric label="Lead" value={`${row.leadTimeDays}d`} />
              <Metric label="Quality" value={row.qualityScore.toFixed(1)} />
              <Metric
                label="Fulfill"
                value={`${Math.round((row.fulfillablePct ?? 1) * 100)}%`}
              />
              <Metric label="Payment" value={row.paymentTerms.display} />
              <Metric label="Total" value={money(row.totalCost)} />
            </div>
            {row.winsOn.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {row.winsOn.map((dim) => (
                  <span
                    key={dim}
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      isWinner
                        ? 'bg-success/15 text-success'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    wins on {dim.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-[11.5px] text-foreground tabular">
        {value}
      </div>
    </div>
  );
}
