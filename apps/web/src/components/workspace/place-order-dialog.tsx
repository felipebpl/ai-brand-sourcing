import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Package, Star } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api, type QuotationDetailResponse } from '@/lib/api';
import { money, shortenPaymentTerms } from '@/lib/format';
import { accentClasses, supplierMeta } from '@/lib/suppliers';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  q: QuotationDetailResponse['quotation'];
  lines: QuotationDetailResponse['lines'];
};

export function PlaceOrderDialog({ open, onOpenChange, q, lines }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const comparison = q.recommendationComparison ?? [];
  const winner = comparison.find(
    (c) => c.negotiationId === q.recommendedNegotiationId,
  );
  const winnerMeta = winner ? supplierMeta(winner.supplierId) : null;
  const accent = winnerMeta ? accentClasses(winnerMeta.accent) : null;

  const totalUnits = lines.reduce((sum, l) => sum + l.minQty, 0);
  const fobTotal = winner?.totalCost ?? 0;
  const estFreight = Math.round(fobTotal * 0.04 * 100) / 100;
  const estDuties = Math.round(fobTotal * 0.46 * 100) / 100;
  const estLanded = fobTotal + estFreight + estDuties;

  const targetShipDate = winner
    ? new Date(
        Date.now() + (winner.leadTimeDays + 7) * 24 * 60 * 60 * 1000,
      ).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';

  const mutation = useMutation({
    mutationFn: () => api.createPurchaseOrder(q.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['quotation', q.id] });
      await queryClient.invalidateQueries({ queryKey: ['quotations'] });
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      onOpenChange(false);
      navigate({ to: '/orders' });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
            <Package className="size-4" />
          </div>
          <DialogTitle className="mt-2 font-display text-[20px] font-semibold tracking-tight text-foreground">
            Place Order
          </DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">
            Review the details below before placing your order with this
            supplier.
          </DialogDescription>
        </DialogHeader>

        {winnerMeta && winner && accent ? (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <div
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold',
                  accent.bg,
                  accent.text,
                )}
              >
                {winnerMeta.initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-[14px] font-semibold tracking-tight">
                  {winnerMeta.label}
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {winnerMeta.country}
                </div>
              </div>
              <div className="flex items-center gap-1 text-[12px]">
                <Star className="size-3 fill-attention text-attention" />
                <span className="font-mono tabular text-foreground">
                  {winnerMeta.qualityScore.toFixed(1)}
                </span>
              </div>
            </div>

            <div className="space-y-px overflow-hidden rounded-lg border border-border">
              <DetailRow
                label="Products"
                value={`${lines.length} product${
                  lines.length === 1 ? '' : 's'
                } · ${totalUnits.toLocaleString()} units`}
              />
              <DetailRow label="Target Ship Date" value={targetShipDate} />
              <DetailRow
                label="Incoterm · Payment"
                value={`FOB · ${shortenPaymentTerms(winner.paymentTerms)}`}
              />
              <DetailRow
                label="Est. Landed Cost"
                value={`~${money(estLanded, q.parsedMetadata && typeof q.parsedMetadata === 'object' ? ((q.parsedMetadata as Record<string, unknown>).currency as string) : 'USD')}`}
                tone="success"
              />
            </div>

            <div className="grid grid-cols-4 divide-x divide-border rounded-lg border border-border bg-muted/40">
              <TotalCell label="FOB TOTAL" value={money(fobTotal)} />
              <TotalCell label="EST. FREIGHT" value={`~${money(estFreight)}`} />
              <TotalCell label="EST. DUTIES" value={`~${money(estDuties)}`} />
              <TotalCell
                label="EST. LANDED"
                value={`~${money(estLanded)}`}
                tone="success"
              />
            </div>
          </>
        ) : null}

        {mutation.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            {(mutation.error as Error).message ||
              'Failed to place order. Try again.'}
          </div>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            size="sm"
            className="bg-foreground text-background hover:bg-foreground/90"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Placing…' : 'Confirm & Place Order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success';
}) {
  return (
    <div className="flex items-center justify-between gap-3 bg-card px-3 py-2.5 text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'font-mono tabular',
          tone === 'success'
            ? 'font-semibold text-success'
            : 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function TotalCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success';
}) {
  return (
    <div className="px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 font-mono text-[11px] tabular',
          tone === 'success' ? 'font-semibold text-success' : 'text-foreground',
        )}
      >
        {value}
      </div>
    </div>
  );
}
