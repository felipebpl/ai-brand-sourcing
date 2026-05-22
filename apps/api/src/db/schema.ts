import { relations, sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Database schema for the ai-brand-sourcing app.
 *
 * Domain (see docs/ONTOLOGY.md):
 *   - Quotation: a supplier-uploaded XLSX, parsed into line items.
 *   - ProductCatalog: brand-side source of truth for SKUs.
 *   - Negotiation: one per (quotation x supplier), with messages and offers.
 *   - PurchaseOrder: durable commitment derived from a winning negotiation.
 */

export const quotationStatus = pgEnum('quotation_status', [
  'uploaded',
  'parsing',
  'parsed',
  'matched',
  'negotiating',
  'awaiting_decision',
  'completed',
  'failed',
]);

export const negotiationStatus = pgEnum('negotiation_status', [
  'pending',
  'in_progress',
  'awaiting_curveball',
  'concluded',
  'failed',
]);

export const negotiationMessageRole = pgEnum('negotiation_message_role', [
  'brand',
  'supplier',
  'system',
]);

export const purchaseOrderStatus = pgEnum('purchase_order_status', [
  'draft',
  'issued',
  'acknowledged',
  'fulfilled',
  'cancelled',
]);

export const quotation = pgTable('quotation', {
  id: uuid('id').primaryKey().defaultRandom(),
  uploadedFilename: text('uploaded_filename').notNull(),
  sourceSupplierId: text('source_supplier_id').notNull(),
  userInstruction: text('user_instruction'),
  status: quotationStatus('status').notNull().default('uploaded'),
  extractedAt: timestamp('extracted_at', { withTimezone: true }),
  extraction: jsonb('extraction'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const parsedItem = pgTable('parsed_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  quotationId: uuid('quotation_id')
    .references(() => quotation.id, { onDelete: 'cascade' })
    .notNull(),
  rawSku: text('raw_sku'),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
  unit: text('unit'),
  unitPrice: numeric('unit_price', { precision: 14, scale: 4 }).notNull(),
  lineTotal: numeric('line_total', { precision: 14, scale: 4 }),
  currency: text('currency').notNull().default('USD'),
  matchedSku: text('matched_sku'),
  matchConfidence: numeric('match_confidence', { precision: 4, scale: 3 }),
  matchMethod: text('match_method'),
  notes: text('notes'),
  rawConfidence: numeric('raw_confidence', { precision: 4, scale: 3 }),
});

export const productCatalog = pgTable('product_catalog', {
  sku: text('sku').primaryKey(),
  name: text('name').notNull(),
  category: text('category'),
  unit: text('unit'),
  basePrice: numeric('base_price', { precision: 14, scale: 4 }),
  metadata: jsonb('metadata'),
  embedding: jsonb('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const supplier = pgTable('supplier', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  qualityScore: numeric('quality_score', { precision: 3, scale: 2 }).notNull(),
  defaultLeadTimeDays: integer('default_lead_time_days').notNull(),
  defaultPaymentTerms: jsonb('default_payment_terms').notNull(),
  persona: text('persona').notNull(),
  pricingProfile: text('pricing_profile').notNull(),
});

export const negotiation = pgTable('negotiation', {
  id: uuid('id').primaryKey().defaultRandom(),
  quotationId: uuid('quotation_id')
    .references(() => quotation.id, { onDelete: 'cascade' })
    .notNull(),
  supplierId: text('supplier_id')
    .references(() => supplier.id)
    .notNull(),
  status: negotiationStatus('status').notNull().default('pending'),
  inngestRunId: text('inngest_run_id'),
  rationale: text('rationale'),
  qualityScore: numeric('quality_score', { precision: 3, scale: 2 }),
  totalCost: numeric('total_cost', { precision: 14, scale: 4 }),
  fulfillablePercent: numeric('fulfillable_percent', { precision: 4, scale: 3 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  concludedAt: timestamp('concluded_at', { withTimezone: true }),
});

export const negotiationMessage = pgTable('negotiation_message', {
  id: uuid('id').primaryKey().defaultRandom(),
  negotiationId: uuid('negotiation_id')
    .references(() => negotiation.id, { onDelete: 'cascade' })
    .notNull(),
  role: negotiationMessageRole('role').notNull(),
  turn: integer('turn').notNull(),
  content: text('content').notNull(),
  offer: jsonb('offer'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const winnerSelection = pgTable('winner_selection', {
  id: uuid('id').primaryKey().defaultRandom(),
  quotationId: uuid('quotation_id')
    .references(() => quotation.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  primaryNegotiationId: uuid('primary_negotiation_id')
    .references(() => negotiation.id)
    .notNull(),
  splitWith: jsonb('split_with').notNull().default(sql`'[]'::jsonb`),
  reasoning: text('reasoning').notNull(),
  tradeoffs: jsonb('tradeoffs').notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const purchaseOrder = pgTable('purchase_order', {
  id: uuid('id').primaryKey().defaultRandom(),
  poNumber: text('po_number').notNull().unique(),
  quotationId: uuid('quotation_id')
    .references(() => quotation.id)
    .notNull(),
  negotiationId: uuid('negotiation_id')
    .references(() => negotiation.id)
    .notNull(),
  supplierId: text('supplier_id')
    .references(() => supplier.id)
    .notNull(),
  status: purchaseOrderStatus('status').notNull().default('draft'),
  currency: text('currency').notNull().default('USD'),
  subtotal: numeric('subtotal', { precision: 14, scale: 4 }).notNull(),
  totalAmount: numeric('total_amount', { precision: 14, scale: 4 }).notNull(),
  leadTimeDays: integer('lead_time_days').notNull(),
  paymentTerms: jsonb('payment_terms').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const purchaseOrderLineItem = pgTable('purchase_order_line_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  poId: uuid('po_id')
    .references(() => purchaseOrder.id, { onDelete: 'cascade' })
    .notNull(),
  productSku: text('product_sku').notNull(),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 4 }).notNull(),
  lineTotal: numeric('line_total', { precision: 14, scale: 4 }).notNull(),
});

export const quotationRelations = relations(quotation, ({ many }) => ({
  parsedItems: many(parsedItem),
  negotiations: many(negotiation),
}));

export const negotiationRelations = relations(negotiation, ({ one, many }) => ({
  quotation: one(quotation, {
    fields: [negotiation.quotationId],
    references: [quotation.id],
  }),
  supplier: one(supplier, {
    fields: [negotiation.supplierId],
    references: [supplier.id],
  }),
  messages: many(negotiationMessage),
}));

export const purchaseOrderRelations = relations(purchaseOrder, ({ one, many }) => ({
  negotiation: one(negotiation, {
    fields: [purchaseOrder.negotiationId],
    references: [negotiation.id],
  }),
  supplier: one(supplier, {
    fields: [purchaseOrder.supplierId],
    references: [supplier.id],
  }),
  lineItems: many(purchaseOrderLineItem),
}));
