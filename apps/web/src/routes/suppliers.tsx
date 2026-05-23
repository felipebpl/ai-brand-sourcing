import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/suppliers')({
  component: SuppliersPage,
});

function SuppliersPage() {
  return (
    <div className="px-8 py-6">
      <h1 className="font-display text-[22px] font-semibold tracking-tight">
        Suppliers
      </h1>
    </div>
  );
}
