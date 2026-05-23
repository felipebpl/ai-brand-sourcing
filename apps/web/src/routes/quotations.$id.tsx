import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/quotations/$id')({
  component: QuotationWorkspace,
});

function QuotationWorkspace() {
  const { id } = Route.useParams();
  return (
    <div className="px-8 py-6">
      <div className="text-[12px] text-muted-foreground">Quotation</div>
      <h1 className="font-display text-[22px] font-semibold tracking-tight">
        {id}
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Workspace placeholder. The negotiation experience lands here next.
      </p>
    </div>
  );
}
