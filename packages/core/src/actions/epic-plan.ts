// epic_plan action: a dedicated agent drafts the epic of a thread (goal, out of scope, done when,
// criteria for the whole walk and its ordered features) from the whole conversation. The thread's
// agent only converses and says the thread is ready to draft; this one writes, from a determined output.

import { DomainError } from '@demiurgo/domain';
import { sql } from 'kysely';
import { registerBuilder } from '../context/build.ts';
import type { Db } from '../db/connection.ts';
import { registerApplier, registerChecker } from './appliers.ts';
import { criterionPayload, relabelPack, sourcesPayload, threadBasis } from './drafting.ts';
import { explorationPack, threadRecord } from './exploration-chat.ts';

const BUILDER = 'epic_plan@1';

/** Why an epic can't be drafted in this thread, or null: it is about an epic already, or one from it is waiting or accepted. */
export async function epicProblem(db: Db, projectId: string, explorationId: string): Promise<string | null> {
  const about = await threadRecord(db, projectId, explorationId);
  if (about?.type === 'epic') return `This thread is about ${about.code}: the epic already exists, so it is not drafted again.`;
  const existing = await sql<{ id: string }>`
    select p.id
    from proposals p
    join proposal_batches b on b.id = p.batch_id
    join ai_runs r on r.id = b.run_id
    where p.project_id = ${projectId}::uuid and p.type = 'design_record' and p.payload->>'record_type' = 'epic'
      and p.state in ('pending', 'accepted') and r.action in ('epic_plan', 'exploration_chat')
      and r.scope->>'id' = ${explorationId}
    limit 1`.execute(db);
  return existing.rows.length > 0 ? 'An epic drafted from this thread is already proposed or accepted.' : null;
}

registerBuilder('epic_plan', async (a) => {
  if (a.scope.type !== 'exploration' || !a.scope.id) throw new DomainError('validation', 'An epic is drafted from a thread.');
  const problem = await epicProblem(a.trx, a.projectId, a.scope.id);
  if (problem) throw new DomainError('validation', problem);
  return relabelPack(await explorationPack(a), BUILDER);
});

registerChecker('epic_plan', async ({ db, run, output }) => {
  const notes: string[] = [];
  const problem = await epicProblem(db, run.project_id, (run.scope as { id: string }).id);
  if (problem) notes.push(problem);
  const names = output.epic.features.map((f) => f.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) notes.push('Two features of the epic have the same name: each one is a different capability.');
  return notes;
});

registerApplier('epic_plan', async ({ trx, execute, run, output }) => {
  const scope = run.scope as { id: string };
  const e = output.epic;
  const basis = await threadBasis(trx, scope.id);
  await execute({
    projectId: run.project_id,
    command: 'batch.submit',
    actor: { type: 'agent_run', run: run.id },
    data: {
      summary: `Epic drafted from the thread: ${e.title} (${e.features.length} features).`,
      batch_type: 'agent',
      resolution: 'item',
      run_id: run.id,
      context_pack_id: run.context_pack_id ?? undefined,
      proposals: [
        {
          type: 'design_record',
          payload: {
            record_type: 'epic',
            title: e.title,
            domain: e.domain,
            sections: [
              { title: 'Goal', content: e.goal },
              { title: 'Out of scope', content: e.out_of_scope },
              { title: 'Done when', content: e.done_when },
            ],
            criteria: e.criteria.map((c) => criterionPayload(c)),
            features: e.features,
            ...sourcesPayload(output.sources),
            ...(basis.length > 0 ? { basis } : {}),
          },
        },
      ],
    },
  });
});
