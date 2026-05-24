import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
} from '@/components/ui/dialog';
import type { QuotationDetailResponse } from '@/lib/api';
import { WhyThisWinner } from './why-this-winner';

const STORAGE_PREFIX = 'rec-shown:';
const HISTORY_ANCHOR_ID = 'negotiation-history-anchor';

type Props = {
  q: QuotationDetailResponse['quotation'];
};

export function RecommendationReveal({ q }: Props) {
  const key = STORAGE_PREFIX + q.id;
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });

  const hasRecommendation =
    q.status === 'recommended' || q.status === 'committed';

  useEffect(() => {
    if (hasRecommendation && !shown && !open) {
      setOpen(true);
    }
  }, [hasRecommendation, shown, open]);

  const dismiss = () => {
    setOpen(false);
    setShown(true);
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      // storage unavailable — harmless
    }
  };

  const jumpToHistory = () => {
    const el = document.getElementById(HISTORY_ANCHOR_ID);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!hasRecommendation) return null;

  return (
    <>
      {shown ? (
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-500">
          <WhyThisWinner
            q={q}
            variant="inline"
            onJumpToHistory={jumpToHistory}
          />
        </div>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) dismiss();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-5xl border-none bg-transparent p-0 shadow-none sm:max-w-5xl"
        >
          <div className="relative">
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close"
                className="absolute -top-3 -right-3 z-10 flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </DialogClose>
            <WhyThisWinner q={q} variant="modal" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { HISTORY_ANCHOR_ID };
