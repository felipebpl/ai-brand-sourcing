import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { db } from '../db';

const HealthResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    uptimeSeconds: z.number(),
    checks: z.object({
      database: z.enum(['ok', 'fail']),
    }),
  })
  .openapi('Health');

const route = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Meta'],
  summary: 'Liveness + readiness probe',
  responses: {
    200: {
      description: 'Service is healthy',
      content: { 'application/json': { schema: HealthResponseSchema } },
    },
  },
});

export const healthRouter = new OpenAPIHono().openapi(route, async (c) => {
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return c.json({
    status: dbOk ? ('ok' as const) : ('degraded' as const),
    uptimeSeconds: Math.round(process.uptime()),
    checks: { database: dbOk ? ('ok' as const) : ('fail' as const) },
  });
});
