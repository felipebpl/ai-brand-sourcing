import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';

export const Route = createFileRoute(
  '/quotations/$id/negotiations/$negotiationId',
)({
  component: NegotiationDrillIn,
});

function NegotiationDrillIn() {
  const { id, negotiationId } = Route.useParams();
  return (
    <div className="px-8 py-6">
      <Link
        to="/quotations/$id"
        params={{ id }}
        className="flex w-fit items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" /> Back to workspace
      </Link>
      <h1 className="mt-4 font-display text-[22px] font-semibold tracking-tight">
        Negotiation
      </h1>
      <p className="mt-1 text-[12px] font-mono text-muted-foreground">
        {negotiationId.slice(0, 8)}
      </p>
      <p className="mt-6 text-sm text-muted-foreground">
        Per-supplier negotiation timeline lands here next.
      </p>
    </div>
  );
}
