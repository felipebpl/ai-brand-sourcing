import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/orders/')({
  component: OrdersIndex,
});

function OrdersIndex() {
  return (
    <div className="px-8 py-6">
      <h1 className="font-display text-[22px] font-semibold tracking-tight">
        Orders
      </h1>
    </div>
  );
}
