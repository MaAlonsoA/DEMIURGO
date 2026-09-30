// The product definition after onboarding: the system composes it from the answers a person
// confirmed in the product definition stage and proposes it; a person accepts it; it reaches every
// agent that writes records, whole; each section keeps the question it comes from; a changed answer
// proposes the next version with what changed and why. And an inference rests on the person's exact
// words, or it does not happen. A change decided in another thread becomes the next version in one
// step, and an answer written in another language is kept in English, with the person's own words.

import { DEFINITION_SECTIONS, type Section, human, system } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { buildContext } from '../src/context/build.ts';
import { definitionChangeProposal } from '../src/definition/compose.ts';
import { inceptionOf } from '../src/queries/inception.ts';
import { productDefinition } from '../src/queries/definition.ts';
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

  it('accepting and approving it creates the DEF record, version 1, whose origin is the proposal', async () => {
    const [proposal] = await definitionProposals();
    const r = await cmd('proposal.accept', { approve: true }, proposal?.id);
    expect(r.result).toMatchObject({ type: 'record', version: 1, approved: true });
    const code = (r.result as { code: string }).code;
    expect(code).toMatch(/^DEF-[A-Z]{3}-\d{3}$/);
    const v = await environment()
      .services.db.selectFrom('record_versions')
      .innerJoin('records', 'records.id', 'record_versions.record_id')
      .select(['records.type', 'record_versions.state', 'record_versions.origin', 'record_versions.approved_by'])
      .where('records.code', '=', code)
      .executeTakeFirstOrThrow();
    expect(v).toMatchObject({ type: 'product_definition', state: 'approved', approved_by: 'human:ana' });
    expect(v.origin).toEqual({ type: 'proposal', id: proposal?.id });
  });

  it('approving the first version passes the Product definition stage and opens the next one', async () => {
    const stages = await environment()
      .services.db.selectFrom('stages')
      .select(['stage', 'state', 'passed_by'])
      .where('project_id', '=', projectId)
      .orderBy('position')
      .execute();
    expect(stages.map((s) => [s.stage, s.state])).toEqual([
      ['requirements', 'passed'],
      ['quality', 'open'],
    ]);
    expect(stages[0]?.passed_by).toBe('human:ana');
    // The inception path moves on: the definition is done and the next step is the quality stage.
    const path = await inceptionOf(environment().services.db, projectId);
    expect(path.steps[0]).toMatchObject({ key: 'definition', state: 'done' });
    expect(path).toMatchObject({ current: 'quality', done: 1 });
    expect(path.steps.find((s) => s.state === 'current')?.action).toMatchObject({ kind: 'answer_stage', stage: 'quality' });
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

/** A new project whose definition is approved: every answer confirmed and the proposal accepted. */
async function withApprovedDefinition(name: string) {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name } })).projectId;
  const main = (await cmd('exploration.open', { purpose: `About ${name}` })).entityId;
  for (const q of await stageQuestions()) await cmd('question.confirm', { conclusion: answer(q.stage_key ?? '') }, q.id);
  const [proposal] = await definitionProposals();
  const accepted = await cmd('proposal.accept', { approve: true }, proposal?.id);
  return { main, code: (accepted.result as { code: string }).code };
}

async function versionsOfDefinition() {
  return environment()
    .services.db.selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select([
      'record_versions.n',
      'record_versions.state',
      'record_versions.change_note',
      'record_versions.sections',
      'record_versions.origin',
    ])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'product_definition')
    .orderBy('record_versions.n')
    .execute();
}

const said = (id: string, body: string) => [{ id, body }];

