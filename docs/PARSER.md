# Parser

The parser is a **Claude subagent** with the `quotation-parser` skill
loaded. It receives a supplier XLSX, runs Python via Bash to read and
analyze it, resolves SKUs against the catalog, and submits a typed
`QuotationExtraction`.

This is intentionally NOT a deterministic pipeline. The strength of the
design is that Claude can reason about an unfamiliar layout the way a
human analyst would: open the file, look around, try something, refine.

## Components

```
src/infra/agent-sdk/
├── adapters/parser.claude.ts          ParserPort impl
├── tools/lookup-catalog.ts            mcp__parser__lookup_catalog
├── tools/persist-extraction.ts        mcp__parser__submit_extraction
└── skills/quotation-parser/
    ├── SKILL.md                       skill manifest + behavior
    ├── domain-context.md              brand profile (Valden)
    └── known-patterns.md              the 4 sample variabilities + rules of thumb
```

## How it runs

1. **Entrypoint:** `ClaudeParserAdapter.parse({ quotationId, storageUri,
   uploadedFilename, userInstruction })`.
2. **Spawns** a Claude Agent SDK `query()` with:
   - `model: claude-sonnet-4-6`
   - `cwd: <workspace>` scoped to the file's directory
   - `settingSources: []` — no host config bleed
   - `skills: ['quotation-parser']` — domain context loaded
   - `allowedTools: ['Read', 'Bash', 'Write', 'mcp__parser__*']`
   - `permissionMode: 'dontAsk'`
   - In-process MCP server providing `lookup_catalog` and
     `submit_extraction` tools
3. **Initial prompt:** "Parse the file at `<path>`. The user's
   instruction is: `<instruction>`. Call `submit_extraction` when done."
4. The agent runs Python via Bash to inspect (`openpyxl.load_workbook`,
   `df.head()`, etc.), iterates as needed, looks up SKUs via the tool,
   and finally calls `submit_extraction(payload)`.
5. The terminal tool persists `quotation_line` rows + updates
   `quotation.parsed_metadata` and `status='parsed'`. Returns
   `QuotationExtraction` to the orchestrator.

## Tools (in-process MCP)

### `mcp__parser__lookup_catalog(query, limit)`

Returns top-K candidate SKUs by trigram similarity:

```sql
SELECT sku, name, color,
       similarity(sku, $1) AS sim
FROM   product
WHERE  similarity(sku, $1) > 0.3
ORDER  BY sim DESC
LIMIT  $2;
```

Pure SQL. Sub-10ms for the 10k-row catalog. No embeddings, no external
API.

### `mcp__parser__submit_extraction(payload)`

Terminal tool — called exactly once by the agent. Persists `quotation_line`
rows and metadata. Schema validated via Zod (`QuotationExtractionSchema`
in `packages/shared`).

## Domain knowledge in the skill

`SKILL.md` instructs:
- Run Python first to inspect structure.
- Plausibility validate (apparel unit prices typically $5–$200).
- Don't trust column labels alone (Chinese sample has labels right but
  data swapped).
- Use `lookup_catalog` for any non-exact SKU.
- Don't invent SKUs — leave `matched_sku` null + flag in `ambiguities`
  if uncertain.
- Reconcile totalizer rows when present.
- Call `submit_extraction` exactly once at the end.

`domain-context.md` defines the brand (Valden = premium outdoor
technical apparel, ~10k SKUs, pattern `<FAMILY>-<COLOR>-<SIZE>`).

`known-patterns.md` describes the 4 sample variabilities:
1. Header-heavy layout + tier as duplicated rows (quotation_1).
2. Tier as separate columns + footer metadata (quotation_2).
3. Labeled metadata at top + discounts + multi-sheet scenarios
   (quotation_3).
4. Chinese labels + swapped column order (quotation_4).

## SKU matching strategy

Agent-first. Per `ADR-009`:
- **agent_exact**: raw SKU verbatim in catalog → 1.0 confidence.
- **agent_fuzzy_inferred**: top hits from `lookup_catalog` + description
  context make the right pick obvious → confidence reported by agent
  along with one-line reasoning.
- **agent_uncertain**: not enough signal → `matched_sku = null`, line
  added to `ambiguities[]`.

A wrong match is worse than a missing match. The brand user reviews
ambiguities in the UI before negotiation kicks off (if there are any).

## Hard caps

```typescript
const PARSER_LIMITS = {
  maxTurns: 20,
  maxBudgetUsd: 0.20,
  timeout: 60_000,  // ms wall-clock
};
```

Exceeding any cap = mark quotation `failed` with reason, surface in UI.

## What "magnífico" looks like in this implementation

- Handles a XLSX the developer has never seen, with whatever layout
  oddities, in seconds.
- Each line has an auditable confidence + reasoning trail.
- Cost stays low (~$0.01–$0.03 per typical file) due to prompt caching
  of the skill + system prompt + catalog hints.
- Extends to PDF/DOCX/CSV later via additional skills, no pipeline
  rewrite.
- Failure modes (locked file, bad encoding, malformed XML) are caught
  by the agent and reported clearly, not silent crashes.

## Observability targets

- `parser.duration_ms` histogram by language detected
- `parser.cost_usd` histogram
- `parser.match_method` counter (`agent_exact` vs `agent_fuzzy_inferred`
  vs `agent_uncertain`)
- `parser.ambiguity_flagged` counter

Wired via SDK hooks (`PreToolUse`, `PostToolUse`, `Stop`) — see
`src/infra/agent-sdk/hooks/`.
