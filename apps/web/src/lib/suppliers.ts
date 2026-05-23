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
  accent: 'pink' | 'green' | 'purple' | 'amber';
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
    accent: 'amber',
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
    accent: 'pink',
  },
  'supplier-3': {
    id: 'supplier-3',
    label: 'Velocity Fabriks',
    shortLabel: 'Velocity',
    initials: 'VF',
    country: 'Cambodia',
    qualityScore: 4.0,
    leadTimeDays: 15,
    paymentTerms: '100% upfront',
    positioning: 'Speed-focused · 15d lead',
    accent: 'green',
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
      accent: 'amber',
    }
  );
}

export function accentClasses(accent: SupplierMeta['accent']): {
  bg: string;
  text: string;
  ring: string;
} {
  switch (accent) {
    case 'pink':
      return {
        bg: 'bg-[oklch(0.93_0.06_350)]',
        text: 'text-[oklch(0.42_0.16_350)]',
        ring: 'ring-[oklch(0.78_0.13_350)]',
      };
    case 'green':
      return {
        bg: 'bg-[oklch(0.93_0.08_155)]',
        text: 'text-[oklch(0.38_0.14_155)]',
        ring: 'ring-[oklch(0.72_0.16_155)]',
      };
    case 'purple':
      return {
        bg: 'bg-[oklch(0.93_0.06_290)]',
        text: 'text-[oklch(0.40_0.18_290)]',
        ring: 'ring-[oklch(0.72_0.18_290)]',
      };
    case 'amber':
    default:
      return {
        bg: 'bg-[oklch(0.93_0.07_75)]',
        text: 'text-[oklch(0.42_0.14_70)]',
        ring: 'ring-[oklch(0.78_0.13_75)]',
      };
  }
}
