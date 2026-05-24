import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CheckCircle2 } from 'lucide-react';
import { AwaitingQuoteWorkspace } from '@/components/workspace/awaiting-quote-workspace';
import { ConvertBar } from '@/components/workspace/convert-bar';
import { LiveDialogue } from '@/components/workspace/live-dialogue';
import { NegotiationMatrix } from '@/components/workspace/negotiation-matrix';
import { ParsingActivity } from '@/components/workspace/parsing-activity';
import {
  HISTORY_ANCHOR_ID,
  RecommendationReveal,
} from '@/components/workspace/recommendation-reveal';
import { WorkspaceHeader } from '@/components/workspace/workspace-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useStreamContext } from '@/lib/stream-context';

export const Route = createFileRoute('/quotations/$id')({
  component: QuotationWorkspace,
});

function QuotationWorkspace() {
  const { id } = Route.useParams();
  return <RealWorkspace id={id} />;
}

function RealWorkspace({ id }: { id: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => api.getQuotation(id),
    refetchInterval: (query) => {
      const status = query.state.data?.quotation.status;
      const active =
        status === 'uploaded' ||
        status === 'parsing' ||
        status === 'parsed' ||
        status === 'negotiating';
      return active ? 4_000 : false;
    },
  });

  const { events } = useStreamContext();

  if (isLoading) {
    return <WorkspaceSkeleton />;
  }
  if (isError || !data) {
    return (
      <div className="px-8 py-16 text-center">
        <h2 className="font-display text-[18px] font-semibold tracking-tight text-foreground">
          Couldn't load this RFQ
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

  if (quotation.status === 'awaiting_quote') {
    return <AwaitingQuoteWorkspace q={quotation} />;
  }

  const winnerNegId = quotation.recommendedNegotiationId;
  const maxRounds = Math.max(0, ...negotiations.map((n) => n.roundsCount));
  const isPreNegotiation =
    quotation.status === 'uploaded' || quotation.status === 'parsing';
  const showLiveDialogue =
    quotation.status === 'parsed' ||
    quotation.status === 'negotiating' ||
    quotation.status === 'recommended' ||
    quotation.status === 'committed';

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader q={quotation} roundsInFlight={maxRounds} />

      <div className="flex-1 overflow-auto px-8 pt-6 pb-24">
        {isPreNegotiation ? (
          <ParsingActivity
            events={events}
            lines={lines}
            status={quotation.status as 'uploaded' | 'parsing'}
          />
        ) : (
          <div className="space-y-8">
            <RecommendationReveal q={quotation} />

            <NegotiationMatrix
              quotationId={quotation.id}
              quotationStatus={quotation.status}
              lines={lines}
              negotiations={negotiations}
              winnerNegotiationId={winnerNegId}
              comparison={quotation.recommendationComparison}
            />

            {showLiveDialogue ? (
              <div id={HISTORY_ANCHOR_ID} className="scroll-mt-6">
                <LiveDialogue
                  quotation={quotation}
                  negotiations={negotiations}
                  events={events}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      {quotation.status === 'recommended' ? (
        <ConvertBar q={quotation} lines={lines} />
      ) : null}
      {quotation.status === 'committed' ? <CommittedBar /> : null}
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
        <Link to="/orders">
          <Button size="sm" variant="outline">
            Open Orders
          </Button>
        </Link>
      </div>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-6 px-8 py-6">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-[480px]" />
    </div>
  );
}
