import { z } from 'zod';

/**
 * Parse and validate process.env once at boot. Crash fast if anything required is missing.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  INNGEST_EVENT_KEY: z.string().default('local'),
  INNGEST_SIGNING_KEY: z.string().default('local'),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
