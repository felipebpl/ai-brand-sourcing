import type { QuotationStatus } from '@app/shared';

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

export const api = {
  listQuotations: () => request<QuotationListResponse>('/quotations'),
  getQuotation: (id: string) => request<unknown>(`/quotations/${id}`),
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
