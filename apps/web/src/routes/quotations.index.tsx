import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Filter, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { StatusPill } from '@/components/quotations/status-pill';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type QuotationSummary } from '@/lib/api';
import { rfqNumber } from '@/lib/rfq';
import { supplierMeta } from '@/lib/suppliers';
import { formatRelative } from '@/lib/time';

export const Route = createFileRoute('/quotations/')({
  component: RFQsIndex,
});

function RFQsIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['quotations'],
    queryFn: api.listQuotations,
    refetchInterval: (query) => {
      const rows = query.state.data?.quotations ?? [];
      const hasActive = rows.some((q) =>
        ['uploaded', 'parsing', 'parsed', 'negotiating'].includes(q.status),
      );
      return hasActive ? 3_000 : false;
    },
  });

  const createMutation = useMutation({
    mutationFn: api.createRfq,
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['quotations'] });
      navigate({ to: '/quotations/$id', params: { id: res.quotationId } });
    },
  });

  const rows = data?.quotations ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end justify-between px-8 pt-7 pb-5">
        <div>
          <h1 className="font-display text-[24px] font-semibold tracking-tight text-foreground">
            RFQs
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Each RFQ is a sourcing event. Create one, ingest the supplier's
            quote, and we'll negotiate against all three suppliers in
            parallel.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          <Plus className="size-3.5" />
          {createMutation.isPending ? 'Creating…' : 'New RFQ'}
        </Button>
      </div>

      <div className="flex items-center gap-2 border-b border-border px-8 pb-3">
        <button className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12px] font-medium text-foreground hover:bg-muted">
          <Filter className="size-3" />
          All RFQs
        </button>
        <button className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          Active
        </button>
        <button className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          Recommended
        </button>
        <button className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          Ordered
        </button>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12px] text-muted-foreground">
            <Search className="size-3" />
            <input
              placeholder="Search by file or intent"
              className="w-48 bg-transparent outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          <button className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12px] text-muted-foreground hover:text-foreground">
            <SlidersHorizontal className="size-3" />
            View
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? <ListSkeleton /> : null}
        {isError ? (
          <ErrorState
            onRetry={() => refetch()}
            message={(error as Error)?.message}
          />
        ) : null}
        {!isLoading && !isError && rows.length === 0 ? (
          <EmptyState onCreate={() => createMutation.mutate()} />
        ) : null}
        {!isLoading && !isError && rows.length > 0 ? (
          <RfqTable rows={rows} />
        ) : null}
      </div>

      {isFetching && rows.length > 0 ? (
        <div className="border-t border-border bg-background/60 px-8 py-1.5 text-[11px] text-muted-foreground">
          Live
          <span className="ml-1 inline-block size-1 animate-pulse rounded-full bg-primary align-middle" />
        </div>
      ) : null}
    </div>
  );
}

function RfqTable({ rows }: { rows: QuotationSummary[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-border text-left text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
          <th className="px-8 py-2.5 font-medium">RFQ</th>
          <th className="py-2.5 font-medium">From</th>
          <th className="py-2.5 font-medium">Status</th>
          <th className="py-2.5 font-medium">Sourcing intent</th>
          <th className="py-2.5 pr-8 text-right font-medium">Updated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((q) => {
          const source = supplierMeta(q.sourceSupplierId);
          const fileLabel =
            q.uploadedFilename ?? 'Awaiting supplier quote';
          return (
            <tr
              key={q.id}
              className="group cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/50"
            >
              <td className="px-8 py-3">
                <Link
                  to="/quotations/$id"
                  params={{ id: q.id }}
                  className="flex flex-col gap-0.5"
                >
                  <span className="font-mono text-[12.5px] font-medium text-foreground">
                    {rfqNumber(q)}
                  </span>
                  <span
                    className={
                      q.uploadedFilename
                        ? 'truncate text-[11.5px] text-muted-foreground'
                        : 'truncate text-[11.5px] italic text-muted-foreground/80'
                    }
                  >
                    {fileLabel}
                  </span>
                </Link>
              </td>
              <td className="py-3 text-foreground">{source.label}</td>
              <td className="py-3">
                <StatusPill status={q.status} />
              </td>
              <td className="max-w-[360px] truncate py-3 text-muted-foreground">
                {q.userInstruction || (
                  <span className="italic text-muted-foreground/60">—</span>
                )}
              </td>
              <td className="py-3 pr-8 text-right tabular text-muted-foreground">
                {formatRelative(q.updatedAt)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full items-center justify-center px-8 py-16">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-primary">
          <Plus className="size-5" />
        </div>
        <h3 className="mt-4 font-display text-[18px] font-semibold tracking-tight text-foreground">
          No RFQs yet
        </h3>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          Create an RFQ to start a sourcing event. You'll ingest the supplier
          quote from inside it.
        </p>
        <Button className="mt-5" size="sm" onClick={onCreate}>
          <Plus className="size-3.5" />
          New RFQ
        </Button>
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
          {message ||
            "The backend isn't responding at localhost:3030. Start it with `PORT=3030 bun --filter @app/api dev`."}
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
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b border-border/60 py-3"
        >
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
