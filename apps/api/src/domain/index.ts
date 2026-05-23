/**
 * Domain layer — pure business types and ports (interfaces).
 *
 * Nothing in this folder imports from `@anthropic-ai/claude-agent-sdk`,
 * Inngest, Drizzle, or any framework. Adapters in `src/infra/*` implement
 * these ports. The orchestrator in `src/app/*` (or in inngest functions)
 * uses only the ports, never the adapters directly.
 *
 * Swapping frameworks = swapping adapters. Domain stays intact.
 */

export * from './types';
export * from './ports/parser';
export * from './ports/brand-agent';
export * from './ports/supplier-agent';
export * from './ports/event-bus';
