import type { NegotiationRow, QuotationLineRow } from '@/lib/api';
import { delta, money } from '@/lib/format';
import { supplierMeta } from '@/lib/suppliers';
import { cn } from '@/lib/utils';

type Props = {
  lines: QuotationLineRow[];
  negotiations: NegotiationRow[];
};

export function LinesTable({ lines, negotiations }: Props) {
  if (lines.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-6 py-10 text-center text-[12.5px] text-muted-foreground">
        Quotation lines will appear here once parsing completes.
      </div>
    );
  }

  const supplierLatestPrice = (n: NegotiationRow): number | null => {
    const last = [...n.messages].reverse().find((m) => m.role === 'supplier');
    if (last?.offer) return last.offer.unitPriceAvg;
    if (n.finalUnitPriceAvg) return Number.parseFloat(n.finalUnitPriceAvg);
    return null;
  };

  const baseline = lines.reduce((sum, l) => {
    const p = Number.parseFloat(l.unitPrice);
    return sum + (Number.isNaN(p) ? 0 : p);
  }, 0);
  const baselineAvg = lines.length > 0 ? baseline / lines.length : 0;

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 font-medium">SKU</th>
            <th className="py-2 font-medium">Description</th>
            <th className="py-2 text-right font-medium">Qty</th>
            <th className="py-2 text-right font-medium">Baseline</th>
            {negotiations.map((n) => {
              const meta = supplierMeta(n.supplierId);
              return (
                <th
                  key={n.id}
                  className="py-2 text-right font-medium"
                  title={meta.label}
                >
                  {meta.shortLabel}
                </th>
              );
            })}
            <th className="px-4 py-2 text-right font-medium">vs Baseline</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const linePrice = Number.parseFloat(line.unitPrice);
            const bestNeg = negotiations
              .map((n) => ({ n, price: supplierLatestPrice(n) }))
              .filter((x) => x.price != null)
              .sort((a, b) => (a.price! ?? 0) - (b.price! ?? 0))[0];
            const best = bestNeg?.price;
            const d = best != null ? delta(best, linePrice) : null;
            return (
              <tr
                key={line.id}
                className="border-b border-border/70 last:border-b-0 hover:bg-muted/30"
              >
                <td className="px-4 py-2.5">
                  <div className="font-mono text-[11.5px] text-foreground">
                    {line.matchedSku ?? line.rawSku ?? '—'}
                  </div>
                  {line.matchedSku && line.rawSku && line.matchedSku !== line.rawSku ? (
                    <div className="text-[10.5px] italic text-muted-foreground">
                      from {line.rawSku}
                    </div>
                  ) : null}
                </td>
                <td className="max-w-[260px] truncate py-2.5 text-foreground">
                  {line.rawDescription ?? '—'}
                </td>
                <td className="py-2.5 text-right font-mono tabular text-foreground">
                  {line.minQty}
                  {line.maxQty && line.maxQty !== line.minQty
                    ? `–${line.maxQty}`
                    : ''}
                </td>
                <td className="py-2.5 text-right font-mono tabular text-foreground">
                  {money(line.unitPrice, line.currency)}
                </td>
                {negotiations.map((n) => {
                  const price = supplierLatestPrice(n);
                  const isBest = bestNeg?.n.id === n.id && price != null;
                  return (
                    <td
                      key={n.id}
                      className={cn(
                        'py-2.5 text-right font-mono tabular',
                        isBest ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {price != null ? (
                        <span
                          className={cn(
                            isBest && 'font-medium',
                          )}
                        >
                          {money(price, line.currency)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">·</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-2.5 text-right">
                  {d ? (
                    <span
                      className={cn(
                        'font-mono text-[11.5px] tabular',
                        d.tone === 'down'
                          ? 'text-success'
                          : d.tone === 'up'
                          ? 'text-destructive'
                          : 'text-muted-foreground',
                      )}
                    >
                      {d.label}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-muted/40 text-foreground">
            <td className="px-4 py-2 font-medium">Average</td>
            <td className="py-2 text-muted-foreground" colSpan={2} />
            <td className="py-2 text-right font-mono tabular">
              {money(baselineAvg)}
            </td>
            {negotiations.map((n) => {
              const last = [...n.messages]
                .reverse()
                .find((m) => m.role === 'supplier');
              const offer = last?.offer ?? null;
              return (
                <td
                  key={n.id}
                  className="py-2 text-right font-mono tabular text-foreground"
                >
                  {offer ? money(offer.unitPriceAvg) : (
                    <span className="text-muted-foreground/60">·</span>
                  )}
                </td>
              );
            })}
            <td className="px-4 py-2" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
