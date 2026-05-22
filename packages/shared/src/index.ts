/**
 * Cross-cutting Zod schemas shared between the API (Hono) and the Web (React) workspaces.
 *
 * Source of truth lives here so request/response payloads, Inngest event data, and
 * Drizzle insert types can all be validated against a single declaration.
 *
 * The shape and naming of these schemas is intentionally domain-flavored — see
 * docs/ONTOLOGY.md for the conceptual model.
 */

export * from './quotation';
export * from './negotiation';
export * from './purchase-order';
export * from './events';
