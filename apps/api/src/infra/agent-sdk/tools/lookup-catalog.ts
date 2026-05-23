/**
 * `mcp__parser__lookup_catalog` tool.
 *
 * Called by the parser agent when it needs to resolve a raw SKU (possibly
 * with typos) against the brand's product catalog (~10k SKUs). Returns
 * the top-K candidates by trigram similarity. The agent then chooses the
 * best match using contextual reasoning (description, color, etc.) and
 * persists `match_method = agent_fuzzy_inferred` with a one-line reasoning.
 *
 * Implementation: pure Drizzle query against the `product` table using
 * the `pg_trgm` extension's `similarity()` function. No embeddings,
 * no external API.
 *
 *   SELECT sku, name, color,
 *          similarity(sku, $1) AS sim
 *   FROM   product
 *   WHERE  similarity(sku, $1) > 0.3
 *   ORDER  BY sim DESC
 *   LIMIT  $2;
 *
 * TBD — implementation lands once we're past scaffolding.
 */
export const lookupCatalogStub = 'TODO';
