// design_proposal action: from an approved decision, proposes an FDR with its ACs as a single
// coherent package that the person accepts in one step. The package depends on the decision's
// current version: if it changes, the package becomes obsolete.

import { DomainError } from '@demiurgo/domain';
import { registerBuilder } from '../context/build.ts';
import { knowledgeForContext } from '../context/knowledge.ts';
import { ManifestBuilder, recordKnowledge } from '../context/manifest.ts';
import { registerApplier } from './appliers.ts';

const BUILDER = 'design_proposal@1';
const BUDGET = { decision: 8_000, related: 4_000, knowledge: 4_000 };
const CUT = { context: 3000, decision: 3000, consequences: 2000, related: 40 };

registerBuilder('design_proposal', async ({ trx, projectId, scope, graphVersion }) => {
  const manifest = new ManifestBuilder(BUILDER, graphVersion, BUDGET);
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
  const decision = {
    code: v.code,
    version: v.n,
    domain: v.domain,
    title: v.title,
    context: text('Context').slice(0, CUT.context),
    decision: text('Decision').slice(0, CUT.decision),
    consequences: text('Consequences').slice(0, CUT.consequences),
  };
  // The decision is one fragment: its three sections as they enter, cut where the pack cuts them.
  const entered = `${decision.context}\n${decision.decision}\n${decision.consequences}`;
  const wholeChars = text('Context').length + text('Decision').length + text('Consequences').length;
  const enteredChars = decision.context.length + decision.decision.length + decision.consequences.length;
  manifest.entered({
    section: 'decision',
    source: { type: 'record', id: v.recordId, version: v.n, eventSeq: null },
    text: entered,
    chars: enteredChars,
    originalChars: wholeChars,
    decision: wholeChars > enteredChars ? 'truncated' : 'included',
    reason: wholeChars > enteredChars ? `excerpt:${CUT.context}+${CUT.decision}+${CUT.consequences}` : 'scope',
  });
  const related = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'records.type', 'record_versions.n', 'record_versions.title'])
    .where('records.project_id', '=', projectId)
    .where('record_versions.state', '=', 'approved')
    .where('records.id', '<>', v.recordId)
    .orderBy('records.code')
    .limit(CUT.related)
    .execute();
  for (const r of related)
    manifest.entered({
      section: 'related',
      source: { type: 'record', id: r.recordId, version: r.n, eventSeq: null },
      text: r.title,
      reason: 'approved',
    });
  const knowledge = await knowledgeForContext(trx, projectId, `${v.title} ${text('Decision')}`, BUDGET.knowledge);
  recordKnowledge(manifest, knowledge);
  return {
    pack: {
      role: 'design',
      constructor: BUILDER,
      budget: BUDGET,
      graph_version: graphVersion,
      dependencies: [{ type: 'record', id: v.recordId, version: v.n }, ...knowledge.dependencies],
      content: {
        decision,
        approved_records: related.map((r) => ({ code: r.code, type: r.type, version: r.n, title: r.title })),
        knowledge: knowledge.nodes,
      },
    },
    manifest: manifest.build(),
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
