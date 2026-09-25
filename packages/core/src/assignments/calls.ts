// Every provider invocation leaves a trace (FDR-AGE-002): a row in agent_calls from start to end,
// and each event of its stream in agent_call_events, in order, as it arrives (a NOTIFY per event
// feeds the live progress). Agent runs and the knowledge classifier both call through here.

import type { AgentResult, Provider, ProviderEvent, ProviderInvocation } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';

export type CallMeta = {
  projectId: string | null;
  runId: string | null;
  agent: string;
  agentVersion: string;
  promptHash: string;
};

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

export async function callProvider(db: Db, provider: Provider, meta: CallMeta, inv: ProviderInvocation): Promise<AgentResult> {
  const { id } = await db
    .insertInto('agent_calls')
    .values({
      project_id: meta.projectId,
      run_id: meta.runId,
      agent: meta.agent,
      agent_version: meta.agentVersion,
      provider: provider.id,
      requested_model: inv.model,
      effort: inv.effort,
      session_mode: inv.session.mode,
      provider_session_id: inv.session.mode === 'resumed' ? inv.session.id : null,
      prompt_hash: meta.promptHash,
      state: 'running',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  // Events are written one after another, in arrival order, without blocking the provider.
  let seq = 0;
  let writing: Promise<void> = Promise.resolve();
  const onEvent = (e: ProviderEvent) => {
    seq++;
    const n = seq;
    writing = writing
      .then(async () => {
        await db
          .insertInto('agent_call_events')
          .values({
            project_id: meta.projectId,
            call_id: id,
            seq: n,
            kind: e.kind,
            tokens: e.tokens ?? null,
            raw: clip(e.raw, 200_000),
          })
          .execute();
      })
      .catch(() => undefined);
    inv.onEvent?.(e);
  };
  let result: AgentResult;
  try {
    result = await provider.run({ ...inv, onEvent });
  } catch (e) {
    result = {
      state: 'error',
      failureKind: 'infra',
      message: `The ${provider.label} adapter failed: ${e instanceof Error ? e.message : String(e)}`,
      rawEvents: '',
      provider: provider.id,
      model: inv.model,
    };
  }
  await writing;
  await db
    .updateTable('agent_calls')
    .set({
      state: result.state,
      failure_kind: result.state === 'error' ? result.failureKind : null,
      error: result.state === 'error' ? clip(result.message, 4000) : null,
      usage: result.usage ? JSON.stringify(result.usage) : null,
      observed_model: result.model,
      provider_session_id: result.sessionId ?? (inv.session.mode === 'resumed' ? inv.session.id : null),
      finished_at: new Date(),
    })
    .where('id', '=', id)
    .execute();
  return result;
}
