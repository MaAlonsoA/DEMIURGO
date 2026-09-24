// design_proposal action: from an approved decision, proposes an FDR with its ACs as a single
// coherent package that the person accepts in one step. The package depends on the decision's
// current version: if it changes, the package becomes obsolete.

import { DomainError } from '@demiurgo/domain';
import { registerBuilder } from '../context/build.ts';
import { knowledgeForContext } from '../context/knowledge.ts';
import { registerApplier } from './appliers.ts';

const BUDGET = { decision: 8_000, related: 4_000, knowledge: 4_000 };

registerBuilder('design_proposal', async ({ trx, projectId, scope, graphVersion }) => {
  const v = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select([
      'records.id as recordId',
      'records.code',
      'records.type',
      'records.domain',
      'record_versions.n',
      'record_versions.state',
      'record_versions.title',
      'record_versions.sections',
    ])
    .where('record_versions.id', '=', scope.id ?? '')
    .where('records.project_id', '=', projectId)
    .executeTakeFirst();
  if (!v) throw new DomainError('not_found', 'The decision version does not exist.');
  if (v.type !== 'decision' || v.state !== 'approved') {
    throw new DomainError('validation', 'A design can only be proposed from an approved decision.');
  }
  const sections = v.sections as { title: string; content: string }[];
  const text = (t: string) => sections.find((s) => s.title === t)?.content ?? '';
  const related = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.code', 'records.type', 'record_versions.n', 'record_versions.title'])
    .where('records.project_id', '=', projectId)
    .where('record_versions.state', '=', 'approved')
    .where('records.id', '<>', v.recordId)
    .orderBy('records.code')
    .limit(40)
    .execute();
  const knowledge = await knowledgeForContext(trx, projectId, `${v.title} ${text('Decision')}`, BUDGET.knowledge);
  return {
    role: 'design',
    constructor: 'design_proposal@1',
    budget: BUDGET,
    graph_version: graphVersion,
    dependencies: [{ type: 'record', id: v.recordId, version: v.n }, ...knowledge.dependencies],
    content: {
      decision: {
        code: v.code,
        version: v.n,
        domain: v.domain,
        title: v.title,
        context: text('Context').slice(0, 3000),
        decision: text('Decision').slice(0, 3000),
        consequences: text('Consequences').slice(0, 2000),
      },
      approved_records: related.map((r) => ({ code: r.code, type: r.type, version: r.n, title: r.title })),
      knowledge: knowledge.nodes,
    },
  };
});

registerApplier('design_proposal', async ({ trx, execute, run, output }) => {
  const pack = await trx
    .selectFrom('context_packs')
    .select(['content'])
    .where('id', '=', run.context_pack_id ?? '')
    .executeTakeFirstOrThrow();
  const d = (pack.content as { decision: { code: string; version: number; domain: string } }).decision;
  const record = await trx
    .selectFrom('records')
    .select('id')
    .where('project_id', '=', run.project_id)
    .where('code', '=', d.code)
    .executeTakeFirstOrThrow();
  const dependency = { type: 'record' as const, id: record.id, code: d.code, version: d.version };
  await execute({
    projectId: run.project_id,
    command: 'batch.submit',
    actor: { type: 'agent_run', run: run.id },
    data: {
      summary: `Design proposed from ${d.code} v${d.version}: FDR with ${output.fdr.criteria.length} criteria.`,
      batch_type: 'system_package',
      resolution: 'package',
      run_id: run.id,
      context_pack_id: run.context_pack_id ?? undefined,
      dependencies: [dependency],
      proposals: [{ type: 'fdr', payload: { ...output.fdr, based_on: { code: d.code, version: d.version }, domain: d.domain } }],
    },
  });
});
