import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/inbox')({
  component: InboxPage,
});

function InboxPage() {
  return (
    <div className="px-8 py-6">
      <h1 className="font-display text-[22px] font-semibold tracking-tight">
        Inbox
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Supplier messages and curveball events land here.
      </p>
    </div>
  );
}
