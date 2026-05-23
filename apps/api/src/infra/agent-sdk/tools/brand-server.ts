import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { DB } from '../../../db';
import { makeAskSuppliersTool, type AskSuppliersConfig } from './ask-suppliers';
import {
  makeSubmitRecommendationTool,
  type SubmitRecommendationSink,
} from './submit-recommendation';
import { makeWalkAwayTool } from './walk-away';

/**
 * In-process MCP server exposing the brand agent's domain tools:
 *   - mcp__brand__ask_suppliers
 *   - mcp__brand__walk_away_from
 *   - mcp__brand__submit_recommendation
 *
 * All three live in this process, no subprocess. Tool handlers close
 * over the database connection, the supplier adapter map, and the
 * recommendation sink — set up per-run by the pipeline.
 */
export function makeBrandMcpServer(args: {
  db: DB;
  suppliers: AskSuppliersConfig['suppliers'];
  negotiationIdBySupplier: ReadonlyMap<string, string>;
  recommendationSink: SubmitRecommendationSink;
}) {
  return createSdkMcpServer({
    name: 'brand',
    version: '0.1.0',
    instructions:
      'Tools for brand-side negotiation orchestration. Use ask_suppliers ' +
      'to engage suppliers per round (returns their responses for your ' +
      'reasoning). Use walk_away_from to close a stalled negotiation. ' +
      'Use submit_recommendation exactly once at the end.',
    tools: [
      makeAskSuppliersTool({
        db: args.db,
        suppliers: args.suppliers,
      }),
      makeWalkAwayTool({
        db: args.db,
        negotiationIdBySupplier: args.negotiationIdBySupplier,
      }),
      makeSubmitRecommendationTool({
        sink: args.recommendationSink,
        validNegotiationIds: new Set(args.negotiationIdBySupplier.values()),
      }),
    ],
    alwaysLoad: true,
  });
}
