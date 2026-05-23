import { Link } from '@tanstack/react-router';
import { ArrowRight, Star, Trophy } from 'lucide-react';
import type { NegotiationRow } from '@/lib/api';
import { money } from '@/lib/format';
import { accentClasses, supplierMeta } from '@/lib/suppliers';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';

type Props = {
  quotationId: string;
  negotiation: NegotiationRow;
  isWinner: boolean;
  isLeading: boolean;
};

export function SupplierCard({
  quotationId,
  negotiation,
  isWinner,
  isLeading,
}: Props) {
  const meta = supplierMeta(negotiation.supplierId);
  const accent = accentClasses(meta.accent);
  const latestSupplierMsg = [...negotiation.messages]
    .reverse()
    .find((m) => m.role === 'supplier');
  const liveOffer = latestSupplierMsg?.offer ?? null;
  const fallbackPrice = negotiation.finalUnitPriceAvg
    ? Number.parseFloat(negotiation.finalUnitPriceAvg)
    : null;
  const offerUnitPrice = liveOffer?.unitPriceAvg ?? fallbackPrice;
  const offerLeadTime =
    liveOffer?.leadTimeDays ?? negotiation.finalLeadTimeDays ?? null;
  const offerPaymentDisplay =
    liveOffer?.paymentTerms?.display ?? meta.paymentTerms;
  const hasOffer = offerUnitPrice != null;

  const status = negotiation.status;
  const lastEventAt =
    latestSupplierMsg?.createdAt ?? negotiation.updatedAt ?? negotiation.createdAt;

  return (
    <Link
      to="/quotations/$id/negotiations/$negotiationId"
      params={{ id: quotationId, negotiationId: negotiation.id }}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground transition-shadow hover:shadow-sm',
        isWinner
          ? 'border-success/60 shadow-[0_0_0_1px] shadow-success/30'
          : 'border-border',
      )}
    >
      {isWinner ? (
        <div className="absolute inset-x-0 top-0 flex items-center justify-center bg-success px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-success-foreground">
          <Trophy className="mr-1 size-3" /> Recommended winner
        </div>
      ) : null}

      <div className={cn('flex items-start gap-3 p-4', isWinner && 'pt-7')}>
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
            accent.bg,
            accent.text,
          )}
        >
          {meta.initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate font-display text-[15px] font-semibold tracking-tight">
              {meta.label}
            </div>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <Star className="size-3 fill-attention text-attention" />
            <span className="tabular text-foreground">
              {meta.qualityScore.toFixed(1)}
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span>{meta.country}</span>
          </div>
        </div>
      </div>

      <div className="border-t border-border px-4 py-3">
        <StatusBadge status={status} />
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {status === 'concluded'
            ? `Concluded after ${negotiation.roundsCount} rounds`
            : status === 'stalled'
            ? `Stalled at round ${negotiation.roundsCount}`
            : `Round ${negotiation.roundsCount} · ${formatRelative(lastEventAt)}`}
        </div>
      </div>

      <div className="flex-1 px-4 pb-3">
        {hasOffer ? (
          <>
            <div className="font-mono text-[24px] font-medium leading-none text-foreground tabular">
              {money(offerUnitPrice)}
              <span className="ml-1 text-[12px] font-normal text-muted-foreground">
                / unit avg
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
              <div>
                <div className="text-muted-foreground">Lead time</div>
                <div className="font-mono text-foreground tabular">
                  {offerLeadTime != null ? `${offerLeadTime}d` : '—'}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Payment</div>
                <div className="font-mono text-foreground">
                  {offerPaymentDisplay}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-[11px] italic text-muted-foreground">
            Awaiting first counter…
          </div>
        )}
      </div>

      {isLeading && !isWinner ? (
        <div className="border-t border-border bg-accent/40 px-4 py-1.5 text-[10.5px] font-medium uppercase tracking-wider text-primary">
          Leading on price
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground transition-colors group-hover:bg-muted/40">
        <span>View negotiation</span>
        <ArrowRight className="size-3.5" />
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: NegotiationRow['status'] }) {
  if (status === 'concluded') {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-success">
        <span className="size-1.5 rounded-full bg-success" />
        Concluded
      </span>
    );
  }
  if (status === 'stalled' || status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
        {status === 'stalled' ? 'Stalled' : 'Failed'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-primary">
      <span className="size-1.5 animate-pulse rounded-full bg-primary" />
      {status === 'pending' ? 'Opening' : 'Negotiating'}
    </span>
  );
}
