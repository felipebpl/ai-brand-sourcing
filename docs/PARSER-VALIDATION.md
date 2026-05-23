# Parser Validation Report

End-to-end runs of the live parser subagent against the four bundled
sample quotations (`assets/quotation_{1..4}.xlsx`). Each run was the
`bun agent:smoke parse <file>` command — the full agent-first path
(model: `claude-sonnet-4-6`, `bypassPermissions`, `cwd` scoped, in-process
MCP tools, hook-driven termination on `submit_extraction`).

Conducted 2026-05-23 after Step 3 implementation.

## Comparative results

| Metric | q1 (Thai Textiles) | q2 (Sheet1 FOB) | q3 (Prestige multi-sheet) | q4 (Chinese, swap trap) |
|---|---|---|---|---|
| Sheet shape | 9 cols, 23 merged ranges | 5 cols, 0 merges | 6 cols × 2 sheets | 5 cols, 1 merge |
| Layout pattern | Tier pricing as **duplicated rows** | Tier pricing as **separate columns** | **Multi-sheet** scenarios + discount column | **Chinese labels with swapped columns** |
| **Lines extracted** | 40 | 48 | 46 (Quote 1 + Quote 2 merged) | 23 |
| **supplierName** | "Thai Textiles" | null | "Prestige Manufacturing Co., Ltd." | "Prestige Manufacturing" |
| **issuedAt** | "2026-01-01" | null | "2026-02-05" | "2026-02-05" |
| **currency** | USD | USD | USD | USD |
| **language** | en | en | en | **zh** |
| **leadTimeDays** | null (absent in file) | **90** (from footer) | **60** | **60** |
| **paymentTerms** | null (absent) | "30/70" (from footer) | "40/60" | null (footer absent in q4) |
| **Ambiguities** | 1 | 3 | 1 | 2 |
| Bash calls | 6 | 6 | 7 | 6 |
| `lookup_catalog` calls | 0 | 32 | 15 | 0 |
| Duration | 143s | 231s | 322s | 126s |
| Submit retries | 3 (string-JSON → object) | 5 | 4 | 3 |

## What the parser caught — qualitative

### q1 — Thai Textiles (tier pricing in rows, merged headers, column A empty)

Honest reporting of absence: file has no `leadTime` and no `paymentTerms`, so
both came back `null` rather than being invented. `issuedAt` ("2026-01-01")
extracted from a labeled metadata row.

**Ambiguity raised:**
> "PHS001-OBS-L (size L) is priced higher than PHS001-OBS-XL (size XL) at
> both tiers ($10.49 vs $7.92 @ qty 500; $9.50 vs $7.00 @ qty 5000).
> Unusual since larger sizes typically cost more. Verify whether the L/XL
> price differential is intentional or a data entry error."

This is domain-aware sanity reasoning, not a schema check. The parser
noticed L > XL pricing — a soft signal a human would catch — and surfaced
it instead of swallowing it.

### q2 — FOB tier-by-columns (typos: MBOO2, 0PP027, EKA03, OJ3008…)

Tier-as-columns correctly unified: each SKU produced two `quotation_line`
entries with `minQty=1000` and `minQty=5000`, distinguished by
`sourceRef.col` so the brand agent can reason about which tier each line
came from.

Footer metadata extracted (`Lead Time | 90 days`, `Payment | 30/70`).

**Ambiguities raised (3):**
- Typo'd SKUs that fuzzy-matched but with conflicting candidates
  (e.g. PHS8 ↔ PHS002/PHS008 tie at 0.57 similarity — left flagged
  rather than guessed)
- `PWW106-OBS-L` no strong match (best at 0.625), flagged

The agent **did** fix some typos confidently when description and color
clearly resolved it (e.g. `MBOO2-LGR-S → MB002-LGR-S`, "Alpine Guide 30"
matches catalog name). The split between confident fixes and flagged
ambiguities is the rubric working as designed.

### q3 — Prestige Manufacturing multi-sheet (Quote 1 + Quote 2 scenarios)

**Both sheets merged into a single extraction** with `sourceRef.sheet`
tagged per line, as the spec asks. Discount column handled (line
unitPrice = `FOB × (1 − discount%)`); discount % carried in `rawExtras`.

Metadata extracted from labeled header rows: factory name, currency,
payment terms (40/60), lead time (60 days).

**Ambiguity raised (1):**
> "Raw SKU 'AQ009-0BS-XS': prefix 'AQ' not found in catalog; zero→O
> correction to 'AQ009-OBS-XS' still yields no catalog match; nearest
> candidates are AT009-OBS-XS and AK009-OBS-XS (both similarity=0.625),
> insufficient to confirm — requires manual review."

