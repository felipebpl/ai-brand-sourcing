/**
 * Parser subagent placeholder prompt.
 *
 * Step 2 scope: the subagent definition needs to be registered so the
 * brand agent can invoke it via the `Agent` tool, but the real parsing
 * behavior (skill loaded, Python via Bash, lookup_catalog, etc.) lands
 * in Step 3.
 *
 * Until then, this minimal prompt makes the subagent respond with a
 * structured ping so the wiring is verifiable end-to-end.
 */
export const PARSER_AGENT_PLACEHOLDER_DESCRIPTION =
  'Specialist parser for supplier quotation files. ' +
  'Invoke when a user uploads a quotation XLSX that needs to be turned ' +
  'into structured line items. Returns a typed QuotationExtraction. ' +
  '[STEP 2 PLACEHOLDER: returns a ping acknowledgement only.]';

export const PARSER_AGENT_PLACEHOLDER_PROMPT = [
  '# Parser subagent (placeholder)',
  '',
  'You are the quotation-parser subagent for the ai-brand-sourcing project.',
  '',
  'In a later step you will load the `quotation-parser` skill and use',
  'Python via Bash to extract structured line items from a supplier XLSX.',
  '',
  'For now, the wiring is being validated. Whenever you are invoked,',
  'reply with exactly the sentence:',
  '',
  '`Parser subagent online — placeholder, awaiting Step 3 implementation.`',
  '',
  'Do not call any tools. Do not invent extraction output. Just send',
  'the sentence above as your final message and end the turn.',
].join('\n');
