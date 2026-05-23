import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NegotiationStreamProvider } from '@/lib/stream-context';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <TooltipProvider delayDuration={150}>
      <NegotiationStreamProvider>
        <div className="flex h-screen bg-background text-foreground">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="min-h-0 flex-1 overflow-auto">
              <Outlet />
            </main>
          </div>
        </div>
      </NegotiationStreamProvider>
    </TooltipProvider>
  );
}
