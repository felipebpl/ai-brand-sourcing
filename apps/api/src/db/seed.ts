import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from './index';
import { product, quotation, supplier } from './schema';

/**
 * Idempotent seed for local development.
 *
 *   bun db:seed
 *
 * - Ensures pg_trgm extension is present.
 * - Creates GIN trigram indexes on `product.sku` and `product.name` for
 *   fast fuzzy lookup (used by the parser agent's `lookup_catalog` tool).
 * - Loads ~10k SKUs from `assets/products.csv`.
 * - Inserts the 3 supplier personas (S1 source partner + S2 premium +
 *   S3 mid-range/speed) — all renegotiable.
 *
 * Re-running the script is safe: products use ON CONFLICT DO NOTHING,
 * suppliers use the same.
 */

const CSV_PATH = resolve(import.meta.dir, '../../../../assets/products.csv');
const PRODUCT_BATCH_SIZE = 500;

async function ensureExtensions(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  console.log('  ✓ pg_trgm extension present');
}

async function ensureTrigramIndexes(): Promise<void> {
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS product_sku_trgm_idx ON product USING gin (sku gin_trgm_ops)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS product_name_trgm_idx ON product USING gin (name gin_trgm_ops)`,
  );
  console.log('  ✓ trigram indexes present');
}

interface ProductRow {
  sku: string;
  brandId: string;
  name: string;
  color: string | null;
}

function parseProductCsv(text: string): ProductRow[] {
  const lines = text.split('\n');
  const rows: ProductRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    const cols = line.split(',').map((c) => c.replace(/\r$/, '').trim());
    if (cols.length < 4) continue;
    const [brand, sku, name, ...colorParts] = cols;
    if (!sku || !brand) continue;
    const color = colorParts.join(',').trim() || null;
    const resolvedName = name && name.length > 0 ? name : color ?? sku;
    rows.push({
      sku,
      brandId: brand,
      name: resolvedName,
      color,
    });
  }
  return rows;
}

async function seedProducts(): Promise<number> {
  const file = Bun.file(CSV_PATH);
  if (!(await file.exists())) {
    throw new Error(`Missing products.csv at ${CSV_PATH}`);
  }
  const text = await file.text();
  const rows = parseProductCsv(text);
  console.log(`  → ${rows.length} rows in products.csv`);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += PRODUCT_BATCH_SIZE) {
    const batch = rows.slice(i, i + PRODUCT_BATCH_SIZE);
    const result = await db
      .insert(product)
      .values(batch)
      .onConflictDoNothing()
      .returning({ sku: product.sku });
    inserted += result.length;
    if (i % (PRODUCT_BATCH_SIZE * 4) === 0) {
      console.log(
        `    seeded ${Math.min(i + PRODUCT_BATCH_SIZE, rows.length)} / ${rows.length}`,
      );
    }
  }
  return inserted;
}

const SUPPLIER_SEED = [
  {
    id: 'supplier-1',
    name: 'Source Supplier',
    qualityScore: '4.00',
    defaultLeadTimeDays: 50,
    defaultPaymentTerms: {
      installments: [
        { percent: 33, dueDays: 0 },
        { percent: 33, dueDays: 30 },
        { percent: 34, dueDays: 60 },
      ],
      display: '33/33/33',
    },
    pricingProfile: 'cheap',
    persona: [
      'You are the brand\'s long-standing mid-tier manufacturing partner.',
      'You are the source of the original quotation the brand uploaded.',
      'Your pricing is the lowest baseline available; your lead time is long (50 days);',
      'you require staged payments (33% deposit / 33% mid-production / 34% on delivery).',
      'Quality is medium (rating 4.0 / 5).',
      'You compete on cost. When the brand cites competing offers you can drop 5–10%',
      'on unit price for the same volume, or shorten lead time modestly if a higher',
      'deposit is accepted. You do not lower payment-terms friction easily — your cash',
      'flow needs the staged structure. You are realistic, not romantic: you walk away',
      'when margin drops below sustainable. You answer in plain English, in 1–3',
      'sentences per turn, and you back claims with reasons.',
    ].join(' '),
  },
  {
    id: 'supplier-2',
    name: 'Apex Manufacturing',
    qualityScore: '4.70',
    defaultLeadTimeDays: 25,
    defaultPaymentTerms: {
      installments: [
        { percent: 40, dueDays: 0 },
        { percent: 60, dueDays: 25 },
      ],
      display: '40/60',
    },
    pricingProfile: 'premium',
    persona: [
      'You are Apex Manufacturing, a premium production house known for quality and',
      'on-time delivery (rating 4.7 / 5). Your prices run 15–25% above market.',
      'Your lead time is fast (25 days). Your payment terms are 40% deposit, 60% on',
      'completion. When pressured on price you defend by reminding the brand of your',
      'quality differential and consistency; you can concede ~5% but rarely more,',
      'and you can offer additional value through guaranteed QC, on-time penalties,',
      'or volume discounts if the brand commits to larger orders or a multi-season',
      'agreement. You are confident, professional, patient. You do not chase deals',
      'that erode your margin. You speak in 1–3 sentences per turn, with substance.',
    ].join(' '),
  },
  {
    id: 'supplier-3',
    name: 'Velocity Fabriks',
    qualityScore: '4.00',
    defaultLeadTimeDays: 15,
    defaultPaymentTerms: {
      installments: [{ percent: 100, dueDays: 0 }],
      display: '100% upfront',
    },
    pricingProfile: 'mid',
    persona: [
      'You are Velocity Fabriks, a mid-quality producer (rating 4.0 / 5) with the',
      'fastest turnaround in the market (15 days). Your pricing is mid-range.',
      'Your payment requirement is firm: 100% upfront, no exceptions — your speed',
      'depends on locked materials and committed labor capacity. If pressured on',
      'payment terms you can offer modest unit-price discounts (3–7%) in exchange',
      'for keeping 100% upfront, but you cannot break the upfront rule. You can',
      'drop unit price 5–10% for larger volumes. You are transactional, direct,',
      'fast — you do not waste time on long negotiations. You answer in 1–3',
      'sentences per turn.',
    ].join(' '),
  },
];

async function seedSuppliers(): Promise<number> {
  const result = await db
    .insert(supplier)
    .values(SUPPLIER_SEED)
    .onConflictDoNothing()
    .returning({ id: supplier.id });
  return result.length;
}

async function main(): Promise<void> {
  console.log('Seeding database…');
  await ensureExtensions();
  await ensureTrigramIndexes();

  console.log('Products:');
  const productsInserted = await seedProducts();
  console.log(`  ✓ inserted ${productsInserted} new products`);

  console.log('Suppliers:');
  const suppliersInserted = await seedSuppliers();
  console.log(`  ✓ inserted ${suppliersInserted} new suppliers`);

  console.log('Starter RFQ:');
  const starterRfqs = await seedStarterRfq();
  console.log(`  ✓ ensured ${starterRfqs} awaiting-quote RFQ ready for the demo`);

  console.log('Done.');
}

async function seedStarterRfq(): Promise<number> {
  const existing = await db
    .select({ id: quotation.id })
    .from(quotation)
    .where(sql`${quotation.status} = 'awaiting_quote'`)
    .limit(1);
  if (existing.length > 0) return 0;
  const inserted = await db
    .insert(quotation)
    .values({
      brandId: 'valden',
      sourceSupplierId: 'supplier-1',
      uploadedFilename: null,
      storageUri: null,
      status: 'awaiting_quote',
    })
    .returning({ id: quotation.id });
  return inserted.length;
}

await main();
process.exit(0);
