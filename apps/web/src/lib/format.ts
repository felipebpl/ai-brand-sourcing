export function money(
  value: number | string | null | undefined,
  currency = 'USD',
): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function num(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(n);
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

type PaymentLike = {
  display?: string | null;
  installments?: Array<{ percent: number; dueDays?: number }> | null;
};

/**
 * Compresses payment terms into the short notation sourcing managers
 * scan ("100% up", "40/60", "33/33/33"). Falls back to whatever display
 * the backend stored when we don't have structured installments.
 */
export function shortenPaymentTerms(terms: PaymentLike | null | undefined): string {
  if (!terms) return '—';
  const installments = terms.installments ?? [];
  if (installments.length > 0) {
    const percents = installments
      .map((i) => Math.round(i.percent))
      .filter((p) => Number.isFinite(p));
    if (percents.length === 1 && percents[0] === 100) return '100% up';
    if (percents.length >= 1) return percents.join('/');
  }
  if (terms.display) {
    const fromDisplay = compressFromDisplay(terms.display);
    if (fromDisplay) return fromDisplay;
    return terms.display;
  }
  return '—';
}

function compressFromDisplay(display: string): string | null {
  const trimmed = display.trim();
  if (/^100\s*%\s*upfront$/i.test(trimmed)) return '100% up';
  const pctMatches = trimmed.match(/\d+(?:\.\d+)?\s*%/g);
  if (pctMatches && pctMatches.length >= 2) {
    return pctMatches
      .map((p) => Math.round(Number.parseFloat(p)))
      .filter((n) => Number.isFinite(n))
      .join('/');
  }
  return null;
}

export function delta(
  next: number | string | null | undefined,
  base: number | string | null | undefined,
): { label: string; tone: 'down' | 'up' | 'flat' } {
  if (next == null || base == null) return { label: '—', tone: 'flat' };
  const a = typeof next === 'string' ? Number.parseFloat(next) : next;
  const b = typeof base === 'string' ? Number.parseFloat(base) : base;
  if (Number.isNaN(a) || Number.isNaN(b) || b === 0)
    return { label: '—', tone: 'flat' };
  const diff = (a - b) / b;
  if (Math.abs(diff) < 0.001) return { label: '0%', tone: 'flat' };
  const sign = diff > 0 ? '+' : '−';
  return {
    label: `${sign}${(Math.abs(diff) * 100).toFixed(1)}%`,
    tone: diff < 0 ? 'down' : 'up',
  };
}
