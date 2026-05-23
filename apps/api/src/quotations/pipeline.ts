import { eq, sql } from 'drizzle-orm';
import type { ParserPort } from '../domain';
import type { DB } from '../db';
import { quotation } from '../db/schema';
import { persistParseResult, type PersistResult } from './persist';

/**
 * Quotation parsing pipeline.
 *
 * Wraps the parser port with the database state machine:
 *
 *   uploaded → parsing → parsed       (happy path)
 *                     → failed        (parser crash, validation fail, …)
 *
 * Responsibilities:
 * - Pre-flight: load the quotation, verify it exists and is not already
 *   past `parsed` (so re-running idempotently re-extracts; running while
 *   the previous parse is in flight returns the in-flight status without
 *   double-billing the LLM).
 * - Mark `parsing` *before* invoking the parser so concurrent triggers
 *   (e.g. duplicate Inngest deliveries) see the in-flight state and
 *   short-circuit.
 * - Persist via {@link persistParseResult} — transactional, idempotent.
 * - On any error, transition to `failed` and record the error message in
 *   `parsed_metadata.failureReason` for human triage.
 *
 * Out of scope for this layer:
 * - Creating the quotation row (that happens at upload time in the
 *   `POST /quotations` route).
 * - Triggering the next step (negotiation kickoff) — that lives in the
 *   Inngest workflow.
 */

export type ParseAndPersistOutcome =
  | {
      kind: 'parsed';
      quotationId: string;
      persistResult: PersistResult;
      parseDurationMs: number;
    }
  | {
      kind: 'skipped';
      quotationId: string;
      reason: 'already_in_flight' | 'already_parsed_or_beyond';
      currentStatus: string;
    }
  | {
      kind: 'failed';
      quotationId: string;
      error: string;
    };

export async function parseAndPersist(args: {
  db: DB;
  parser: ParserPort;
  quotationId: string;
  storageUri: string;
  uploadedFilename: string;
  userInstruction: string | null;
  /** If true, allow re-parsing a quotation already in `parsed` status. */
  force?: boolean;
}): Promise<ParseAndPersistOutcome> {
  const { db, parser, quotationId, force = false } = args;

  // ---------- pre-flight -----------------------------------------------

  const existing = await db
    .select({ id: quotation.id, status: quotation.status })
    .from(quotation)
    .where(eq(quotation.id, quotationId))
    .limit(1);

  const row = existing[0];
  if (!row) {
    return {
      kind: 'failed',
      quotationId,
      error: `Quotation ${quotationId} not found`,
    };
  }

  if (row.status === 'parsing') {
    return {
      kind: 'skipped',
      quotationId,
      reason: 'already_in_flight',
      currentStatus: row.status,
    };
  }

  if (
    !force &&
    (row.status === 'parsed' ||
      row.status === 'negotiating' ||
      row.status === 'recommended' ||
      row.status === 'committed')
  ) {
    return {
      kind: 'skipped',
      quotationId,
      reason: 'already_parsed_or_beyond',
      currentStatus: row.status,
    };
  }

  // ---------- mark parsing --------------------------------------------

  await db
    .update(quotation)
    .set({ status: 'parsing', updatedAt: sql`now()` })
    .where(eq(quotation.id, quotationId));

  // ---------- invoke parser + persist ---------------------------------

  const start = Date.now();
  let parseResult;
  try {
    parseResult = await parser.parse({
      quotationId,
      storageUri: args.storageUri,
      uploadedFilename: args.uploadedFilename,
      userInstruction: args.userInstruction,
    });
  } catch (err) {
    await markFailed(db, quotationId, err);
    return {
      kind: 'failed',
      quotationId,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let persistResult: PersistResult;
  try {
    persistResult = await persistParseResult({
      db,
      quotationId,
      extraction: parseResult.extraction,
    });
  } catch (err) {
    await markFailed(db, quotationId, err);
    return {
      kind: 'failed',
      quotationId,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    kind: 'parsed',
    quotationId,
    persistResult,
    parseDurationMs: Date.now() - start,
  };
}

async function markFailed(
  db: DB,
  quotationId: string,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  try {
    await db
      .update(quotation)
      .set({
        status: 'failed',
        parsedMetadata: {
          failureReason: message,
          failedAt: new Date().toISOString(),
        } as unknown,
        updatedAt: sql`now()`,
      })
      .where(eq(quotation.id, quotationId));
  } catch {
    /* best-effort — the outer return already surfaces the error */
  }
}
