// The product definition after onboarding: the system composes it from the answers a person
// confirmed in the product definition stage and proposes it; a person accepts it; it reaches every
// agent that writes records, whole; each section keeps the question it comes from; a changed answer
// proposes the next version with what changed and why. And an inference rests on the person's exact
// words, or it does not happen.

import { DEFINITION_SECTIONS, type Section, human, system } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { buildContext } from '../src/context/build.ts';
import { newDecision } from './support/recipes.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');
let projectId = '';
let thread = '';

type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

const answer = (key: string) => `The ${key} as the person put it.`;

async function stageQuestions() {
  return environment()
    .services.db.selectFrom('questions')
    .select(['id', 'stage_key', 'state', 'evidence'])
    .where('project_id', '=', projectId)
    .where('stage_key', 'is not', null)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
}

async function definitionProposals() {
  return environment()
    .services.db.selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select([
      'proposals.id',
      'proposals.state',
      'proposals.payload',
      'proposals.dependencies',
      'proposal_batches.producer',
      'proposal_batches.kind',
    ])
    .where('proposals.project_id', '=', projectId)
    .where('proposals.type', '=', 'product_definition')
    .orderBy('proposals.id')
    .execute();
}

const pack = (action: 'exploration_chat' | 'design_proposal', scope: { type: string; id: string }) =>
  environment()
    .services.db.transaction()
    .execute((trx) => buildContext(trx, projectId, action, scope, {}, 0));

type Payload = {
  record?: { code: string; version: number };
  sections: Section[];
  sources: { section: string; question_id: string | null }[];
  change_note?: string;
};

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Club trips' } })).projectId;
  // The first thread a person opens is the product's main thread: the product definition stage opens there.
  thread = (await cmd('exploration.open', { purpose: 'An app for our club trips' })).entityId;
});

describe('the product definition stage', () => {
  it('asks eight questions: what the product is for, how you will know it works and its principles first', async () => {
    expect((await stageQuestions()).map((q) => q.stage_key)).toEqual([
      'purpose',
      'outcomes',
      'principles',
      'stakeholders',
      'problem',
      'features',
      'scope_out',
      'constraints',
    ]);
  });
});

describe('an inference rests on the exact words of the person', () => {
  it('keeps the quote and the message it comes from', async () => {
    const message = (
      await cmd('message.post', {
        exploration_id: thread,
        text: 'Members sign up for trips and organizers see who comes.',
        respond: false,
      })
    ).entityId;
    const purpose = (await stageQuestions()).find((q) => q.stage_key === 'purpose');
    await executeCommand(environment().services, {
      command: 'question.infer',
      actor: system('exploration'),
      projectId,
      entityId: purpose?.id ?? '',
      data: {
        conclusion: 'Members sign up for club trips; organizers know who is coming.',
        evidence: [{ message_id: message, quote: 'members sign up for trips' }],
      },
    });
    const after = (await stageQuestions()).find((q) => q.stage_key === 'purpose');
    expect(after?.state).toBe('inferred');
    expect(after?.evidence).toEqual([{ message_id: message, quote: 'members sign up for trips' }]);
  });

  it('refuses a quote the person never wrote', async () => {
    const message = (await cmd('message.post', { exploration_id: thread, text: 'Trips are free for members.', respond: false }))
      .entityId;
    const outcomes = (await stageQuestions()).find((q) => q.stage_key === 'outcomes');
    await expect(
      executeCommand(environment().services, {
        command: 'question.infer',
        actor: system('exploration'),
        projectId,
        entityId: outcomes?.id ?? '',
        data: { conclusion: 'Trips sell out.', evidence: [{ message_id: message, quote: 'trips always sell out' }] },
      }),
    ).rejects.toMatchObject({ type: 'validation' });
    expect((await stageQuestions()).find((q) => q.stage_key === 'outcomes')?.state).toBe('pending');
  });
});

