import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { DB } from '../../../db';
import { makeLookupCatalogTool } from './lookup-catalog';
import {
  makeSubmitExtractionTool,
  type SubmitExtractionSink,
} from './submit-extraction';

/**
 * In-process MCP server exposing the parser subagent's domain tools:
 *   - `mcp__parser__lookup_catalog`
 *   - `mcp__parser__submit_extraction`
 *
 * `createSdkMcpServer` runs entirely in this Node/Bun process — no
 * subprocess, no socket. The Agent SDK plumbs requests directly to the
 * tool handlers.
 *
 * `alwaysLoad: true` keeps both tools in the parser's prompt regardless
 * of the dynamic tool-search heuristic. We want the agent to see both
 * tools immediately.
 */
export function makeParserMcpServer(args: {
  db: DB;
  submitSink: SubmitExtractionSink;
}) {
  return createSdkMcpServer({
    name: 'parser',
    version: '0.1.0',
    instructions:
      'Tools for parsing supplier quotation files. Use lookup_catalog ' +
      'whenever a raw SKU does not verbatim match the catalog. Call ' +
      'submit_extraction exactly once at the end of the run.',
    tools: [
      makeLookupCatalogTool(args.db),
      makeSubmitExtractionTool(args.submitSink),
    ],
    alwaysLoad: true,
  });
}
