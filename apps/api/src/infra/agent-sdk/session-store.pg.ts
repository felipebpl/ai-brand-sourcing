/**
 * Postgres-backed SessionStore for Claude Agent SDK.
 *
 * Why: Inngest workers can run on different hosts between steps. The SDK's
 * default JSONL filesystem store ties a session to one machine, which
 * breaks `resume`. A custom store routes session entries to Postgres so
 * any worker can pick up the same session.
 *
 * Schema (added on db:push if needed):
 *   create table claude_session_entry (
 *     id          bigserial primary key,
 *     project_key text not null,
 *     session_id  text not null,
 *     subpath     text,
 *     payload     jsonb not null,
 *     created_at  timestamptz default now()
 *   );
 *   create index on claude_session_entry (session_id, id);
 *
 * Reference impls in
 * https://github.com/anthropics/claude-agent-sdk-typescript/tree/main/examples/session-stores
 *
 * TBD — implementation lands once we're past scaffolding.
 */
export const ClaudeSessionStorePgStub = 'TODO';
