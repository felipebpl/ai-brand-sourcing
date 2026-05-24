import { and, asc, desc, eq, isNotNull, isNull, max } from 'drizzle-orm';
import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
} from '@anthropic-ai/claude-agent-sdk';
import type { DB } from '../../db';
import { claudeSessionEntry } from '../../db/schema';

/**
 * Postgres-backed SessionStore for the Claude Agent SDK.
 *
 * Why: Inngest workers may execute on different hosts between steps.
 * The SDK's default JSONL filesystem store ties a session to one
 * machine, which breaks `resume`. This adapter routes session entries
 * to Postgres so any worker can pick up the same session.
 *
 * Deduplication: entries that carry a `uuid` are upserted via a
 * partial unique index on (project_key, session_id, subpath, entry_uuid).
 * Retries and `importSessionToStore()` replays do not create duplicate
 * rows. Entries without `uuid` (titles, tags, mode markers) are
 * appended without dedup, per the SDK contract.
 *
 * Methods marked `?` in the SessionStore type are all implemented:
 * `listSessions`, `delete`, `listSubkeys`. The optional
 * `listSessionSummaries` is left undefined — the SDK falls back to
 * `listSessions()` + per-session `load()` which is adequate at our
 * volume.
 */
export class PgSessionStore implements SessionStore {
  constructor(private readonly db: DB) {}

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const rows = entries.map((entry) => ({
      projectKey: key.projectKey,
      sessionId: key.sessionId,
      subpath: key.subpath ?? null,
      entryUuid: typeof entry.uuid === 'string' ? entry.uuid : null,
      payload: entry as unknown,
    }));

    const withUuid = rows.filter((r) => r.entryUuid !== null);
    const withoutUuid = rows.filter((r) => r.entryUuid === null);

    if (withUuid.length > 0) {
      await this.db
        .insert(claudeSessionEntry)
        .values(withUuid)
        .onConflictDoNothing({
          target: [
            claudeSessionEntry.projectKey,
            claudeSessionEntry.sessionId,
            claudeSessionEntry.subpath,
            claudeSessionEntry.entryUuid,
          ],
        });
    }
    if (withoutUuid.length > 0) {
      await this.db.insert(claudeSessionEntry).values(withoutUuid);
    }
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const subpathCondition =
      key.subpath === undefined
        ? isNull(claudeSessionEntry.subpath)
        : eq(claudeSessionEntry.subpath, key.subpath);

    const rows = await this.db
      .select({ payload: claudeSessionEntry.payload })
      .from(claudeSessionEntry)
      .where(
        and(
          eq(claudeSessionEntry.projectKey, key.projectKey),
          eq(claudeSessionEntry.sessionId, key.sessionId),
          subpathCondition,
        ),
      )
      .orderBy(asc(claudeSessionEntry.id));

    if (rows.length === 0) return null;
    return rows.map((r) => r.payload as SessionStoreEntry);
  }

  async listSessions(
    projectKey: string,
  ): Promise<Array<{ sessionId: string; mtime: number }>> {
    const rows = await this.db
      .select({
        sessionId: claudeSessionEntry.sessionId,
        mtime: max(claudeSessionEntry.createdAt),
      })
      .from(claudeSessionEntry)
      .where(eq(claudeSessionEntry.projectKey, projectKey))
      .groupBy(claudeSessionEntry.sessionId)
      .orderBy(desc(max(claudeSessionEntry.createdAt)));

    return rows
      .filter((r): r is { sessionId: string; mtime: Date } => r.mtime !== null)
      .map((r) => ({ sessionId: r.sessionId, mtime: r.mtime.getTime() }));
  }

  async delete(key: SessionKey): Promise<void> {
    const subpathCondition =
      key.subpath === undefined
        ? isNull(claudeSessionEntry.subpath)
        : eq(claudeSessionEntry.subpath, key.subpath);

    await this.db
      .delete(claudeSessionEntry)
      .where(
        and(
          eq(claudeSessionEntry.projectKey, key.projectKey),
          eq(claudeSessionEntry.sessionId, key.sessionId),
          subpathCondition,
        ),
      );
  }

  async listSubkeys(key: {
    projectKey: string;
    sessionId: string;
  }): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ subpath: claudeSessionEntry.subpath })
      .from(claudeSessionEntry)
      .where(
        and(
          eq(claudeSessionEntry.projectKey, key.projectKey),
          eq(claudeSessionEntry.sessionId, key.sessionId),
          isNotNull(claudeSessionEntry.subpath),
        ),
      );
    return rows
      .map((r) => r.subpath)
      .filter((s): s is string => s !== null);
  }
}
