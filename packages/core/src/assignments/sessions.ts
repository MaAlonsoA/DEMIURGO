// Provider sessions per conversation (FDR-AGE-002): the key joins the thread (the run's scope), the
// agent@version, the provider and the model, so any change of those starts a new conversation. Each
// conversation has a stable folder, because the CLIs resume a session from where it ran.

import { join } from 'node:path';
import { canonicalJson, fingerprint } from '@demiurgo/domain';
import type { Db, Tx } from '../db/connection.ts';

export function sessionKey(p: { scope: unknown; agent: string; version: string; provider: string; model: string }): string {
  return `${canonicalJson(p.scope)}|${p.agent}@${p.version}|${p.provider}|${p.model}`;
}

export function sessionDirectory(base: string, provider: string, key: string): string {
  return join(base, provider, fingerprint(key).slice(0, 16));
}

export async function previousSession(
  db: Db | Tx,
  key: string,
): Promise<{ providerSessionId: string; lastRunId: string } | null> {
  const row = await db
    .selectFrom('agent_sessions')
    .select(['provider_session_id', 'last_run_id'])
    .where('key', '=', key)
    .executeTakeFirst();
  return row ? { providerSessionId: row.provider_session_id, lastRunId: row.last_run_id } : null;
}

/** The session this run left alive becomes the conversation's current one. */
export async function saveSession(
  trx: Tx,
  p: { key: string; projectId: string; provider: string; providerSessionId: string; runId: string },
): Promise<void> {
  await trx
    .insertInto('agent_sessions')
    .values({
      key: p.key,
      project_id: p.projectId,
      provider: p.provider,
      provider_session_id: p.providerSessionId,
      last_run_id: p.runId,
    })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({ provider_session_id: p.providerSessionId, last_run_id: p.runId, updated_at: new Date() }),
    )
    .execute();
}
