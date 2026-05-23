import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../lib/env';
import * as schema from './schema';

export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });

const verbose =
  env.NODE_ENV === 'development' && process.env.DB_LOG !== 'silent';

export const db = drizzle(pool, { schema, logger: verbose });
export type DB = typeof db;
export { schema };
