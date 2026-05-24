import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type PurchaseOrderSummary } from '@/lib/api';
import { money, shortenPaymentTerms } from '@/lib/format';
import { supplierMeta } from '@/lib/suppliers';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/orders/')({
  component: OrdersIndex,
});

function OrdersIndex() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: api.listPurchaseOrders,
    refetchInterval: 5_000,
  });

  const rows = data?.purchaseOrders ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-7 pb-5">
        <h1 className="font-display text-[24px] font-semibold tracking-tight text-foreground">
          Orders
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Purchase orders issued from your RFQs.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? <ListSkeleton /> : null}
        {isError ? (
          <ErrorState
            onRetry={() => refetch()}
            message={(error as Error)?.message}
          />
        ) : null}
        {!isLoading && !isError && rows.length === 0 ? <EmptyState /> : null}
        {rows.length > 0 ? <OrdersTable rows={rows} /> : null}
      </div>
    </div>
  );
}

function OrdersTable({ rows }: { rows: PurchaseOrderSummary[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-y border-border text-left text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
          <th className="px-8 py-2.5 font-medium">PO</th>
          <th className="py-2.5 font-medium">Supplier</th>
          <th className="py-2.5 text-right font-medium">Lead</th>
          <th className="py-2.5 text-right font-medium">Payment</th>
          <th className="py-2.5 text-right font-medium">Total</th>
          <th className="py-2.5 font-medium">Status</th>
          <th className="py-2.5 pr-8 text-right font-medium">Issued</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((po) => {
          const meta = supplierMeta(po.supplierId);
          return (
            <tr
              key={po.id}
              className="group cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/50"
            >
              <td className="px-8 py-3">
                <Link
                  to="/orders/$id"
                  params={{ id: po.id }}
                  className="flex items-center gap-2"
                >
                  <Package className="size-3.5 text-muted-foreground" />
                  <span className="font-mono text-[12.5px] font-medium text-foreground">
                    {po.poNumber}
                  </span>
                </Link>
              </td>
              <td className="py-3 text-foreground">{meta.label}</td>
              <td className="py-3 text-right font-mono tabular text-foreground">
                {po.leadTimeDays}d
              </td>
              <td className="py-3 text-right font-mono tabular text-foreground">
                {shortenPaymentTerms(po.paymentTerms)}
              </td>
              <td className="py-3 text-right font-mono tabular font-medium text-foreground">
                {money(po.totalAmount, po.currency)}
              </td>
              <td className="py-3">
                <StatusBadge status={po.status} />
              </td>
              <td className="py-3 pr-8 text-right tabular text-muted-foreground">
                {formatRelative(po.issuedAt)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusBadge({ status }: { status: PurchaseOrderSummary['status'] }) {
  const tone: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    issued: 'bg-success/15 text-success',
    acknowledged: 'bg-primary/15 text-primary',
    fulfilled: 'bg-foreground text-background',
    cancelled: 'bg-destructive/15 text-destructive',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium capitalize',
        tone[status] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {status}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center px-8 py-16">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Package className="size-5" />
        </div>
        <h3 className="mt-4 font-display text-[18px] font-semibold tracking-tight text-foreground">
          No orders yet
        </h3>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          Close an RFQ and convert the winning negotiation into a purchase
          order. It will appear here once issued.
        </p>
        <Link to="/quotations" className="mt-5 inline-block">
          <Button size="sm" variant="outline">
            Go to RFQs
            <ArrowRight className="size-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function ErrorState({
  onRetry,
  message,
}: {
  onRetry: () => void;
  message?: string;
}) {
  return (
    <div className="flex h-full items-center justify-center px-8 py-16">
      <div className="max-w-md text-center">
        <h3 className="font-display text-[16px] font-semibold tracking-tight text-foreground">
          Can't reach the API
        </h3>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          {message ?? 'The backend is not responding.'}
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-1 px-8 py-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b border-border/60 py-3"
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
