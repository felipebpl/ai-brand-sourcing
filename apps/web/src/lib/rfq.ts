/**
 * Friendly display id for a quotation/RFQ. Deterministic from the UUID
 * so the same record always renders the same number — independent of
 * list ordering or extra round-trips. Matches Amber's RFQ-YYYY-XXXX
 * visual pattern.
 */
export function rfqNumber(q: { id: string; createdAt: string }): string {
  const year = new Date(q.createdAt).getUTCFullYear();
  const short = q.id.replace(/-/g, '').slice(0, 4).toUpperCase();
  return `RFQ-${year}-${short}`;
}