describe('a change to the definition proposed in a thread', () => {
  let other = '';
  let message = '';
  const decided = 'We decided it runs in the browser, as a web app.';

  beforeAll(async () => {
    await withApprovedDefinition('Club trips, changed from a thread');
    other = (await cmd('exploration.open', { purpose: 'Where it runs' })).entityId;
    message = (await cmd('message.post', { exploration_id: other, text: decided, respond: false })).entityId;
  });

  const change = {
    section: 'Constraints' as const,
    content: 'A web app, used from the browser.',
    reason: 'The person decided it.',
  };

  it('rests on the words of the person in the thread and on the version in force, or it is dropped', async () => {
    const trx = environment().services.db;
    await expect(
      definitionChangeProposal(trx, projectId, { ...change, quotes: ['it runs on phones'] }, said(message, decided)),
    ).resolves.toBeNull();
    await expect(
      definitionChangeProposal(
        trx,
        projectId,
        { ...change, content: answer('constraints'), quotes: ['runs in the browser'] },
        said(message, decided),
      ),
    ).resolves.toBeNull();
    const proposal = await definitionChangeProposal(
      trx,
      projectId,
      { ...change, quotes: ['runs in the browser'] },
      said(message, decided),
    );
    expect(proposal?.payload).toMatchObject({
      section: 'Constraints',
      content: change.content,
      record: { version: 1 },
      evidence: [{ message_id: message, quote: 'runs in the browser' }],
    });
    expect(proposal?.dependencies).toMatchObject([{ type: 'record', version: 1 }]);
  });

  it('accepting it changes the answer and approves the next version in one step, with its why', async () => {
    const proposal = await definitionChangeProposal(
      environment().services.db,
      projectId,
      { ...change, quotes: ['runs in the browser'] },
      said(message, decided),
    );
    const batch = await executeCommand(environment().services, {
      command: 'batch.submit',
      actor: system('exploration'),
      projectId,
      data: { summary: 'From the thread.', batch_type: 'agent', resolution: 'item', proposals: [proposal] },
    });
    const id = (
      await environment()
        .services.db.selectFrom('proposals')
        .select('id')
        .where('batch_id', '=', batch.entityId)
        .executeTakeFirstOrThrow()
    ).id;
    const r = await cmd('proposal.accept', {}, id);
    expect(r.result).toMatchObject({ type: 'record', version: 2, approved: true });
    const versions = await versionsOfDefinition();
    expect(versions.map((v) => [v.n, v.state])).toEqual([
      [1, 'superseded'],
      [2, 'approved'],
    ]);
    expect(versions[1]?.origin).toEqual({ type: 'proposal', id });
    expect(versions[1]?.change_note).toBe('Changed: Constraints.\n\nConstraints: The person decided it.');
    const sections = (versions[1]?.sections ?? []) as Section[];
    expect(sections.find((s) => s.title === 'Constraints')?.content).toBe(change.content);
    expect(sections.find((s) => s.title === 'Purpose')?.content).toBe(answer('purpose'));
    const constraints = (await stageQuestions()).find((q) => q.stage_key === 'constraints');
    expect(constraints?.state).toBe('confirmed');
    // Nothing else waits: the system proposes no other version of its own.
    expect((await definitionProposals()).filter((p) => p.state === 'pending')).toEqual([]);

    const read = await productDefinition(environment().services.db, projectId);
    expect(read.changes).toEqual([]);
    const current = read.versions[0];
    expect(current?.from_thread).toMatchObject({ proposal_id: id, exploration_id: null });
    expect(current?.sources.find((s) => s.section === 'Constraints')?.question).toMatchObject({
      id: constraints?.id,
      settled_by: 'human:ana',
    });
    expect(current?.reasons).toEqual([{ section: 'Constraints', why: 'The person decided it.', own_words: null }]);
  });

  it('one made against a version that is no longer in force is out of date from the start', async () => {
    const batch = await executeCommand(environment().services, {
      command: 'batch.submit',
      actor: system('exploration'),
      projectId,
      data: {
        summary: 'Late.',
        batch_type: 'agent',
        resolution: 'item',
        proposals: [
          {
            type: 'definition_change',
            payload: {
              record: { code: (await versionsOfCode()).code, version: 1 },
              section: 'Problem',
              content: 'Something else.',
              reason: 'Late.',
              evidence: [{ message_id: message, quote: 'runs in the browser' }],
            },
            dependencies: [{ type: 'record', ...(await versionsOfCode()), version: 1 }],
          },
        ],
      },
    });
    const p = await environment()
      .services.db.selectFrom('proposals')
      .select('state')
      .where('batch_id', '=', batch.entityId)
      .executeTakeFirstOrThrow();
    expect(p.state).toBe('superseded');
  });
});

async function versionsOfCode() {
  return environment()
    .services.db.selectFrom('records')
    .select(['id', 'code'])
    .where('project_id', '=', projectId)
    .where('type', '=', 'product_definition')
    .executeTakeFirstOrThrow();
}

describe('an answer that changed while a definition waited', () => {
  it('is proposed right after the person approves the one that waited', async () => {
    await withApprovedDefinition('Club trips, waiting answers');
    const q = await stageQuestions();
    const problem = q.find((x) => x.stage_key === 'problem');
    const users = q.find((x) => x.stage_key === 'stakeholders');
    await cmd('question.reopen', { reason: 'Guests come too.' }, users?.id);
    await cmd('question.confirm', { conclusion: 'Members, organizers and guests.' }, users?.id);
    // Version 2 waits for the person; meanwhile another answer changes.
    await cmd('question.reopen', { reason: 'Payments are the real pain.' }, problem?.id);
    await cmd('question.confirm', { conclusion: 'Organizers chase payments by hand.' }, problem?.id);
    const waiting = (await definitionProposals()).filter((p) => p.state === 'pending');
    expect(waiting).toHaveLength(1);
    await cmd('proposal.accept', { approve: true }, waiting[0]?.id);
    const next = (await definitionProposals()).filter((p) => p.state === 'pending');
    expect(next).toHaveLength(1);
    const payload = next[0]?.payload as Payload;
    expect(payload.record?.version).toBe(2);
    expect(payload.change_note).toBe('Changed: Problem.\n\nProblem: Payments are the real pain.');
  });
});

