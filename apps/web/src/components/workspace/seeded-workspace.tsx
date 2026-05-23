import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  FileSpreadsheet,
  Mail,
  Package,
  Sparkles,
  Star,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { StatusPill } from '@/components/quotations/status-pill';
import { UploadDialog } from '@/components/quotations/upload-dialog';
import { Button } from '@/components/ui/button';
import { SEED_RFQ } from '@/lib/seed-rfq';
import { accentClasses, supplierMeta } from '@/lib/suppliers';
import { cn } from '@/lib/utils';

export function SeededWorkspace() {
  const [uploadOpen, setUploadOpen] = useState(false);

  const source = supplierMeta(SEED_RFQ.sourceSupplierId);
  const dueDate = new Date(SEED_RFQ.dueDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-background">
        <div className="flex items-center gap-2 px-8 pt-5 text-[12px] text-muted-foreground">
          <Link to="/quotations" className="hover:text-foreground">
            <ChevronLeft className="size-3.5" />
          </Link>
          <Link to="/quotations" className="hover:text-foreground">
            RFQs
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <span className="font-mono text-foreground">{SEED_RFQ.number}</span>
        </div>

        <div className="flex items-start justify-between gap-8 px-8 pt-2 pb-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3">
              <h1 className="font-display text-[26px] font-semibold tracking-tight text-foreground">
                {SEED_RFQ.number}
              </h1>
              <StatusPill status="awaiting" className="translate-y-[-2px]" />
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Package className="size-3.5" />
                {SEED_RFQ.productsTarget} products ·{' '}
                {SEED_RFQ.unitsTarget.toLocaleString()} units
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                Quote due {dueDate}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Mail className="size-3.5" />
                Requested from{' '}
                {SEED_RFQ.expectedSupplierIds
                  .map((id) => supplierMeta(id).shortLabel)
                  .join(', ')}
              </span>
            </div>
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
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 pt-6 pb-12">
        <div className="rounded-xl border border-border bg-card">
          <div className="grid grid-cols-1 md:grid-cols-3">
            {SEED_RFQ.expectedSupplierIds.map((sid) => {
              const meta = supplierMeta(sid);
              const accent = accentClasses(meta.accent);
              const isSource = sid === SEED_RFQ.sourceSupplierId;
              return (
                <div
                  key={sid}
                  className={cn(
                    'flex flex-col border-border p-5 md:border-l first:md:border-l-0',
                    isSource && 'bg-accent/30',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold',
                        accent.bg,
                        accent.text,
                      )}
                    >
                      {meta.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[15px] font-semibold tracking-tight text-foreground">
                        {meta.label}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        <Star className="size-3 fill-attention text-attention" />
                        <span className="tabular text-foreground">
                          {meta.qualityScore.toFixed(1)}
                        </span>
                        <span className="text-muted-foreground/60">·</span>
                        <span>{meta.country}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider">
                    <span className="size-1.5 rounded-full bg-attention" />
                    <span className="text-attention-foreground/80">
                      Awaiting reply
                    </span>
                  </div>

                  <div className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                    {meta.positioning}
                  </div>

                  {isSource ? (
                    <div className="mt-4">
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => setUploadOpen(true)}
                      >
                        <Upload className="size-3.5" />
                        Ingest their quote
                      </Button>
                      <div className="mt-1.5 text-[10.5px] text-muted-foreground">
                        Reply expected from this supplier first
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-md border border-dashed border-border px-3 py-2 text-[10.5px] italic text-muted-foreground">
                      Will negotiate once a baseline arrives
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-accent text-primary">
              <Sparkles className="size-4" />
            </div>
            <div className="flex-1">
              <h3 className="font-display text-[15px] font-semibold tracking-tight text-foreground">
                What happens when {source.shortLabel}'s quote lands
              </h3>
              <ol className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                <li>
                  1. The spreadsheet is parsed; SKUs are matched against the
                  catalog, typos resolved.
                </li>
                <li>
                  2. Their pricing becomes the baseline for the negotiation.
                </li>
                <li>
                  3. We negotiate against {SEED_RFQ.expectedSupplierIds.length}{' '}
                  suppliers in parallel — including renegotiating with{' '}
                  {source.shortLabel}.
                </li>
                <li>
                  4. You'll see a recommended winner with full reasoning. One
                  click converts it into a draft order.
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-background px-8 py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <FileSpreadsheet className="size-3.5" />
            Upload the supplier quote to start the negotiation.
          </div>
          <Button
            size="default"
            className="bg-foreground text-background hover:bg-foreground/90"
            onClick={() => setUploadOpen(true)}
          >
            <Upload className="size-3.5" />
            Upload supplier quote
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}
