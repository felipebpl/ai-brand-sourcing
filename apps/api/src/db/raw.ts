import type { SQL } from 'drizzle-orm';
import type { DB } from './index';

/**
 * Typed wrapper around `db.execute<T>(sql\`...\`)` for raw SQL queries.
 *
 * `drizzle-orm/node-postgres` exposes the `pg` driver's QueryResult shape
 * (with a `.rows` property), but the type bridge does not surface that —
 * `db.execute` is typed loosely enough that every caller would otherwise
 * cast through `unknown` to reach `.rows`. This helper centralizes that
 * cast in exactly one place; downstream callers get a typed array back
 * and never write `as unknown as { rows: T[] }` themselves.
 *
 * Use the query builder where it fits. Reserve `rawRows` for queries that
 * the builder cannot express ergonomically (trigram similarity, aggregate
 * expressions that fall outside Drizzle's vocabulary).
 */
export async function rawRows<T extends Record<string, unknown>>(
  db: DB,
  query: SQL,
): Promise<T[]> {
  const result = await db.execute<T>(query);
  return (result as unknown as { rows: T[] }).rows;
}
