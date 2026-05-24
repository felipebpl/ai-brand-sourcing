import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from 'inngest/hono';
import { db } from './db';
import {
  attachAgentEventPersister,
  makeDbAgentEventPersister,
} from './infra/agent-sdk/event-bus';
import { functions } from './inngest/functions';
import { inngest } from './inngest/client';
import { env } from './lib/env';
import { healthRouter } from './routes/health';
import { quotationsRouter } from './routes/quotations';
import { purchaseOrdersRouter } from './routes/purchase-orders';

// Persist every AgentEvent to the agent_event table so the Ask Amber
// execution trace survives reload, browser close, and API restart.
attachAgentEventPersister(makeDbAgentEventPersister(db));

const app = new OpenAPIHono();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  }),
);

app.route('/', healthRouter);
app.route('/', quotationsRouter);
app.route('/', purchaseOrdersRouter);

const inngestHandler = serve({ client: inngest, functions: [...functions] });
app.on(['GET', 'PUT', 'POST'], '/api/inngest', inngestHandler);

app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'ai-brand-sourcing API',
    version: '0.0.0',
    description:
      'API for parsing supplier quotations, running multi-agent negotiations, and converting outcomes into Purchase Orders.',
  },
  servers: [{ url: `http://localhost:${env.PORT}` }],
});

app.get('/docs', swaggerUI({ url: '/openapi.json' }));

app.get('/', (c) =>
  c.json({
    name: 'ai-brand-sourcing API',
    docs: '/docs',
    health: '/health',
    openapi: '/openapi.json',
    inngest: '/api/inngest',
  }),
);

export default {
  port: env.PORT,
  fetch: app.fetch,
};

export type AppType = typeof app;