describe('the definition is composed from the confirmed answers and proposed to the person', () => {
  it('is not proposed while any answer of the stage is open', async () => {
    const questions = await stageQuestions();
    for (const q of questions.slice(0, -1)) await cmd('question.confirm', { conclusion: answer(q.stage_key ?? '') }, q.id);
    expect(await definitionProposals()).toEqual([]);
  });

  it('is proposed by the system with the last answer, each section keeping its question', async () => {
    const questions = await stageQuestions();
    const last = questions.at(-1);
    await cmd('question.confirm', { conclusion: answer(last?.stage_key ?? '') }, last?.id);
    const [proposal] = await definitionProposals();
    expect(proposal).toMatchObject({ state: 'pending', producer: 'system:definition@1', kind: 'system_package' });
    const payload = proposal?.payload as Payload;
    expect(payload.record).toBeUndefined();
    expect(payload.sections.map((s) => s.title)).toEqual(DEFINITION_SECTIONS.map((s) => s.title));
    expect(payload.sections.map((s) => s.content)).toEqual(DEFINITION_SECTIONS.map((s) => answer(s.key)));
    const byKey = new Map(questions.map((q) => [q.stage_key, q.id]));
    expect(payload.sources.map((s) => s.question_id)).toEqual(DEFINITION_SECTIONS.map((s) => byKey.get(s.key)));
  });

  it('only DEMIURGO proposes a product definition', async () => {
    await expect(
      executeCommand(environment().services, {
        command: 'batch.submit',
        actor: { type: 'agent_external', name: 'helper', session: 's1' },
        projectId,
        data: {
          proposals: [
            { type: 'product_definition', payload: { title: 'x', sections: [{ title: 'Purpose', content: 'x' }], sources: [] } },
          ],
        },
      }),
    ).rejects.toMatchObject({ type: 'guard' });
  });

  it('accepting and approving it creates the PRD record, version 1, whose origin is the proposal', async () => {
    const [proposal] = await definitionProposals();
    const r = await cmd('proposal.accept', { approve: true }, proposal?.id);
    expect(r.result).toMatchObject({ type: 'record', version: 1, approved: true });
    const code = (r.result as { code: string }).code;
    expect(code).toMatch(/^PRD-[A-Z]{3}-\d{3}$/);
    const v = await environment()
      .services.db.selectFrom('record_versions')
      .innerJoin('records', 'records.id', 'record_versions.record_id')
      .select(['records.type', 'record_versions.state', 'record_versions.origin', 'record_versions.approved_by'])
      .where('records.code', '=', code)
      .executeTakeFirstOrThrow();
    expect(v).toMatchObject({ type: 'product_definition', state: 'approved', approved_by: 'human:ana' });
    expect(v.origin).toEqual({ type: 'proposal', id: proposal?.id });
  });

  it('there is one definition per project', async () => {
    await expect(
      cmd('record.create', {
        type: 'product_definition',
        domain: 'producto',
        title: 'Another',
        sections: DEFINITION_SECTIONS.map((s) => ({ title: s.title, content: 'x' })),
      }),
    ).rejects.toThrow('The project already has its product definition');
  });
});

describe('the definition reaches every agent that writes records, whole', () => {
  it('another thread gets it in its pack, as a dependency and as a fragment of the manifest', async () => {
    const other = (await cmd('exploration.open', { purpose: 'Paying for trips' })).entityId;
    const { pack: p, manifest } = await pack('exploration_chat', { type: 'exploration', id: other });
    const definition = (p.content as { product_definition?: { code: string; version: number; sections: Section[] } })
      .product_definition;
    expect(definition?.version).toBe(1);
    expect(definition?.sections.map((s) => s.content)).toEqual(DEFINITION_SECTIONS.map((s) => answer(s.key)));
    const record = await environment()
      .services.db.selectFrom('records')
      .select('id')
      .where('project_id', '=', projectId)
      .where('type', '=', 'product_definition')
      .executeTakeFirstOrThrow();
    expect(p.dependencies).toContainEqual({ type: 'record', id: record.id, version: 1 });
    expect(manifest.fragments.filter((f) => f.section === 'product_definition')).toMatchObject([
      { decision: 'included', source: { type: 'record_version', version: 1 } },
    ]);
  });

  it('designing from a decision gets it too', async () => {
    const decision = await newDecision(environment().services, projectId, true);
    const { pack: p } = await pack('design_proposal', { type: 'record_version', id: decision.versionId });
    expect((p.content as { product_definition?: { version: number } }).product_definition?.version).toBe(1);
  });
});