Multi-step reasoning: tried the obvious zero→O fix, still no match, fell
back on fuzzy candidates, decided they were too weak. Did not guess.

### q4 — Chinese labels with swapped-columns trap (the hardest case)

**The killer result.** Headers in Chinese (工厂名称, 报价日期, 单价, 数量),
and the data positions are **opposite** what the labels say. The
agent detected this without being told:

> "Chinese header labels col C as 单价 (unit price) and col D as 数量
> (quantity), but magnitude analysis clearly shows col C holds quantities
> (100–6000) and col D holds unit prices ($6.25–$115). Columns are
> swapped vs. header labels. Extracted with C=minQty, D=unitPrice; grand
> total validates at $747,283."

This is exactly what the skill's "Trust magnitudes over labels" rule was
designed to catch. The validation oracle (`Σ price×qty ≈ printed total`)
confirmed the correction was right. `language: "zh"` correctly tagged.

Second ambiguity is a soft signal: "$6.25 for an insulated pant is
suspicious; total cross-check passes; verify with supplier." Soft signal,
not a correction.

## Patterns the parser handled correctly

All four cases shared these correct behaviors:

1. **Honest absence.** Missing fields come back as `null`, never invented.
2. **Tier pricing unified.** Whether the file expressed tiers as
   duplicated rows (q1) or as multiple price columns (q2), both produced
   one `quotation_line` per (sku, tier).
3. **Multi-sheet merged with provenance.** q3 produced one extraction
   with `sourceRef.sheet` tracking the origin of each line.
4. **SKU resolution rubric.** All three matchMethods (`agent_exact`,
   `agent_fuzzy_inferred`, `agent_uncertain`) were exercised across the
   four files; no confident-wrong matches observed.
5. **Magnitude over labels.** q4 caught the swapped columns — the
   highest-stakes correctness signal in the whole skill.
6. **Validation oracle reconciliation.** q4 explicitly cited the grand
   total cross-check.

## Patterns where the agent was wasteful (but not wrong)

These are inefficiencies, not errors. They cost time and tokens; they did
not corrupt output.

1. **Submit retries (3–5 per run).** The agent tends to serialize the
   `extraction` payload as a JSON string before passing it to the tool,
   instead of as an object. The tool already accepts both (it
   `JSON.parse`s strings transparently), so output is correct, but each
   retry costs ~$0.02 of useless tokens. This is an Anthropic SDK
   tool-input quirk for very large JSON; not skill-fixable.
2. **`lookup_catalog` calls (15 in q3).** The agent sometimes verified
   SKUs that were already verbatim catalog entries — the skill says "skip
   the lookup when the SKU looks clean", but Sonnet is conservative.
   Not a correctness issue; ~$0.01 per excess call.
3. **Latency variance (126s–322s).** q4 was the fastest because all
   SKUs were exact and the file is small. q3 was slowest due to
   multi-sheet inspection + 15 lookups. Within budget envelope but
   makes UX (a user staring at a spinner) less great.

## Cost envelope

| | Min | p50 | Max |
|---|---|---|---|
| Per-parse cost | ~$0.04 | ~$0.08 | ~$0.15 |
| Per-parse latency | ~125s | ~190s | ~325s |

All four runs ran inside the `maxBudgetUsd: 0.5` ceiling. No run hit
`maxTurns: 25`. Hook-based termination on `submit_extraction` worked.

## Conclusion

**No changes needed to the parser, skill, or tools to ship Step 3.** The
four real-world variabilities the challenge files exercise — merged
cells, multi-sheet, tier pricing in rows AND columns, foreign-language
metadata with inverted column order, typo'd SKUs — were all handled
correctly. The agent reasoned through the swapped-column trap (q4) and
the size-vs-price oddity (q1) using domain heuristics, not pattern
matching.

Future optimization opportunities (not blockers):

- **Reduce submit retries** by passing the input schema as a Zod object
  shape rather than `z.unknown()`. Trade-off: less flexibility for
  payloads that change shape across versions. Defer.
- **Cache lookup_catalog within a run** so the agent doesn't re-query
  the same canonical SKU twice. Defer until we see it cost real money
  at scale.
- **UX hint at upload time** that parsing takes 2–5 minutes; surface
  the streaming events so the user sees the agent thinking rather
  than a black box.

This validation is documented as ADR-014 in `docs/DECISIONS.md`.
