// design_system_plan action: a dedicated agent writes the project's whole design system from the
// thread and the direction the person chose, as one proposal of type `design_system` that the person
// accepts and approves. The checker is the deterministic gate after the model call: the domain's
// `designSystemProblems` plus the thread's chosen base and safe specimens.

import { DomainError, designSystemPathOf, designSystemProblems } from '@demiurgo/domain';
import { registerBuilder } from '../context/build.ts';
import { registerApplier, registerChecker } from './appliers.ts';
import { chosenDirection } from './design-directions.ts';
import { designThreadOf, packContentOf, relabelPack, withSection } from './drafting.ts';
import { explorationPack } from './exploration-chat.ts';

const BUILDER = 'design_system_plan@1';

registerBuilder('design_system_plan', async (a) => {
  if (a.scope.type !== 'exploration' || !a.scope.id) throw new DomainError('validation', 'A design system is drafted from its thread.');
  const thread = await designThreadOf(a.trx, a.projectId, a.scope.id);
  if (!thread) throw new DomainError('validation', 'This thread is not about a design system.');
  const chosen = await chosenDirection(a.trx, a.projectId, a.scope.id);
  if (!chosen) throw new DomainError('validation', 'Choose a visual direction in the thread first.');
  const built = relabelPack(await explorationPack(a), BUILDER);
  return withSection(
    built,
    'chosen_direction',
    chosen,
    { type: 'exploration', id: a.scope.id, version: null, eventSeq: null },
    'the direction the person chose in the design-system thread',
  );
});

type PackContent = { design_system: { path: 'public' | 'scratch'; base: { kind: 'public' | 'scratch'; name?: string; url?: string; license?: string } } };

registerChecker('design_system_plan', async ({ db, run, output }) => {
  const { spec, sections } = output.result;
  const notes = designSystemProblems(spec);
  for (const [title, content] of Object.entries(sections))
    if (content.trim() === '') notes.push(`The section "${title}" is empty: write it.`);
  const pack = await packContentOf<PackContent>(db, run);
  const want = pack.design_system.base;
  if (spec.base.kind !== want.kind) {
    notes.push(
      want.kind === 'public'
        ? `\`spec.base.kind\` must be "public": the thread starts from ${want.name}.`
        : '`spec.base.kind` must be "scratch": the thread designs from scratch.',
    );
  } else if (want.kind === 'public') {
    if ((spec.base.name ?? '').trim().toLowerCase() !== (want.name ?? '').toLowerCase())
      notes.push(`\`spec.base.name\` must be "${want.name}", the public system the thread starts from.`);
    if (want.url && spec.base.url !== want.url) notes.push(`\`spec.base.url\` must be ${want.url}.`);
    if (want.license && spec.base.license !== want.license) notes.push(`\`spec.base.license\` must be "${want.license}".`);
  }
  for (const c of spec.components) {
    if (/<script/i.test(c.specimen_html)) notes.push(`The specimen of "${c.name}" has a <script>: specimens are HTML and CSS only.`);
    if (/https?:/i.test(c.specimen_html)) notes.push(`The specimen of "${c.name}" points to an external URL (http): it is self-contained.`);
  }
  return notes;
});

registerApplier('design_system_plan', async ({ trx, execute, run, output }) => {
  const scope = run.scope as { id: string };
  const thread = await trx.selectFrom('explorations').select('purpose').where('id', '=', scope.id).executeTakeFirstOrThrow();
  if (!designSystemPathOf(thread.purpose)) throw new DomainError('conflict', 'This thread is not about a design system.');
  const x = output.result;
  await execute({
    projectId: run.project_id,
    command: 'batch.submit',
    actor: { type: 'agent_run', run: run.id },
    data: {
      summary: `Design system direction: ${x.title} (${x.spec.components.length} components).`,
      batch_type: 'agent',
      resolution: 'item',
      run_id: run.id,
      context_pack_id: run.context_pack_id ?? undefined,
      proposals: [
        {
          type: 'design_system',
          payload: {
            title: x.title,
            sections: x.sections,
            spec: x.spec,
            ...(x.change_note ? { change_note: x.change_note } : {}),
          },
        },
      ],
    },
  });
});