describe('a changed answer proposes the next version, with what changed and why', () => {
  it('reopening a question and confirming a new answer proposes version 2 with its change note', async () => {
    const constraints = (await stageQuestions()).find((q) => q.stage_key === 'constraints');
    await cmd('question.reopen', { reason: 'Records are kept in English.' }, constraints?.id);
    expect((await definitionProposals()).filter((p) => p.state === 'pending')).toEqual([]);
    await cmd('question.confirm', { conclusion: 'A web app; records are kept in English.' }, constraints?.id);
    const pending = (await definitionProposals()).filter((p) => p.state === 'pending');
    expect(pending).toHaveLength(1);
    const payload = pending[0]?.payload as Payload;
    expect(payload.record?.version).toBe(1);
    expect(payload.change_note).toBe('Changed: Constraints.\n\nConstraints: Records are kept in English.');
    expect(payload.sections.find((s) => s.title === 'Constraints')?.content).toBe('A web app; records are kept in English.');
  });

  it('approving it supersedes version 1, which stays whole, and the packs move to version 2', async () => {
    const pending = (await definitionProposals()).find((p) => p.state === 'pending');
    await cmd('proposal.accept', { approve: true }, pending?.id);
    const versions = await environment()
      .services.db.selectFrom('record_versions')
      .innerJoin('records', 'records.id', 'record_versions.record_id')
      .select(['record_versions.n', 'record_versions.state', 'record_versions.change_note', 'record_versions.sections'])
      .where('records.project_id', '=', projectId)
      .where('records.type', '=', 'product_definition')
      .orderBy('record_versions.n')
      .execute();
    expect(versions.map((v) => [v.n, v.state])).toEqual([
      [1, 'superseded'],
      [2, 'approved'],
    ]);
    const first = (versions[0]?.sections ?? []) as Section[];
    expect(first.find((s) => s.title === 'Constraints')?.content).toBe(answer('constraints'));
    expect(versions[1]?.change_note).toContain('Records are kept in English.');
    const { pack: p } = await pack('exploration_chat', { type: 'exploration', id: thread });
    expect((p.content as { product_definition?: { version: number } }).product_definition?.version).toBe(2);
  });

  it('confirming the same answer again proposes nothing', async () => {
    const problem = (await stageQuestions()).find((q) => q.stage_key === 'problem');
    await cmd('question.reopen', {}, problem?.id);
    await cmd('question.confirm', { conclusion: answer('problem') }, problem?.id);
    expect((await definitionProposals()).filter((p) => p.state === 'pending')).toEqual([]);
  });
});

describe('passing the stage proposes the definition when there is none', () => {
  it('after the person rejected the first one, passing the stage proposes it again', async () => {
    const s = environment().services;
    projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Studio' } })).projectId;
    await cmd('exploration.open', { purpose: 'Book a yoga class' });
    for (const q of await stageQuestions()) await cmd('question.confirm', { conclusion: answer(q.stage_key ?? '') }, q.id);
    const [first] = await definitionProposals();
    await cmd('proposal.reject', {}, first?.id);
    const stage = await s.db.selectFrom('stages').select('id').where('project_id', '=', projectId).executeTakeFirstOrThrow();
    await cmd('stage.pass', {}, stage.id);
    expect((await definitionProposals()).map((p) => p.state)).toEqual(['rejected', 'pending']);
  });
});
