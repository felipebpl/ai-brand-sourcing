import { handleQuotationUploaded } from './functions/handle-quotation-uploaded';
import { handlePurchaseOrderRequested } from './functions/handle-purchase-order-requested';

/**
 * Inngest function registry.
 *
 * Three events drive the system; two have handlers today, the third
 * (`supplier/message` curveball) lands in Step 7 once the brand's
 * `reactToSupplierMessage` is implemented.
 */
export const functions = [
  handleQuotationUploaded,
  handlePurchaseOrderRequested,
] as const;
