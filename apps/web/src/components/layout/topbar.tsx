import { Clock, PanelLeft, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { AskAmberPanel } from '@/components/layout/ask-amber-panel';
import { useStreamContext } from '@/lib/stream-context';

export function Topbar() {
  const [panelOpen, setPanelOpen] = useState(false);
  const { quotationId, events } = useStreamContext();
  const live = quotationId && events.length > 0;

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <button
        type="button"
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Collapse sidebar"
      >
        <PanelLeft className="size-4" />
      </button>

      <div className="mx-auto flex h-9 w-full max-w-xl items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 text-[13px] text-muted-foreground">
        <Search className="size-3.5" />
        <span className="flex-1">Search</span>
        <Clock className="size-3.5" />
      </div>

      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className="relative flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-b from-primary to-[oklch(0.50_0.23_290)] px-3 text-[13px] font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-95"
      >
        <Sparkles className="size-3.5" />
        Ask Amber
        {live ? (
          <span className="absolute -top-1 -right-1 flex size-2.5 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-success/70 opacity-80" />
            <span className="relative size-2 rounded-full bg-success" />
          </span>
        ) : null}
      </button>

      <AskAmberPanel open={panelOpen} onOpenChange={setPanelOpen} />
    </header>
  );
}
