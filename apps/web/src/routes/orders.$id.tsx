import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft, Package, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { money, shortenPaymentTerms } from '@/lib/format';
import { accentClasses, supplierMeta } from '@/lib/suppliers';
import { formatDate } from '@/lib/time';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/orders/$id')({
  component: OrderDetail,
});

function OrderDetail() {
  const { id } = Route.useParams();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api.getPurchaseOrder(id),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 px-8 py-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-[320px]" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="px-8 py-16 text-center">
        <h2 className="font-display text-[18px] font-semibold tracking-tight text-foreground">
          Couldn't load this order
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {(error as Error)?.message ?? 'Unknown error'}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => refetch()}
        >
          Retry
        </Button>
      </div>
    );
  }

  const { purchaseOrder: po, lines } = data;
  const meta = supplierMeta(po.supplierId);
  const accent = accentClasses(meta.accent);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-background">
        <div className="flex items-center gap-2 px-8 pt-5 text-[12px] text-muted-foreground">
          <Link to="/orders" className="hover:text-foreground">
            <ChevronLeft className="size-3.5" />
          </Link>
          <Link to="/orders" className="hover:text-foreground">
            Orders
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <span className="font-mono text-foreground">{po.poNumber}</span>
        </div>
        <div className="flex items-start justify-between gap-6 px-8 pt-2 pb-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3">
              <h1 className="font-display text-[26px] font-semibold tracking-tight text-foreground">
                {po.poNumber}
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium capitalize text-success">
                <span className="size-1.5 rounded-full bg-success" />
                {po.status}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Package className="size-3.5" />
              <span>Issued {formatDate(po.issuedAt)}</span>
              <span className="text-muted-foreground/50">·</span>
              <Link
                to="/quotations/$id"
                params={{ id: po.quotationId }}
                className="hover:text-foreground"
              >
                From RFQ
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border bg-muted/30 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Line items
            </div>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="py-2 font-medium">Description</th>
                  <th className="py-2 text-right font-medium">Qty</th>
                  <th className="py-2 text-right font-medium">Unit</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr
                    key={line.id}
                    className="border-b border-border/70 last:border-b-0"
                  >
                    <td className="px-4 py-2.5 font-mono text-[11px] text-foreground">
                      {line.productSku}
                    </td>
                    <td className="max-w-[280px] truncate py-2.5 text-foreground">
                      {line.description}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular text-foreground">
                      {line.quantity}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular text-foreground">
                      {money(line.unitPrice, po.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular font-medium text-foreground">
                      {money(line.lineTotal, po.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40">
                  <td colSpan={4} className="px-4 py-2 text-right text-[11px] uppercase tracking-wider text-muted-foreground">
                    Subtotal
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular font-semibold text-foreground">
                    {money(po.subtotal, po.currency)}
                  </td>
                </tr>
                <tr className="bg-muted/40">
                  <td colSpan={4} className="px-4 py-2 text-right text-[11px] uppercase tracking-wider text-muted-foreground">
                    Total
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular text-[14px] font-semibold text-foreground">
                    {money(po.totalAmount, po.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>

          <aside className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold',
                    accent.bg,
                    accent.text,
                  )}
                >
                  {meta.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-[14px] font-semibold tracking-tight">
                    {meta.label}
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
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border bg-muted/30 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                Terms
              </div>
              <dl className="divide-y divide-border text-[12.5px]">
                <DetailRow label="Lead time" value={`${po.leadTimeDays} days`} />
                <DetailRow
                  label="Payment"
                  value={shortenPaymentTerms(po.paymentTerms)}
                />
                <DetailRow
                  label="Expected delivery"
                  value={
                    po.expectedDeliveryDate
                      ? formatDate(po.expectedDeliveryDate)
                      : '—'
                  }
                />
                <DetailRow
                  label="Currency"
                  value={po.currency.toUpperCase()}
                />
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular text-foreground">{value}</dd>
    </div>
  );
}
