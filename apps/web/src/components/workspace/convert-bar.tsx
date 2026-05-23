import { CheckCircle2, Star } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { QuotationDetailResponse } from '@/lib/api';
import { money, shortenPaymentTerms } from '@/lib/format';
import { accentClasses, supplierMeta } from '@/lib/suppliers';
import { cn } from '@/lib/utils';
import { PlaceOrderDialog } from './place-order-dialog';

type Props = {
  q: QuotationDetailResponse['quotation'];
  lines: QuotationDetailResponse['lines'];
};

export function ConvertBar({ q, lines }: Props) {
  const [open, setOpen] = useState(false);

  const comparison = q.recommendationComparison ?? [];
  const winner = comparison.find(
    (c) => c.negotiationId === q.recommendedNegotiationId,
  );
  const meta = winner ? supplierMeta(winner.supplierId) : null;
  const accent = meta ? accentClasses(meta.accent) : null;

  const totalUnits = lines.reduce((sum, l) => sum + l.minQty, 0);

  return (
    <>
      <div className="border-t border-border bg-background px-6 py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.08)]">
        <div className="flex items-center gap-4">
          {meta && winner && accent ? (
            <>
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold',
                    accent.bg,
                    accent.text,
                  )}
                >
                  {meta.initials}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-display text-[14px] font-semibold tracking-tight text-foreground">
                    {meta.label}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Star className="size-2.5 fill-attention text-attention" />
                    <span className="font-mono tabular text-foreground">
                      {meta.qualityScore.toFixed(1)}
                    </span>
                    <span className="text-muted-foreground/60">·</span>
                    <span>{meta.country}</span>
                  </div>
                </div>
              </div>

              <div className="hidden flex-1 items-center gap-5 border-l border-border pl-5 md:flex">
                <Metric
                  label="Products"
                  value={`${lines.length} · ${totalUnits.toLocaleString()}u`}
                />
                <Metric label="Lead" value={`${winner.leadTimeDays}d`} />
                <Metric
                  label="Payment"
                  value={shortenPaymentTerms(winner.paymentTerms)}
                />
                <Metric
                  label="Quality"
                  value={winner.qualityScore.toFixed(1)}
                />
                <Metric
                  label="FOB Total"
                  value={money(winner.totalCost)}
                  emphasis
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center gap-2 text-[12.5px] text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-success" />
              The winning negotiation is ready to commit.
            </div>
          )}

          <Button
            size="default"
            className="ml-auto bg-foreground text-background hover:bg-foreground/90"
            onClick={() => setOpen(true)}
          >
            Create Draft Order
          </Button>
        </div>
      </div>

      <PlaceOrderDialog
        open={open}
        onOpenChange={setOpen}
        q={q}
        lines={lines}
      />
    </>
  );
}

function Metric({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 font-mono text-[12px] tabular',
          emphasis ? 'font-semibold text-foreground' : 'text-foreground',
        )}
      >
        {value}
      </div>
    </div>
  );
}
