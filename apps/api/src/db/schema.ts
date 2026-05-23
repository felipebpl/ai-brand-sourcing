import { relations, sql } from 'drizzle-orm';
import {
  bigserial,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Database schema for ai-brand-sourcing.
 *
 * 8-table model — see docs/ONTOLOGY.md for the domain narrative.
 *
 * Conventions:
 * - All monetary values: numeric(14, 4) (string-typed by Drizzle; convert at boundary)
 * - All timestamps: timestamp with time zone (UTC)
 * - JSONB used wherever the future shape is non-fixed (events, offer payloads,
 *   recommendation history, performance metrics added by future ML modules)
 * - `brand_id` carried explicitly even though we run single-tenant today —
 *   keeps the door open for Amber's multi-brand future without rework
 *
 * Required Postgres extensions (run once at db:push):
 *   CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy SKU lookup tool
 */

// -------- Enums --------------------------------------------------------------

export const quotationStatus = pgEnum('quotation_status', [
  'uploaded',
  'parsing',
  'parsed',
  'negotiating',
  'recommended',
  'committed',
  'cancelled',
  'failed',
]);

export const negotiationStatus = pgEnum('negotiation_status', [
  'pending',
  'active',
  'concluded',
  'stalled',
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

// -------- Master data --------------------------------------------------------

/**
 * Product catalog — seeded from assets/products.csv (~10k SKUs for Valden).
 * The source of truth for SKU matching.
 *
 * `attributes` JSONB carries future-proof enrichment (material, weight,
 * compliance tags, etc.) without forcing schema migrations.
 *
 * Trigram GIN indexes on `sku` and `name` power the parser agent's
 * `lookup_catalog` MCP tool — requires the `pg_trgm` extension which the
 * seed script ensures.
 */
export const product = pgTable(
  'product',
  {
    sku: text('sku').primaryKey(),
    brandId: text('brand_id').notNull().default('valden'),
    name: text('name').notNull(),
    color: text('color'),
    attributes: jsonb('attributes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    skuTrgmIdx: index('product_sku_trgm_idx').using(
      'gin',
      sql`${table.sku} gin_trgm_ops`,
    ),
    nameTrgmIdx: index('product_name_trgm_idx').using(
      'gin',
      sql`${table.name} gin_trgm_ops`,
    ),
  }),
);

/**
 * Suppliers — both the one who uploaded the original quotation and the
 * three simulated counterparts. The source supplier is also renegotiable,
 * so it gets an agent persona too (4 supplier agents total per quotation).
 *
 * `persona` is the system-prompt fragment that drives the supplier agent's
 * negotiation style. `pricing_profile` is a coarse label
 * (cheap | mid | premium) used by the brand agent's reasoning.
 *
 * Performance fields (`reliability_score`, `on_time_delivery_rate`) are
 * nullable — populated by future fulfillment modules. ML training data
 * lives here.
 */
export const supplier = pgTable('supplier', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  qualityScore: numeric('quality_score', { precision: 3, scale: 2 }).notNull(),
  defaultLeadTimeDays: integer('default_lead_time_days').notNull(),
  defaultPaymentTerms: jsonb('default_payment_terms').notNull(),
  persona: text('persona').notNull(),
  pricingProfile: text('pricing_profile').notNull(),
  reliabilityScore: doublePrecision('reliability_score'),
  onTimeDeliveryRate: doublePrecision('on_time_delivery_rate'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// -------- Quotation ----------------------------------------------------------

/**
 * Quotation — one row per supplier-uploaded file.
 *
 * The current recommendation lives embedded here (denormalized for query
 * speed); recommendation history is a JSONB array of prior recommendations
 * that were superseded (e.g. by a curveball replan).
 *
 * `user_instruction_intent` is the structured projection of the free-text
 * instruction the user wrote at upload — extracted by the brand agent.
 * It carries `{ priority, constraints }` and is what makes the data
 * ML-trainable downstream.
 */
export const quotation = pgTable('quotation', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: text('brand_id').notNull().default('valden'),
  sourceSupplierId: text('source_supplier_id')
    .references(() => supplier.id)
    .notNull(),
  uploadedFilename: text('uploaded_filename').notNull(),
  storageUri: text('storage_uri').notNull(),
  userInstruction: text('user_instruction'),
  userInstructionIntent: jsonb('user_instruction_intent'),
  parsedMetadata: jsonb('parsed_metadata'),
  status: quotationStatus('status').notNull().default('uploaded'),

  // Embedded current recommendation. Nullable until brand agent decides.
  recommendedNegotiationId: uuid('recommended_negotiation_id'),
  recommendationReasoning: text('recommendation_reasoning'),
  recommendationComparison: jsonb('recommendation_comparison'),
  recommendedAt: timestamp('recommended_at', { withTimezone: true }),

  // History of prior recommendations (set on each curveball replan).
  recommendationHistory: jsonb('recommendation_history')
    .notNull()
    .default(sql`'[]'::jsonb`),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * QuotationLine — atomic unit of a quotation.
 *
 * One raw SKU can produce multiple rows: tier pricing expressed as duplicated
 * rows OR via multiple price columns are both unified by `min_qty`/`max_qty`
 * on each line.
 *
 * `matched_sku` is populated by the parser agent (agent-first matching);
 * `match_method` is one of agent_exact / agent_fuzzy_inferred /
 * agent_uncertain. `match_reasoning` is a one-line natural-language
 * justification, auditable.
 */
export const quotationLine = pgTable('quotation_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  quotationId: uuid('quotation_id')
    .references(() => quotation.id, { onDelete: 'cascade' })
    .notNull(),
  rawSku: text('raw_sku'),
  rawDescription: text('raw_description'),
  minQty: integer('min_qty').notNull(),
  maxQty: integer('max_qty'),
  unitPrice: numeric('unit_price', { precision: 14, scale: 4 }).notNull(),
  currency: text('currency').notNull().default('USD'),
  matchedSku: text('matched_sku').references(() => product.sku),
  matchConfidence: numeric('match_confidence', { precision: 4, scale: 3 }),
  matchMethod: text('match_method'),
  matchReasoning: text('match_reasoning'),
  sourceRef: jsonb('source_ref'),
  rawExtras: jsonb('raw_extras'),
});

// -------- Negotiation --------------------------------------------------------

/**
 * Negotiation — one thread per (quotation × supplier). For each quotation
 * we open 4: one for each supplier (source supplier included, since it is
 * renegotiable).
 *
 * Outcome metrics (`final_*`, `rounds_count`, `price_concession_pct`,
 * `negotiation_duration_seconds`, `winning_dimensions`) are denormalized at
 * conclusion time so future ML pipelines can query analytics directly
 * without replaying every message.
 */
export const negotiation = pgTable('negotiation', {
  id: uuid('id').primaryKey().defaultRandom(),
  quotationId: uuid('quotation_id')
    .references(() => quotation.id, { onDelete: 'cascade' })
    .notNull(),
  supplierId: text('supplier_id')
    .references(() => supplier.id)
    .notNull(),
  status: negotiationStatus('status').notNull().default('pending'),

  finalUnitPriceAvg: numeric('final_unit_price_avg', {
    precision: 14,
    scale: 4,
  }),
  finalLeadTimeDays: integer('final_lead_time_days'),
  finalPaymentTerms: jsonb('final_payment_terms'),
  roundsCount: integer('rounds_count').notNull().default(0),
  priceConcessionPct: doublePrecision('price_concession_pct'),
  negotiationDurationSeconds: integer('negotiation_duration_seconds'),
  winningDimensions: text('winning_dimensions').array(),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  concludedAt: timestamp('concluded_at', { withTimezone: true }),
});

/**
 * NegotiationMessage — each turn in a negotiation thread.
 *
 * `offer` is the structured snapshot of the proposal carried by that
 * message (nullable for free-form messages). `metadata` carries the model
 * used, inferred intent (for supplier messages), and event_type when the
 * message is a system event (e.g. a curveball delivered via
 * `supplier.message`).
 */
export const negotiationMessage = pgTable('negotiation_message', {
  id: uuid('id').primaryKey().defaultRandom(),
  negotiationId: uuid('negotiation_id')
    .references(() => negotiation.id, { onDelete: 'cascade' })
    .notNull(),
  role: negotiationMessageRole('role').notNull(),
  turnIndex: integer('turn_index').notNull(),
  content: text('content').notNull(),
  offer: jsonb('offer'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// -------- Purchase Order -----------------------------------------------------

/**
 * PurchaseOrder — committed deal. Materialized when the user clicks
 * "Convert to PO" on a recommended negotiation.
 *
 * Immutable after `issued` (status can only progress forward or to
 * cancelled). Future linkage to Shipment/Invoice is intentionally left
 * out of the schema — added when those entities exist.
 */
export const purchaseOrder = pgTable(
  'purchase_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    poNumber: text('po_number').notNull(),
    brandId: text('brand_id').notNull().default('valden'),
    quotationId: uuid('quotation_id')
      .references(() => quotation.id)
      .notNull(),
    negotiationId: uuid('negotiation_id')
      .references(() => negotiation.id)
      .notNull(),
    supplierId: text('supplier_id')
      .references(() => supplier.id)
      .notNull(),
    status: purchaseOrderStatus('status').notNull().default('issued'),
    currency: text('currency').notNull().default('USD'),
    subtotal: numeric('subtotal', { precision: 14, scale: 4 }).notNull(),
    totalAmount: numeric('total_amount', { precision: 14, scale: 4 }).notNull(),
    leadTimeDays: integer('lead_time_days').notNull(),
    paymentTerms: jsonb('payment_terms').notNull(),
    expectedDeliveryDate: timestamp('expected_delivery_date', {
      withTimezone: true,
    }),
    issuedAt: timestamp('issued_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    poNumberUnique: uniqueIndex('purchase_order_po_number_unique').on(
      table.poNumber,
    ),
  }),
);

/**
 * PurchaseOrderLine — atomic line. Every line references the
 * `quotation_line_id` it materializes, giving full end-to-end traceability:
 * PO line → quotation line → original supplier file row.
 */
export const purchaseOrderLine = pgTable('purchase_order_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  poId: uuid('po_id')
    .references(() => purchaseOrder.id, { onDelete: 'cascade' })
    .notNull(),
  quotationLineId: uuid('quotation_line_id')
    .references(() => quotationLine.id)
    .notNull(),
  productSku: text('product_sku')
    .references(() => product.sku)
    .notNull(),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 4 }).notNull(),
  lineTotal: numeric('line_total', { precision: 14, scale: 4 }).notNull(),
});

// -------- Relations ----------------------------------------------------------

export const quotationRelations = relations(quotation, ({ one, many }) => ({
  sourceSupplier: one(supplier, {
    fields: [quotation.sourceSupplierId],
    references: [supplier.id],
  }),
  lines: many(quotationLine),
  negotiations: many(negotiation),
  recommendedNegotiation: one(negotiation, {
    fields: [quotation.recommendedNegotiationId],
    references: [negotiation.id],
  }),
}));

export const quotationLineRelations = relations(quotationLine, ({ one }) => ({
  quotation: one(quotation, {
    fields: [quotationLine.quotationId],
    references: [quotation.id],
  }),
  matchedProduct: one(product, {
    fields: [quotationLine.matchedSku],
    references: [product.sku],
  }),
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

export const negotiationMessageRelations = relations(
  negotiationMessage,
  ({ one }) => ({
    negotiation: one(negotiation, {
      fields: [negotiationMessage.negotiationId],
      references: [negotiation.id],
    }),
  }),
);

export const purchaseOrderRelations = relations(
  purchaseOrder,
  ({ one, many }) => ({
    quotation: one(quotation, {
      fields: [purchaseOrder.quotationId],
      references: [quotation.id],
    }),
    negotiation: one(negotiation, {
      fields: [purchaseOrder.negotiationId],
      references: [negotiation.id],
    }),
    supplier: one(supplier, {
      fields: [purchaseOrder.supplierId],
      references: [supplier.id],
    }),
    lines: many(purchaseOrderLine),
  }),
);

export const purchaseOrderLineRelations = relations(
  purchaseOrderLine,
  ({ one }) => ({
    po: one(purchaseOrder, {
      fields: [purchaseOrderLine.poId],
      references: [purchaseOrder.id],
    }),
    product: one(product, {
      fields: [purchaseOrderLine.productSku],
      references: [product.sku],
    }),
    quotationLine: one(quotationLine, {
      fields: [purchaseOrderLine.quotationLineId],
      references: [quotationLine.id],
    }),
  }),
);

// -------- Claude Agent SDK session storage ---------------------------------

/**
 * Claude Agent SDK SessionStore adapter — receives a mirror of every
 * transcript line emitted by `query()` runs so that sessions can be
 * resumed across worker hosts (Inngest cross-host execution).
 *
 * The SDK passes opaque JSON entries; `uuid` is the idempotency key for
 * de-duplicating retries / replays. Entries without `uuid` (titles, tags,
 * mode markers) are stored as-appended.
 *
 * See `apps/api/src/infra/agent-sdk/session-store.pg.ts` for the
 * implementation that consumes this table.
 */
export const claudeSessionEntry = pgTable(
  'claude_session_entry',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    projectKey: text('project_key').notNull(),
    sessionId: text('session_id').notNull(),
    subpath: text('subpath'),
    entryUuid: text('entry_uuid'),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    sessionOrderIdx: index('claude_session_entry_session_order_idx').on(
      table.projectKey,
      table.sessionId,
      table.subpath,
      table.id,
    ),
    uuidDedupIdx: uniqueIndex('claude_session_entry_uuid_dedup_idx')
      .on(table.projectKey, table.sessionId, table.subpath, table.entryUuid)
      .where(sql`entry_uuid IS NOT NULL`),
  }),
);
