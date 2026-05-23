import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2, FileSpreadsheet, Sparkles } from 'lucide-react';
import { ActivityTicker } from '@/components/workspace/activity-ticker';
import { LinesTable } from '@/components/workspace/lines-table';
import { SupplierCard } from '@/components/workspace/supplier-card';
import { WhyThisWinner } from '@/components/workspace/why-this-winner';
import { WorkspaceHeader } from '@/components/workspace/workspace-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useNegotiationStream } from '@/lib/sse';

export const Route = createFileRoute('/quotations/$id')({
  component: QuotationWorkspace,
});

function QuotationWorkspace() {
  const { id } = Route.useParams();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => api.getQuotation(id),
  });

  const { lastEvent } = useNegotiationStream(data ? id : undefined);

  if (isLoading) {
    return <WorkspaceSkeleton />;
  }
  if (isError || !data) {
    return (
      <div className="px-8 py-16 text-center">
        <h2 className="font-display text-[18px] font-semibold tracking-tight">
          Couldn't load this quotation
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

  const { quotation, lines, negotiations } = data;
  const winnerNegId = quotation.recommendedNegotiationId;
  const maxRounds = Math.max(0, ...negotiations.map((n) => n.roundsCount));
  const isActive =
    quotation.status === 'parsing' ||
    quotation.status === 'negotiating' ||
    quotation.status === 'uploaded';
  const isPreNegotiation =
    quotation.status === 'uploaded' || quotation.status === 'parsing';

  const leadingNegotiationId = negotiations
    .map((n) => {
      const last = [...n.messages].reverse().find((m) => m.role === 'supplier');
      const price = last?.offer?.unitPriceAvg ?? null;
      return { id: n.id, price };
    })
    .filter((x) => x.price != null)
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0]?.id;

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader q={quotation} roundsInFlight={maxRounds} />

      {isActive ? (
        <div className="pointer-events-none sticky top-3 z-10 flex justify-center px-8">
          <div className="pointer-events-auto">
            <ActivityTicker lastEvent={lastEvent} />
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-auto px-8 pt-6 pb-24">
        {isPreNegotiation ? (
          <ParsingPanel status={quotation.status} />
        ) : (
          <>
            <SectionLabel>Suppliers in negotiation</SectionLabel>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              {negotiations.map((n) => (
                <SupplierCard
                  key={n.id}
                  quotationId={quotation.id}
                  negotiation={n}
                  isWinner={n.id === winnerNegId}
                  isLeading={n.id === leadingNegotiationId && n.id !== winnerNegId}
                />
              ))}
            </div>

            {quotation.status === 'recommended' ||
            quotation.status === 'committed' ? (
              <div className="mt-8">
                <WhyThisWinner q={quotation} />
              </div>
            ) : null}

            <div className="mt-8">
              <SectionLabel>
                Line items
                <span className="ml-2 text-[10.5px] font-normal text-muted-foreground">
                  baseline from {quotation.uploadedFilename} ·{' '}
                  {lines.length} items
                </span>
              </SectionLabel>
              <div className="mt-3">
                <LinesTable lines={lines} negotiations={negotiations} />
              </div>
            </div>
          </>
        )}
      </div>

      {quotation.status === 'recommended' ? (
        <ConvertBar quotationId={quotation.id} />
      ) : null}
      {quotation.status === 'committed' ? (
        <CommittedBar />
      ) : null}
    </div>
  );
}

function ParsingPanel({ status }: { status: string }) {
  const messages: Record<string, { title: string; body: string }> = {
    uploaded: {
      title: 'Just received',
      body: "We're about to open the file and read what the supplier sent.",
    },
    parsing: {
      title: 'Parsing the quotation',
      body: 'Reading the spreadsheet, matching SKUs against the catalog, and resolving typos — usually around 30 seconds.',
    },
  };
  const m = messages[status] ?? messages.parsing;
  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-8 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-primary">
        <FileSpreadsheet className="size-5" />
      </div>
      <h2 className="mt-4 font-display text-[20px] font-semibold tracking-tight">
        {m?.title}
      </h2>
      <p className="mt-1.5 text-[13px] text-muted-foreground">{m?.body}</p>
      <div className="mx-auto mt-5 flex w-32 items-center justify-center gap-1.5">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="size-1.5 animate-pulse rounded-full bg-primary"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function ConvertBar({ quotationId }: { quotationId: string }) {
  return (
    <div className="border-t border-border bg-background px-8 py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          The winning negotiation is ready to commit.
        </div>
        <Button
          size="default"
          className="bg-foreground text-background hover:bg-foreground/90"
          // wired in task #7 (Create Draft Order dialog)
          data-quotation-id={quotationId}
        >
          <CheckCircle2 className="size-3.5" />
          Create Draft Order
        </Button>
      </div>
    </div>
  );
}

function CommittedBar() {
  return (
    <div className="border-t border-border bg-success/5 px-8 py-3">
      <div className="flex items-center justify-between text-[12.5px]">
        <div className="flex items-center gap-2 text-foreground">
          <CheckCircle2 className="size-3.5 text-success" />
          Purchase Order issued.
        </div>
        <Button size="sm" variant="outline">
          Open PO
        </Button>
      </div>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-6 px-8 py-6">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-4 w-48" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
