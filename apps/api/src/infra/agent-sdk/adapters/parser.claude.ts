import type { ParserPort } from '../../../domain';

/**
 * Parser adapter using the Claude Agent SDK with the `quotation-parser`
 * skill loaded.
 *
 * Implementation strategy:
 *  - Spawn a subagent query() with `skills: ['quotation-parser']`,
 *    `allowedTools: ['Read', 'Bash', 'Write', 'mcp__parser__*']`,
 *    `cwd` scoped to the workspace, `settingSources: []`.
 *  - Subagent uses Python via Bash to read the XLSX (openpyxl/pandas),
 *    iterates as needed, calls `mcp__parser__lookup_catalog` to resolve
 *    SKUs, and finally calls `mcp__parser__submit_extraction` with the
 *    structured QuotationExtraction.
 *  - Hard caps: maxTurns 20, maxBudgetUsd 0.20, timeout 60s per file.
 *
 * TBD — implementation lands once we're past scaffolding.
 */
export class ClaudeParserAdapter implements ParserPort {
  async parse(): Promise<never> {
    throw new Error('ClaudeParserAdapter.parse not implemented yet');
  }
}
