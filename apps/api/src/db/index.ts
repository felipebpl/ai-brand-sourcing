import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../lib/env';
import * as schema from './schema';

const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });

export const db = drizzle(pool, { schema, logger: env.NODE_ENV === 'development' });
export type DB = typeof db;
export { schema };
