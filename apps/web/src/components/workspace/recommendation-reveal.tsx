import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { QuotationDetailResponse } from '@/lib/api';
import { WhyThisWinner } from './why-this-winner';

const STORAGE_PREFIX = 'rec-shown:';

type Props = {
  q: QuotationDetailResponse['quotation'];
};

/**
 * When the brand reaches a recommendation, surface it as a centered
 * modal demanding attention. After the user dismisses (close button,
 * outside click, Esc), the same card eases into a fixed slot at the top
 * of the workspace. Persist "shown" per RFQ in localStorage so refreshes
 * during the same demo don't re-pop the modal endlessly.
 */
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

  if (!hasRecommendation) return null;

  return (
    <>
      {shown ? (
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-500">
          <WhyThisWinner q={q} />
        </div>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) dismiss();
        }}
      >
        <DialogContent className="max-w-3xl border-none bg-transparent p-0 shadow-none">
          <WhyThisWinner q={q} />
        </DialogContent>
      </Dialog>
    </>
  );
}
