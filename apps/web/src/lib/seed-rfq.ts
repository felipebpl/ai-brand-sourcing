/**
 * A virtual RFQ that lives only in the frontend. Represents the
 * realistic starting state of the sourcing flow — the brand created
 * an RFQ (selecting products + suppliers + target params), the system
 * sent requests to the three suppliers, and the brand is now waiting
 * for the first quote to land. Uploading the supplier's spreadsheet
 * from here triggers the real backend POST /quotations and the
 * resulting RFQ replaces this virtual placeholder in the user's
 * attention.
 *
 * Creating the upstream RFQ (products / suppliers / params) is out
 * of scope for the trial; the seed lets us start the demo from a
 * realistic mental model without building that wizard.
 */
export const SEED_RFQ_ID = 'seed-2026-0001';
export const SEED_RFQ_NUMBER = 'RFQ-2026-0001';
export const SEED_RFQ_DUE_DATE = '2026-06-15';

export type SeededRfq = {
  id: typeof SEED_RFQ_ID;
  number: string;
  status: 'awaiting';
  sourceSupplierId: string;
  expectedSupplierIds: string[];
  dueDate: string;
  unitsTarget: number;
  productsTarget: number;
  createdAt: string;
};

export const SEED_RFQ: SeededRfq = {
  id: SEED_RFQ_ID,
  number: SEED_RFQ_NUMBER,
  status: 'awaiting',
  sourceSupplierId: 'supplier-1',
  expectedSupplierIds: ['supplier-1', 'supplier-2', 'supplier-3'],
  dueDate: SEED_RFQ_DUE_DATE,
  unitsTarget: 2_000,
  productsTarget: 8,
  createdAt: '2026-05-20T09:00:00.000Z',
};

export function isSeedRfqId(id: string): boolean {
  return id === SEED_RFQ_ID;
}
