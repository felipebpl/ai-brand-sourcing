export type SupplierMeta = {
  id: string;
  label: string;
  shortLabel: string;
  initials: string;
  country: string;
  qualityScore: number;
  leadTimeDays: number;
  paymentTerms: string;
  positioning: string;
  accent: 'teal' | 'indigo' | 'coral';
};

export const SUPPLIERS: Record<string, SupplierMeta> = {
  'supplier-1': {
    id: 'supplier-1',
    label: 'Thai Textiles Ltd.',
    shortLabel: 'Thai Textiles',
    initials: 'TT',
    country: 'Thailand',
    qualityScore: 4.0,
    leadTimeDays: 50,
    paymentTerms: '33/33/33',
    positioning: 'Source supplier · cheapest baseline',
    accent: 'teal',
  },
  'supplier-2': {
    id: 'supplier-2',
    label: 'Apex Manufacturing',
    shortLabel: 'Apex',
    initials: 'AP',
    country: 'Vietnam',
    qualityScore: 4.7,
    leadTimeDays: 25,
    paymentTerms: '40/60',
    positioning: 'Premium · highest quality',
    accent: 'indigo',
  },
  'supplier-3': {
    id: 'supplier-3',
    label: 'Velocity Fabriks',
    shortLabel: 'Velocity',
    initials: 'VF',
    country: 'Cambodia',
    qualityScore: 4.0,
    leadTimeDays: 15,
    paymentTerms: '100% up',
    positioning: 'Speed-focused · 15d lead',
    accent: 'coral',
  },
};

export function supplierMeta(id: string): SupplierMeta {
  return (
    SUPPLIERS[id] ?? {
      id,
      label: id,
      shortLabel: id,
      initials: id.slice(0, 2).toUpperCase(),
      country: '',
      qualityScore: 0,
      leadTimeDays: 0,
      paymentTerms: '',
      positioning: '',
      accent: 'teal',
    }
  );
}

export function accentClasses(accent: SupplierMeta['accent']): {
  bg: string;
  text: string;
  ring: string;
} {
  switch (accent) {
    case 'indigo':
      return {
        bg: 'bg-[oklch(0.93_0.05_255)]',
        text: 'text-[oklch(0.36_0.16_255)]',
        ring: 'ring-[oklch(0.65_0.16_255)]',
      };
    case 'coral':
      return {
        bg: 'bg-[oklch(0.92_0.06_30)]',
        text: 'text-[oklch(0.45_0.16_30)]',
        ring: 'ring-[oklch(0.72_0.16_30)]',
      };
    case 'teal':
    default:
      return {
        bg: 'bg-[oklch(0.92_0.05_195)]',
        text: 'text-[oklch(0.38_0.12_200)]',
        ring: 'ring-[oklch(0.70_0.12_195)]',
      };
  }
}