describe('an answer written in another language', () => {
  const spanish = 'Los socios se apuntan a las salidas del club y los organizadores saben quién viene.';
  let purpose = '';

  beforeAll(async () => {
    const s = environment().services;
    projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Salidas' } })).projectId;
    await cmd('exploration.open', { purpose: 'Una app para las salidas del club' });
    purpose = (await stageQuestions()).find((q) => q.stage_key === 'purpose')?.id ?? '';
  });

  const confirmEvent = async (id: string) =>
    environment()
      .services.db.selectFrom('events')
      .select('after')
      .where('entity_id', '=', id)
      .where('command', '=', 'question.confirm')
      .orderBy('seq', 'desc')
      .executeTakeFirstOrThrow();

  it("is put into English before it is saved, and the person's own words stay in the event", async () => {
    await cmd('question.confirm', { conclusion: spanish, own_words: 'made up by the client' }, purpose);
    const q = await environment()
      .services.db.selectFrom('questions')
      .select('conclusion')
      .where('id', '=', purpose)
      .executeTakeFirstOrThrow();
    // The simulated translator marks what it translated with the target language.
    expect(q.conclusion).toBe(`[en] ${spanish}`);
    expect((await confirmEvent(purpose)).after).toEqual({ conclusion: `[en] ${spanish}`, own_words: spanish });
  });

  it('the reason of a change too; an answer in English stays as it is, without own words', async () => {
    await cmd('question.reopen', { reason: 'Los invitados también se apuntan.' }, purpose);
    const reopen = await environment()
      .services.db.selectFrom('events')
      .select('after')
      .where('entity_id', '=', purpose)
      .where('command', '=', 'question.reopen')
      .executeTakeFirstOrThrow();
    expect(reopen.after).toEqual({
      reason: '[en] Los invitados también se apuntan.',
      own_words: 'Los invitados también se apuntan.',
    });
    await cmd('question.confirm', { conclusion: 'Members and guests sign up for club trips.', own_words: 'forged' }, purpose);
    expect((await confirmEvent(purpose)).after).toEqual({ conclusion: 'Members and guests sign up for club trips.' });
  });

  it('a question outside the definition is put into English too, keeping the own words', async () => {
    const elsewhere = (await cmd('exploration.open', { purpose: 'Otra cosa' })).entityId;
    const raised = await executeCommand(environment().services, {
      command: 'question.raise',
      actor: system('exploration'),
      projectId,
      data: { exploration_id: elsewhere, question: 'Which colour?', reason: 'Branding.', impact: 'low' },
    });
    await cmd('question.confirm', { conclusion: 'El azul de siempre, como en la web del club.' }, raised.entityId);
    const after = (await confirmEvent(raised.entityId)).after as { conclusion: string; own_words?: string };
    expect(after.own_words).toBe('El azul de siempre, como en la web del club.');
    expect(after.conclusion).not.toBe(after.own_words);
  });

  it('without a model to translate it, nothing is saved and the person is told why', async () => {
    const db = environment().services.db;
    const outcomes = (await stageQuestions()).find((q) => q.stage_key === 'outcomes')?.id ?? '';
    // The translator runs on an engine this process doesn't have (assignments are append-only: the
    // latest one holds, so the simulated one comes back after).
    const assign = (provider: string, model: string) =>
      db
        .insertInto('agent_assignments')
        .values({
          scope: 'global',
          project_id: null,
          agent: 'translator',
          provider,
          model,
          effort: null,
          assigned_by: 'human:setup',
        })
        .execute();
    await assign('codex', 'gone');
    try {
      await expect(
        cmd('question.confirm', { conclusion: 'Los organizadores saben quién viene el día antes.' }, outcomes),
      ).rejects.toThrow(/kept in English, and DEMIURGO couldn't put your answer into English/);
    } finally {
      await assign('simulated', 'simulated');
    }
    const q = await db.selectFrom('questions').select('state').where('id', '=', outcomes).executeTakeFirstOrThrow();
    expect(q.state).toBe('pending');
  });
});
