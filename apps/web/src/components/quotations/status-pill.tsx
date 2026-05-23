import type { QuotationStatus } from '@app/shared';
import { cn } from '@/lib/utils';

const COPY: Record<QuotationStatus, string> = {
  uploaded: 'Uploaded',
  parsing: 'Parsing',
  parsed: 'Parsed',
  negotiating: 'Negotiating',
  recommended: 'Recommended',
  committed: 'Ordered',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

const DOT: Record<QuotationStatus, string> = {
  uploaded: 'bg-muted-foreground/60',
  parsing: 'bg-attention animate-pulse',
  parsed: 'bg-muted-foreground/60',
  negotiating: 'bg-primary animate-pulse',
  recommended: 'bg-success',
  committed: 'bg-foreground/80',
  cancelled: 'bg-muted-foreground/40',
  failed: 'bg-destructive',
};

export function StatusPill({
  status,
  className,
}: {
  status: QuotationStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground',
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', DOT[status])} />
      {COPY[status]}
    </span>
  );
}
