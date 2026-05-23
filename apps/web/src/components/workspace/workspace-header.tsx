import { ChevronLeft, FileSpreadsheet } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { QuotationDetailResponse } from '@/lib/api';
import { rfqNumber } from '@/lib/rfq';
import { formatRelative } from '@/lib/time';
import { supplierMeta } from '@/lib/suppliers';
import { StatusPill } from '@/components/quotations/status-pill';

type Props = {
  q: QuotationDetailResponse['quotation'];
  roundsInFlight: number;
};

export function WorkspaceHeader({ q, roundsInFlight }: Props) {
  const source = supplierMeta(q.sourceSupplierId);
  const number = rfqNumber(q);

  return (
    <div className="border-b border-border bg-background">
      <div className="flex items-center gap-2 px-8 pt-5 text-[12px] text-muted-foreground">
        <Link to="/quotations" className="hover:text-foreground">
          <ChevronLeft className="size-3.5" />
        </Link>
        <Link to="/quotations" className="hover:text-foreground">
          RFQs
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="font-mono text-foreground">{number}</span>
      </div>

      <div className="flex items-start justify-between gap-8 px-8 pt-2 pb-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-[26px] font-semibold tracking-tight text-foreground">
              {number}
            </h1>
            <StatusPill status={q.status} className="translate-y-[-2px]" />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
            <FileSpreadsheet className="size-3.5" />
            <span>
              Baseline from{' '}
              <span className="text-foreground">{source.label}</span>
            </span>
            <span className="text-muted-foreground/50">·</span>
            <span className="font-mono text-[11.5px]">
              {q.uploadedFilename}
            </span>
            <span className="text-muted-foreground/50">·</span>
            <span>{formatRelative(q.createdAt)}</span>
          </div>

          {q.userInstruction ? (
            <div className="mt-3 max-w-3xl rounded-md border border-border bg-muted/50 px-3 py-2 text-[12.5px] text-foreground">
              <span className="font-medium text-muted-foreground">
                Sourcing intent ·{' '}
              </span>
              {q.userInstruction}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <div className="flex items-center divide-x divide-border rounded-md border border-border bg-background text-[11.5px] font-medium">
            <button className="bg-muted px-2.5 py-1 text-foreground">
              FOB
            </button>
            <button className="px-2.5 py-1 text-muted-foreground hover:text-foreground">
              ~Landed
            </button>
          </div>
          <div className="ml-1 flex items-center divide-x divide-border rounded-md border border-border bg-background text-[11.5px] font-medium">
            <button className="bg-muted px-2.5 py-1 text-foreground">
              Margin
            </button>
            <button className="px-2.5 py-1 text-muted-foreground hover:text-foreground">
              Markup
            </button>
          </div>
        </div>
      </div>

      {roundsInFlight > 0 && q.status === 'negotiating' ? (
        <div className="flex items-center gap-2 px-8 pb-3 text-[11.5px] text-muted-foreground">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
          Round {roundsInFlight} in flight across 3 suppliers
        </div>
      ) : null}
    </div>
  );
}
