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
