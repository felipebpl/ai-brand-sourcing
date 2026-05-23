import type {
  NegotiationOffer,
  NegotiationStatus,
  QuotationStatus,
  Recommendation,
  SupplierComparisonRow,
  UserInstructionIntent,
} from '@app/shared';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3030';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type QuotationSummary = {
  id: string;
  status: QuotationStatus;
  uploadedFilename: string;
  userInstruction: string | null;
  sourceSupplierId: string;
  recommendedNegotiationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QuotationListResponse = { quotations: QuotationSummary[] };

export type QuotationLineRow = {
  id: string;
  quotationId: string;
  rawSku: string | null;
  rawDescription: string | null;
  minQty: number;
  maxQty: number | null;
  unitPrice: string;
  currency: string;
  matchedSku: string | null;
  matchConfidence: string | null;
  matchMethod: string | null;
  matchReasoning: string | null;
  sourceRef: unknown;
  rawExtras: unknown;
};

export type NegotiationMessageRow = {
  id: string;
  negotiationId: string;
  role: 'brand' | 'supplier' | 'system';
  turnIndex: number;
  content: string;
  offer: NegotiationOffer | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type NegotiationRow = {
  id: string;
  quotationId: string;
  supplierId: string;
  status: NegotiationStatus;
  finalUnitPriceAvg: string | null;
  finalLeadTimeDays: number | null;
  finalPaymentTerms: unknown;
  roundsCount: number;
  priceConcessionPct: number | null;
  negotiationDurationSeconds: number | null;
  winningDimensions: string[] | null;
  createdAt: string;
  updatedAt: string;
  messages: NegotiationMessageRow[];
};

export type QuotationDetailResponse = {
  quotation: {
    id: string;
    brandId: string;
    sourceSupplierId: string;
    uploadedFilename: string;
    storageUri: string;
    userInstruction: string | null;
    userInstructionIntent: UserInstructionIntent | null;
    parsedMetadata: Record<string, unknown> | null;
    status: QuotationStatus;
    recommendedNegotiationId: string | null;
    recommendationReasoning: string | null;
    recommendationComparison: SupplierComparisonRow[] | null;
    recommendedAt: string | null;
    recommendationHistory: Array<
      Recommendation & { supersededReason: string | null }
    >;
    createdAt: string;
    updatedAt: string;
  };
  lines: QuotationLineRow[];
  negotiations: NegotiationRow[];
};

export const api = {
  listQuotations: () => request<QuotationListResponse>('/quotations'),
  getQuotation: (id: string) =>
    request<QuotationDetailResponse>(`/quotations/${id}`),
  createQuotation: (form: FormData) =>
    request<{ quotationId: string; status: QuotationStatus }>('/quotations', {
      method: 'POST',
      body: form,
    }),
  listPurchaseOrders: () => request<unknown>('/purchase-orders'),
  getPurchaseOrder: (id: string) => request<unknown>(`/purchase-orders/${id}`),
  createPurchaseOrder: (quotationId: string) =>
    request<{ purchaseOrderId?: string; status: string }>('/purchase-orders', {
      method: 'POST',
      body: JSON.stringify({ quotationId }),
    }),
};

export { ApiError };
