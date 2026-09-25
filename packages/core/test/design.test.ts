// S1 ACs on the core (no HTTP): versions, criteria, questions, readiness and batches.

import { type Actor, DomainError, externalAgent, human, system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { inbox, explorationDetail, batchDetail, productState, versionReadiness } from '../src/queries/read.ts';
import type { Services } from '../src/services.ts';
import { useEnvironment } from './support/env.ts';
import { newDecision, newExploration, newBatch } from './support/recipes.ts';

const environment = useEnvironment();
const ana = human('ana');
let s: Services;
let projectId = '';

beforeAll(async () => {
  s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Design' } })).projectId;
});

const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string, actor: Actor = ana) =>
  executeCommand(s, { command, actor, projectId, data, ...(entityId ? { entityId } : {}) });

const FDR_SECTIONS = [
  { title: 'Goal', content: 'Que los socios se den de alta.' },
  { title: 'Scope', content: 'Alta con nombre y correo.' },
  { title: 'Out of scope', content: 'Pagos.' },
  { title: 'Behavior', content: 'La persona rellena el formulario y ve la confirmación.' },
];
const AC = (title: string) => ({
  carry: 'new' as const,
  title,
  statement: `Dado un socio nuevo, cuando envía el formulario de ${title}, entonces ve la confirmación.`,
  verification: 'automatic' as const,
  check: 'Prueba de extremo a extremo del formulario.',
});

async function fdrOn(decision: { code: string }, options: { criteria?: unknown[]; approve?: boolean; origin?: unknown } = {}) {
  const r = await cmd('record.create', {
    type: 'fdr',
    domain: 'socios',
    title: 'Alta de socios',
    sections: FDR_SECTIONS,
    criteria: options.criteria ?? [AC('alta'), AC('baja')],
    links: [{ type: 'based_on', target: { code: decision.code, version: 1 } }],
    ...(options.origin ? { origin: options.origin } : {}),
  });
  const res = r.result as { recordId: string; versionId: string; code: string };
  if (options.approve) await cmd('record_version.approve', {}, res.versionId);
  return res;
}

const DECISION_SECTIONS = [
  { title: 'Context', content: 'c2' },
  { title: 'Decision', content: 'd2' },
  { title: 'Consequences', content: 'k2' },
];

/** Creates (and by default approves) a new version of a decision. */
async function newDecisionVersion(recordId: string, approve = true, pid = projectId): Promise<string> {
  const v = await executeCommand(s, {
    command: 'record_version.create',
    actor: ana,
    projectId: pid,
    data: { record_id: recordId, title: 'Decisión revisada', sections: DECISION_SECTIONS, change_note: 'Change.' },
  });
  if (approve) {
    await executeCommand(s, {
      command: 'record_version.approve',
      actor: ana,
      projectId: pid,
      entityId: v.entityId,
      data: {},
    });
  }
  return v.entityId;
}

const dependency = (r: { recordId: string; code: string }, version = 1) => ({
  type: 'record',
  id: r.recordId,
  code: r.code,
  version,
});

async function stateOf(table: 'proposals' | 'proposal_batches', id: string) {
  return (await s.db.selectFrom(table).select('state').where('id', '=', id).executeTakeFirstOrThrow()).state;
}

async function versions(recordId: string) {
  return s.db.selectFrom('record_versions').select(['id', 'n', 'state']).where('record_id', '=', recordId).orderBy('n').execute();
}

describe('versions and criteria', () => {
  it('AC-DIS-001-08 approving does not create a version: the current one is the latest approved and the previous one is superseded', async () => {
    const d = await newDecision(s, projectId, true);
    expect(await versions(d.recordId)).toMatchObject([{ n: 1, state: 'approved' }]);
    const v2 = await cmd('record_version.create', {
      record_id: d.recordId,
      title: 'Decisión revisada',
      sections: [
        { title: 'Context', content: 'c2' },
        { title: 'Decision', content: 'd2' },
        { title: 'Consequences', content: 'k2' },
      ],
      change_note: 'Se precisa la decisión.',
    });
    expect(await versions(d.recordId)).toMatchObject([
      { n: 1, state: 'approved' },
      { n: 2, state: 'draft' },
    ]);
    await cmd('record_version.approve', {}, v2.entityId);
    expect(await versions(d.recordId)).toMatchObject([
      { n: 1, state: 'superseded' },
      { n: 2, state: 'approved' },
    ]);
    const supersede = await s.db
      .selectFrom('events')
      .select(['actor', 'cause'])
      .where('command', '=', 'record_version.supersede')
      .where('entity_id', '=', (await versions(d.recordId))[0]?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(supersede.actor).toBe('system:versions@1');
  });

  it('AC-DIS-001-08 an earlier draft than an already approved version is not approved: it is discarded', async () => {
    const d = await newDecision(s, projectId, true);
    const v2 = await newDecisionVersion(d.recordId, false);
    const v3 = await newDecisionVersion(d.recordId, false);
    await cmd('record_version.approve', {}, v3);
    await expect(cmd('record_version.approve', {}, v2)).rejects.toMatchObject({
      type: 'guard',
      reasons: ['There is already a later approved version (v3): discard this draft or create a new version.'],
    });
    expect((await versionReadiness(s.db, projectId, v2)).reasons).toContain(
      'Version 2 is a draft earlier than the current one (v3): it can only be discarded.',
    );
    expect((await inbox(s.db, projectId)).versions_to_approve.find((v) => v.id === v2)).toMatchObject({ approvable: false });
    await cmd('record_version.discard', { reason: 'La sustituye la v3.' }, v2);
    expect(await versions(d.recordId)).toMatchObject([
      { n: 1, state: 'superseded' },
      { n: 2, state: 'discarded' },
      { n: 3, state: 'approved' },
    ]);
  });

  it('AC-DIS-001-09 criteria and links are only born with their version, and the database enforces it', async () => {
    const d = await newDecision(s, projectId, true);
    const f = await fdrOn(d, { approve: true });
    const onlyWithOwnVersion = 'Criteria and links are created with their version: create a new version of the record.';
    const criterion = {
      version_id: f.versionId,
      code: `AC-${f.code.slice(4)}-07`,
      title: 'Snuck',
      statement: 'Cuando se añade, entonces cambia la versión.',
      verification: 'automatic',
      check: 'Test.',
      carry: 'kept',
      derived_from_id: null,
      position: 9,
    };
    await expect(cmd('criterion.record', criterion)).rejects.toMatchObject({
      type: 'guard',
      reasons: expect.arrayContaining([onlyWithOwnVersion]),
    });
    // Not even in a draft: a version's content is fixed when it is created.
    const draft = await fdrOn(d);
    await expect(cmd('criterion.record', { ...criterion, version_id: draft.versionId })).rejects.toMatchObject({
      type: 'guard',
      reasons: [onlyWithOwnVersion],
    });
    await expect(
      cmd('link.create', {
        type: 'based_on',
        from: { type: 'record_version', id: f.versionId },
        to: { type: 'record_version', id: d.versionId },
      }),
    ).rejects.toMatchObject({ type: 'guard', reasons: [onlyWithOwnVersion] });
    // The database blocks it even if a guard fails.
    await expect(
      sql`insert into criteria (project_id, record_version_id, code, title, statement, verification, check_text, carry, position, state)
          values (${projectId}::uuid, ${f.versionId}::uuid, ${criterion.code}, 't', 's', 'automatic', 'c', 'new', 9, 'recorded')`.execute(
        s.db,
      ),
    ).rejects.toThrow(/draft/);
    await expect(
      sql`insert into links (project_id, type, from_type, from_id, from_version, to_type, to_id, to_version, state, created_by)
          values (${projectId}::uuid, 'based_on', 'record_version', ${f.versionId}::uuid, 1, 'record_version', ${d.versionId}::uuid, 1, 'current', 'human:ana')`.execute(
        s.db,
      ),
    ).rejects.toThrow(/draft/);
  });

  it('AC-DIS-001-09 a new criterion never reuses the code of a discarded one, and a new version requires a change note', async () => {
    const d = await newDecision(s, projectId);
    const f = await fdrOn(d);
    const [c1, c2] = (
      await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', f.versionId).orderBy('position').execute()
    ).map((c) => c.code);
    const base = { record_id: f.recordId, title: 'v2', sections: FDR_SECTIONS };
    await expect(
      cmd('record_version.create', { ...base, criteria: [{ carry: 'kept', code: c1 }], discarded: [c2] }),
    ).rejects.toMatchObject({ type: 'guard', reasons: ['A new version requires a change note.'] });
    await cmd('record_version.create', {
      ...base,
      criteria: [{ carry: 'kept', code: c1 }],
      discarded: [c2],
      change_note: 'Se descarta un criterio.',
    });
    const v3 = { ...base, title: 'v3', change_note: 'Vuelve un criterio.' };
    await expect(
      cmd('record_version.create', {
        ...v3,
        criteria: [
          { carry: 'kept', code: c1 },
          { ...AC('another'), code: c2 },
        ],
      }),
    ).rejects.toMatchObject({ type: 'validation', message: expect.stringContaining(`${c2} was already used`) });
    const r = await cmd('record_version.create', { ...v3, criteria: [{ carry: 'kept', code: c1 }, AC('another')] });
    const codes = (
      await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', r.entityId).orderBy('position').execute()
    ).map((c) => c.code);
    expect(codes).toEqual([c1, expect.stringMatching(/-03$/)]);
  });

  it('AC-DIS-001-08 creating a record with an explicit version (import) returns that version', async () => {
    const r = await cmd('record.create', {
      type: 'decision',
      domain: 'socios',
      title: 'Importada en su versión 2',
      sections: DECISION_SECTIONS,
      number: 2,
      change_note: 'Viene de design/.',
    });
    expect(r.result).toMatchObject({ version: 2 });
  });

  it('AC-DIS-001-09 the database rejects modifying a version or its criteria', async () => {
    const d = await newDecision(s, projectId);
    const f = await fdrOn(d);
    await expect(sql`update record_versions set title = 'otro' where id = ${f.versionId}::uuid`.execute(s.db)).rejects.toThrow(
      /immutable/,
    );
    await expect(sql`update record_versions set sections = '[]' where id = ${f.versionId}::uuid`.execute(s.db)).rejects.toThrow(
      /immutable/,
    );
    await expect(
      sql`update criteria set statement = 'otro' where record_version_id = ${f.versionId}::uuid`.execute(s.db),
    ).rejects.toThrow(/does not admit changes/);
    await expect(sql`delete from criteria where record_version_id = ${f.versionId}::uuid`.execute(s.db)).rejects.toThrow(
      /does not admit DELETE/,
    );
  });

  it('AC-DIS-001-09 a new version requires keeping, modifying or discarding each criterion', async () => {
    const d = await newDecision(s, projectId);
    const f = await fdrOn(d);
    const codes = (
      await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', f.versionId).orderBy('position').execute()
    ).map((c) => c.code);
    expect(codes).toHaveLength(2);
    const base = {
      record_id: f.recordId,
      title: 'Alta de socios v2',
      sections: FDR_SECTIONS,
      change_note: 'Cambia un criterio.',
    };
    // Without saying what happens to the second criterion: rejected with the reason.
    const withoutCarryOver = cmd('record_version.create', { ...base, criteria: [{ carry: 'kept', code: codes[0] }] });
    await expect(withoutCarryOver).rejects.toMatchObject({
      type: 'guard',
      reasons: [expect.stringContaining(`${codes[1]}: keep, modify or discard`)],
    });
    const r = await cmd('record_version.create', {
      ...base,
      criteria: [{ carry: 'kept', code: codes[0] }, { ...AC('modified'), carry: 'modified', derived_from: codes[1] }, AC('new')],
    });
    const created = await s.db
      .selectFrom('criteria')
      .select(['code', 'carry', 'derived_from', 'statement'])
      .where('record_version_id', '=', r.entityId)
      .orderBy('position')
      .execute();
    expect(created.map((c) => [c.code, c.carry])).toEqual([
      [codes[0], 'kept'],
      [codes[1], 'modified'],
      [expect.stringMatching(/-03$/), 'new'],
    ]);
    expect(created[0]?.derived_from).not.toBeNull();
    // Discarding is explicit too.
    const v3 = await cmd('record_version.create', {
      ...base,
      title: 'v3',
      criteria: [{ carry: 'kept', code: codes[0] }],
      discarded: [codes[1], created[2]?.code],
    });
    expect(v3.state).toBe('draft');
  });

  it('AC-DIS-001-18 creating or approving a record that does not meet its template is rejected with what is missing', async () => {
    const bug = cmd('record.create', {
      type: 'bug',
      domain: 'socios',
      title: 'Falla el alta',
      sections: [
        { title: 'Expected', content: 'e' },
        { title: 'Observed', content: 'o' },
      ],
    });
    await expect(bug).rejects.toMatchObject({ type: 'guard', reasons: [expect.stringContaining('Reproduction')] });
    const empty = cmd('record.create', {
      type: 'decision',
      domain: 'socios',
      title: 'x',
      sections: [
        { title: 'Context', content: '' },
        { title: 'Decision', content: 'd' },
        { title: 'Consequences', content: 'k' },
      ],
    });
    await expect(empty).rejects.toMatchObject({ type: 'guard', reasons: [expect.stringContaining('is empty')] });
  });

  it('AC-DIS-001-18 an FDR or an ADR missing a template section is rejected, and also when approving', async () => {
    const fdr = cmd('record.create', {
      type: 'fdr',
      domain: 'socios',
      title: 'Sin alcance',
      sections: FDR_SECTIONS.filter((x) => x.title !== 'Scope'),
      criteria: [AC('alta')],
    });
    await expect(fdr).rejects.toMatchObject({ type: 'guard', reasons: [expect.stringContaining('Scope')] });
    const adr = cmd('record.create', {
      type: 'adr',
      domain: 'socios',
      title: 'Sin opciones',
      sections: [
        { title: 'Context', content: 'c' },
        { title: 'Decision', content: 'd' },
        { title: 'Consequences', content: 'k' },
      ],
      criteria: [AC('alta')],
    });
    await expect(adr).rejects.toMatchObject({ type: 'guard', reasons: [expect.stringContaining('Options')] });
    // It is checked again on approval: a version that does not meet it (inserted without going through the creation guard).
    const d = await newDecision(s, projectId);
    const sections = JSON.stringify([
      { title: 'Context', content: 'c' },
      { title: 'Decision', content: 'd' },
    ]);
    const { rows } = await sql<{ id: string }>`
      insert into record_versions (project_id, record_id, n, title, sections, author, content_hash, state)
      values (${projectId}::uuid, ${d.recordId}::uuid, 2, 'Sin consecuencias', ${sections}::jsonb, 'human:ana', 'h', 'draft')
      returning id`.execute(s.db);
    await expect(cmd('record_version.approve', {}, rows[0]?.id)).rejects.toMatchObject({
      type: 'guard',
      reasons: [expect.stringContaining('Consequences')],
    });
  });
});

describe('questions', () => {
  async function question(): Promise<string> {
    const e = await newExploration(s, projectId);
    return (await cmd('question.raise', { exploration_id: e, question: '¿Quién paga la cuota?' })).entityId;
  }

  it('AC-DIS-001-10 confirming requires a conclusion; postponing and discarding require a reason; reopening keeps the history', async () => {
    const q = await question();
    await expect(cmd('question.confirm', {}, q)).rejects.toMatchObject({
      type: 'guard',
      reasons: ['A conclusion is required.'],
    });
    await expect(cmd('question.postpone', { reason: '  ' }, q)).rejects.toMatchObject({
      type: 'guard',
      reasons: ['A reason is required.'],
    });
    await cmd('question.confirm', { conclusion: 'La paga cada socio.' }, q);
    await cmd('question.reopen', { reason: 'Cambia el reglamento.' }, q);
    const row = await s.db.selectFrom('questions').selectAll().where('id', '=', q).executeTakeFirstOrThrow();
    expect(row.state).toBe('pending');
    const history = await s.db
      .selectFrom('events')
      .select(['command', 'state_before', 'state_after', 'after'])
      .where('entity_id', '=', q)
      .orderBy('seq')
      .execute();
    expect(history.map((e) => e.command)).toEqual(['question.raise', 'question.confirm', 'question.reopen']);
    expect(history[1]?.after).toEqual({ conclusion: 'La paga cada socio.' });
    // Once reopened, it comes back without a conclusion: confirming it again requires a new one.
    expect(row.conclusion).toBeNull();
    await expect(cmd('question.confirm', {}, q)).rejects.toMatchObject({
      type: 'guard',
      reasons: ['A conclusion is required.'],
    });
    await expect(cmd('question.discard', {}, q)).rejects.toMatchObject({ type: 'guard' });
    await cmd('question.discard', { reason: 'Ya no aplica.' }, q);
  });

  it('AC-DIS-001-19 a question only becomes inferred by the system; an agent cannot infer or confirm it', async () => {
    const q = await question();
    for (const actor of [
      externalAgent('bot', 's'),
      { type: 'agent_run', run: '00000000-0000-7000-8000-000000000001' } as Actor,
    ]) {
      await expect(cmd('question.infer', { conclusion: 'x' }, q, actor)).rejects.toMatchObject({ type: 'forbidden' });
      await expect(cmd('question.confirm', { conclusion: 'x' }, q, actor)).rejects.toMatchObject({ type: 'forbidden' });
    }
    await cmd('question.infer', { conclusion: 'Cada socio.', reasoning: 'Lo dijo la persona.' }, q, system('exploration'));
    const row = await s.db.selectFrom('questions').select(['state', 'conclusion']).where('id', '=', q).executeTakeFirstOrThrow();
    expect(row).toEqual({ state: 'inferred', conclusion: 'Cada socio.' });
    // The person confirms it with the inferred conclusion.
    await cmd('question.confirm', {}, q);
  });
});

describe('readiness', () => {
  it('AC-DIS-001-06 readiness false for each reason, in product language', async () => {
    const decision = await newDecision(s, projectId, true);
    const list = await fdrOn(decision, { approve: true });
    expect(await versionReadiness(s.db, projectId, list.versionId)).toEqual({ ready: true, reasons: [], warnings: [] });

    // Unapproved version.
    const draft = await fdrOn(decision);
    expect((await versionReadiness(s.db, projectId, draft.versionId)).reasons).toContain('Version 1 is not approved.');

    // No criteria.
    const withoutAc = await fdrOn(decision, { criteria: [], approve: true });
    expect((await versionReadiness(s.db, projectId, withoutAc.versionId)).reasons).toContain('It has no acceptance criteria.');

    // No approved decision.
    const withoutDecision = await newDecision(s, projectId, false);
    const fWithoutDecision = await fdrOn(withoutDecision, { approve: true });
    expect((await versionReadiness(s.db, projectId, fWithoutDecision.versionId)).reasons).toContain(
      `The decision it is based on, ${withoutDecision.code}, is not approved.`,
    );

    // Not current: approving a v2 of the FDR leaves v1 superseded.
    const f = await fdrOn(decision, { approve: true });
    const v2 = await cmd('record_version.create', {
      record_id: f.recordId,
      title: 'Alta v2',
      sections: FDR_SECTIONS,
      criteria: (await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', f.versionId).execute()).map(
        (c) => ({ carry: 'kept', code: c.code }),
      ),
      links: [{ type: 'based_on', target: { code: decision.code, version: 1 } }],
      change_note: 'Revisión.',
    });
    await cmd('record_version.approve', {}, v2.entityId);
    expect((await versionReadiness(s.db, projectId, f.versionId)).reasons).toContain(
      'Version 1 is superseded: the current one is 2.',
    );

    // Decision not current and link pending review: a v2 of the decision is approved.
    const d2 = await newDecision(s, projectId, true);
    const fd2 = await fdrOn(d2, { approve: true });
    const incoming = await cmd('record_version.create', {
      record_id: d2.recordId,
      title: 'Decisión v2',
      sections: [
        { title: 'Context', content: 'c' },
        { title: 'Decision', content: 'other' },
        { title: 'Consequences', content: 'k' },
      ],
      change_note: 'Cambia la decisión.',
    });
    await cmd('record_version.approve', {}, incoming.entityId);
    const reasons = (await versionReadiness(s.db, projectId, fd2.versionId)).reasons;
    expect(reasons).toContain(`It is based on ${d2.code} v1, but the current one is v2.`);
    expect(reasons).toContain(`The link with ${d2.code} is pending review.`);

    // Pending or postponed questions in the origin exploration.
    const e = await newExploration(s, projectId);
    await cmd('question.raise', { exploration_id: e, question: '¿Hay invitados?' });
    const q2 = (await cmd('question.raise', { exploration_id: e, question: '¿Cuotas reducidas?' })).entityId;
    await cmd('question.postpone', { reason: 'Luego.' }, q2);
    const withQuestions = await fdrOn(decision, { approve: true, origin: { type: 'exploration', id: e } });
    const mp = (await versionReadiness(s.db, projectId, withQuestions.versionId)).reasons;
    expect(mp).toContain('There are 1 pending question(s) in the origin exploration.');
    expect(mp).toContain('There are 1 postponed question(s) in the origin exploration.');

    // Pending proposals affecting it.
    const affected = await fdrOn(decision, { approve: true });
    await cmd(
      'batch.submit',
      {
        proposals: [
          {
            type: 'exploration',
            payload: { purpose: 'Revisar el alta' },
            dependencies: [{ type: 'record', id: affected.recordId, code: affected.code, version: 1 }],
          },
        ],
      },
      undefined,
      system('test'),
    );
    expect((await versionReadiness(s.db, projectId, affected.versionId)).reasons).toContain(
      'There are 1 pending proposal(s) affecting it.',
    );
  });

  it('AC-DIS-001-06 open questions are looked up in the origin exploration: proposal → batch → run → scope', async () => {
    const decision = await newDecision(s, projectId, true);
    const e = await newExploration(s, projectId);
    await cmd('question.raise', { exploration_id: e, question: '¿Hay cuota familiar?' });
    const run = await cmd('run.request', { action: 'exploration_chat', scope: { type: 'exploration', id: e } });
    const batch = await cmd(
      'batch.submit',
      {
        run_id: run.entityId,
        proposals: [
          {
            type: 'fdr',
            payload: {
              title: 'Alta de socios',
              goal: 'o',
              scope: 'a',
              out_of_scope: 'f',
              behavior: 'c',
              criteria: [
                {
                  title: 'Alta',
                  statement: 'Cuando envía, entonces ve la confirmación.',
                  verification: 'automatic',
                  check: 'E2E.',
                },
              ],
              based_on: { code: decision.code, version: 1 },
            },
          },
        ],
      },
      undefined,
      system('test'),
    );
    const [proposal] = (batch.result as { proposals: string[] }).proposals;
    const effect = (await cmd('proposal.accept', { approve: true }, proposal)).result as { versionId: string };
    expect((await versionReadiness(s.db, projectId, effect.versionId)).reasons).toEqual([
      'There are 1 pending question(s) in the origin exploration.',
    ]);
  });

  it('AC-DIS-001-14 a non-observable criterion gets a warning, never a block', async () => {
    const decision = await newDecision(s, projectId, true);
    const f = (await fdrOn(decision, {
      approve: true,
      criteria: [{ ...AC('x'), title: 'Rápido', statement: 'El alta es rápida e intuitiva.' }, AC('good')],
    })) as unknown as { versionId: string; code: string; warnings: string[] };
    // The warning arrives when the AC is recorded; the one that follows the rule gets none.
    const prefix = `AC-${f.code.slice(4)}`;
    expect(f.warnings.join(' ')).toMatch(new RegExp(`${prefix}-01: the statement doesn't describe an observable result`));
    expect(f.warnings.join(' ')).toMatch(new RegExp(`${prefix}-01: "rápida" is vague`));
    expect(f.warnings.filter((a) => a.startsWith(`${prefix}-02`))).toEqual([]);
    const r = await versionReadiness(s.db, projectId, f.versionId);
    expect(r.ready).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/doesn't describe an observable result/);
    expect(r.warnings.join(' ')).toMatch(/"rápida" is vague|is vague/);
  });
});

describe('batches and proposals', () => {
  it('AC-DIS-001-11 an external agent proposes at most 10 items, item by item and with its producer visible', async () => {
    const bot = externalAgent('bot', 'session-x');
    const payload = { purpose: 'Explorar invitados' };
    const once = Array.from({ length: 11 }, () => ({ type: 'exploration', payload }));
    await expect(cmd('batch.submit', { proposals: once }, undefined, bot)).rejects.toMatchObject({
      type: 'guard',
      reasons: [expect.stringContaining('at most 10')],
    });
    // Even if it asks for a package, the channel fixes it by item.
    const r = await cmd(
      'batch.submit',
      { resolution: 'package', batch_type: 'system_package', proposals: once.slice(0, 10) },
      undefined,
      bot,
    );
    const batch = await s.db.selectFrom('proposal_batches').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
    expect(batch).toMatchObject({ kind: 'agent', resolution_mode: 'item', producer: 'agent:bot:session-x' });
    const proposals = await s.db.selectFrom('proposals').select('id').where('batch_id', '=', batch.id).execute();
    expect(proposals).toHaveLength(10);
    // The whole batch is not accepted: it is resolved item by item.
    await expect(cmd('batch.accept_package', {}, batch.id)).rejects.toMatchObject({
      type: 'guard',
      reasons: ['This batch is resolved item by item.'],
    });
    await cmd('proposal.accept', {}, proposals[0]?.id);
    await cmd('proposal.reject', { reason: 'No ahora.' }, proposals[1]?.id);
  });

  it('AC-DIS-001-11 a proposal from a package is not accepted or rejected on its own', async () => {
    const { proposals } = await newBatch(s, projectId, true);
    const reason = 'This proposal is part of a package: the whole package is accepted or rejected together.';
    await expect(cmd('proposal.accept', {}, proposals[0])).rejects.toMatchObject({ type: 'guard', reasons: [reason] });
    await expect(cmd('proposal.reject', {}, proposals[0])).rejects.toMatchObject({ type: 'guard', reasons: [reason] });
  });

  it('AC-DIS-001-05 an external agent only proposes decisions, explorations and FDRs, with no observation type or provenance', async () => {
    const bot = externalAgent('bot', 'session-z');
    for (const type of ['review', 'imported_record', 'imported_taxonomy']) {
      await expect(cmd('batch.submit', { proposals: [{ type, payload: {} }] }, undefined, bot)).rejects.toMatchObject({
        type: 'guard',
        reasons: expect.arrayContaining([`An external agent cannot propose "${type}".`]),
      });
    }
    const e = await newExploration(s, projectId);
    await expect(
      cmd('message.post', { exploration_id: e, text: 'Es seguro que sí.', type: 'claim', respond: false }, undefined, bot),
    ).rejects.toMatchObject({ type: 'validation', message: 'Only agent output carries an observation type.' });
    // It cannot attribute its batch to a run or a context pack: the channel nulls it out.
    const r = await cmd(
      'batch.submit',
      {
        run_id: '00000000-0000-7000-8000-00000000000a',
        context_pack_id: '00000000-0000-7000-8000-00000000000b',
        proposals: [{ type: 'exploration', payload: { purpose: 'x' } }],
      },
      undefined,
      bot,
    );
    const batch = await s.db
      .selectFrom('proposal_batches')
      .select(['run_id', 'context_pack_id', 'producer'])
      .where('id', '=', r.entityId)
      .executeTakeFirstOrThrow();
    expect(batch).toEqual({ run_id: null, context_pack_id: null, producer: 'agent:bot:session-z' });
  });

  it('AC-DIS-001-11 an agent cannot add proposals to a batch it does not own or outside a submission', async () => {
    const { batchId } = await newBatch(s, projectId, true);
    const bot = externalAgent('bot', 'session-y');
    const attempt = cmd(
      'proposal.create',
      { batch_id: batchId, position: 9, type: 'exploration', payload: { purpose: 'sneak' } },
      undefined,
      bot,
    );
    await expect(attempt).rejects.toMatchObject({
      type: 'guard',
      reasons: ['Proposals are submitted within a batch (batch.submit).'],
    });
  });

  it('AC-DIS-001-16 a proposal that depends on a version that changed becomes obsolete and is not accepted', async () => {
    const d = await newDecision(s, projectId, true);
    const dep = { type: 'record', id: d.recordId, code: d.code, version: 1 };
    const r = await cmd(
      'batch.submit',
      { proposals: [{ type: 'exploration', payload: { purpose: 'Diseñar sobre la v1' }, dependencies: [dep] }] },
      undefined,
      system('test'),
    );
    const [proposal] = (r.result as { proposals: string[] }).proposals;
    // A later human change: v2 of the decision is approved.
    const v2 = await cmd('record_version.create', {
      record_id: d.recordId,
      title: 'v2',
      sections: [
        { title: 'Context', content: 'c' },
        { title: 'Decision', content: 'd' },
        { title: 'Consequences', content: 'k' },
      ],
      change_note: 'Change.',
    });
    await cmd('record_version.approve', {}, v2.entityId);
    const row = await s.db
      .selectFrom('proposals')
      .select(['state', 'resolution'])
      .where('id', '=', proposal ?? '')
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('superseded');
    expect(JSON.stringify(row.resolution)).toMatch(/has changed \(current: v2; the proposal was based on v1\)/);
    await expect(cmd('proposal.accept', {}, proposal)).rejects.toMatchObject({ type: 'invalid_transition' });
  });

  it('AC-DIS-001-16 a proposal born with a dependency that is not the current one is obsolete from submission', async () => {
    const d = await newDecision(s, projectId, true);
    await newDecisionVersion(d.recordId);
    // The dependency declares v1, but the current one is already v2.
    const r = await cmd(
      'batch.submit',
      { proposals: [{ type: 'exploration', payload: { purpose: 'x' }, dependencies: [dependency(d)] }] },
      undefined,
      system('test'),
    );
    const [proposal] = (r.result as { proposals: string[] }).proposals;
    const row = await s.db
      .selectFrom('proposals')
      .select(['state', 'resolution'])
      .where('id', '=', proposal ?? '')
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('superseded');
    expect(JSON.stringify(row.resolution)).toMatch(/The proposal is obsolete: .* \(current: v2; the proposal was based on v1\)/);
    await expect(cmd('proposal.accept', {}, proposal)).rejects.toMatchObject({
      type: 'invalid_transition',
      message: expect.stringContaining('Obsolete'),
    });
  });

  it('AC-DIS-001-16 depending on a draft with no approved version does not make the proposal obsolete; discarding it does', async () => {
    const d = await newDecision(s, projectId, false);
    const r = await cmd(
      'batch.submit',
      { proposals: [{ type: 'exploration', payload: { purpose: 'Revisar el borrador' }, dependencies: [dependency(d)] }] },
      undefined,
      system('test'),
    );
    const [proposal] = (r.result as { proposals: string[] }).proposals;
    // Knowledge reviews about drafts (e.g. what is imported from design/) reach the inbox.
    expect(await stateOf('proposals', proposal ?? '')).toBe('pending');
    await cmd('record_version.discard', { reason: 'No sigue.' }, d.versionId);
    const row = await s.db
      .selectFrom('proposals')
      .select(['state', 'resolution'])
      .where('id', '=', proposal ?? '')
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('superseded');
    expect(JSON.stringify(row.resolution)).toMatch(/version 1 of .* was discarded/);
  });

  it('AC-DIS-001-16 an FDR based on one version but declaring another of the same record is born obsolete', async () => {
    const d = await newDecision(s, projectId, true);
    await newDecisionVersion(d.recordId);
    const r = await cmd(
      'batch.submit',
      {
        proposals: [
          {
            type: 'fdr',
            payload: {
              title: 'Alta de socios',
              goal: 'o',
              scope: 'a',
              out_of_scope: 'f',
              behavior: 'c',
              criteria: [
                {
                  title: 'Alta',
                  statement: 'Cuando envía, entonces ve la confirmación.',
                  verification: 'automatic',
                  check: 'E2E.',
                },
              ],
              based_on: { code: d.code, version: 1 },
            },
            dependencies: [dependency(d, 2)],
          },
        ],
      },
      undefined,
      externalAgent('bot', 'session-two'),
    );
    const [proposal] = (r.result as { proposals: string[] }).proposals;
    expect(await stateOf('proposals', proposal ?? '')).toBe('superseded');
  });

  it('AC-DIS-001-16 a proposal from a package does not go obsolete on its own: the whole package does', async () => {
    const { proposals } = await newBatch(s, projectId, true);
    await expect(cmd('proposal.supersede', { reason: 'x' }, proposals[0], system('test'))).rejects.toMatchObject({
      type: 'guard',
      reasons: ['This proposal is part of a package: the whole package becomes obsolete.'],
    });
  });

  it('AC-DIS-001-06 a package whose batch depends on the FDR affects it, and discarding the linked version leaves the link in review', async () => {
    const decision = await newDecision(s, projectId, true);
    const f = await fdrOn(decision, { approve: true });
    await cmd(
      'batch.submit',
      {
        batch_type: 'system_package',
        resolution: 'package',
        dependencies: [dependency(f)],
        proposals: [{ type: 'exploration', payload: { purpose: 'Revisar la FDR' } }],
      },
      undefined,
      system('test'),
    );
    expect((await versionReadiness(s.db, projectId, f.versionId)).reasons).toContain(
      'There are 1 pending proposal(s) affecting it.',
    );
    // A linked draft that gets discarded: the link is left pending review.
    const draft = await newDecision(s, projectId, false);
    const g = await fdrOn(draft);
    await cmd('record_version.discard', {}, draft.versionId);
    const link = await s.db.selectFrom('links').select('state').where('from_id', '=', g.versionId).executeTakeFirstOrThrow();
    expect(link.state).toBe('needs_review');
  });

  it('AC-DIS-001-16 a package whose batch depends on a version that changed becomes entirely obsolete', async () => {
    const d = await newDecision(s, projectId, true);
    const r = await cmd(
      'batch.submit',
      {
        batch_type: 'system_package',
        resolution: 'package',
        dependencies: [dependency(d)],
        proposals: [
          { type: 'exploration', payload: { purpose: 'a' } },
          { type: 'exploration', payload: { purpose: 'b' } },
        ],
      },
      undefined,
      system('test'),
    );
    const { proposals } = r.result as { proposals: string[] };
    await newDecisionVersion(d.recordId);
    expect(await stateOf('proposal_batches', r.entityId)).toBe('superseded');
    for (const p of proposals) expect(await stateOf('proposals', p)).toBe('superseded');
    await expect(cmd('batch.accept_package', {}, r.entityId)).rejects.toMatchObject({ type: 'invalid_transition' });
  });

  it('AC-DIS-001-16 if one proposal in a package goes obsolete, the whole package does: it is never partly accepted', async () => {
    const d = await newDecision(s, projectId, true);
    const r = await cmd(
      'batch.submit',
      {
        batch_type: 'system_package',
        resolution: 'package',
        proposals: [
          { type: 'exploration', payload: { purpose: 'a' }, dependencies: [dependency(d)] },
          { type: 'exploration', payload: { purpose: 'b' } },
        ],
      },
      undefined,
      system('test'),
    );
    await newDecisionVersion(d.recordId);
    expect(await stateOf('proposal_batches', r.entityId)).toBe('superseded');
    const states = await s.db.selectFrom('proposals').select('state').where('batch_id', '=', r.entityId).execute();
    expect(states.map((e) => e.state)).toEqual(['superseded', 'superseded']);
  });

  it('AC-DIS-001-16 an FDR proposed on top of a decision depends on it even when the agent does not declare it', async () => {
    const d = await newDecision(s, projectId, true);
    const bot = externalAgent('bot', 'session-fdr');
    const r = await cmd(
      'batch.submit',
      {
        proposals: [
          {
            type: 'fdr',
            payload: {
              title: 'Alta de socios',
              goal: 'o',
              scope: 'a',
              out_of_scope: 'f',
              behavior: 'c',
              criteria: [
                {
                  title: 'Alta',
                  statement: 'Cuando envía, entonces ve la confirmación.',
                  verification: 'automatic',
                  check: 'E2E.',
                },
              ],
              based_on: { code: d.code, version: 1 },
            },
          },
        ],
      },
      undefined,
      bot,
    );
    const [proposal] = (r.result as { proposals: string[] }).proposals;
    const row = await s.db
      .selectFrom('proposals')
      .select('dependencies')
      .where('id', '=', proposal ?? '')
      .executeTakeFirstOrThrow();
    expect(row.dependencies).toEqual([dependency(d)]);
    await newDecisionVersion(d.recordId);
    expect(await stateOf('proposals', proposal ?? '')).toBe('superseded');
  });

  it('AC-NUC-001-05 "accept and approve" breaks down into table commands with their actor and the same correlation', async () => {
    const { proposals } = await newBatch(s, projectId, false);
    const r = await cmd('proposal.accept', { approve: true }, proposals[0]);
    const acceptance = await s.db
      .selectFrom('events')
      .select('cause')
      .where('command', '=', 'proposal.accept')
      .where('entity_id', '=', proposals[0] ?? '')
      .executeTakeFirstOrThrow();
    const correlation = (acceptance.cause as { correlation: string }).correlation;
    const sameCorrelationEvents = await s.db
      .selectFrom('events')
      .select(['command', 'actor', 'cause'])
      .where('project_id', '=', projectId)
      .where(sql<boolean>`cause->>'correlation' = ${correlation}`)
      .orderBy('seq')
      .execute();
    const commands = new Set(sameCorrelationEvents.map((e) => e.command));
    const expected = ['proposal.accept', 'record.create', 'record_version.create', 'record_version.approve', 'batch.close'];
    expect(expected.filter((c) => !commands.has(c))).toEqual([]);
    // The decisive part and what creates authority is done by the person; closing the batch and
    // enqueuing "Update knowledge" is done by the system.
    for (const e of sameCorrelationEvents) {
      const fromSystem = ['batch.close', 'knowledge_update.enqueue'].includes(e.command);
      expect({ command: e.command, ofItsActor: e.actor.startsWith(fromSystem ? 'system:' : 'human:') }).toEqual({
        command: e.command,
        ofItsActor: true,
      });
    }
    expect(r.state).toBe('accepted');
  });

  it('a domain error carries its type for the API', () => {
    expect(new DomainError('guard', 'x').httpStatus).toBe(409);
  });
});

describe('epistemic status', () => {
  it('AC-DIS-001-12 every row of the correspondence table carries its epistemic status in the inbox, the product state or its detail', async () => {
    const pid = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Epistemic' } })).projectId;
    const inProject = (
      command: Parameters<typeof executeCommand>[1]['command'],
      data: unknown,
      entityId?: string,
      actor: Actor = ana,
    ) => executeCommand(s, { command, actor, projectId: pid, data, ...(entityId ? { entityId } : {}) });

    // Approved version and draft version.
    const approved = await newDecision(s, pid, true);
    const draft = await newDecision(s, pid, false);
    // Pending proposal and accepted proposal.
    const pendingBatch = await newBatch(s, pid, false);
    const accepted = await newBatch(s, pid, false);
    await inProject('proposal.accept', {}, accepted.proposals[0]);
    // Confirmed, inferred, pending and postponed questions.
    const e = await newExploration(s, pid);
    const question = async (text: string) => (await inProject('question.raise', { exploration_id: e, question: text })).entityId;
    const qConfirmed = await question('¿Confirmada?');
    await inProject('question.confirm', { conclusion: 'Sí.' }, qConfirmed);
    const qInferred = await question('¿Inferida?');
    await inProject('question.infer', { conclusion: 'Sí.', reasoning: 'Lo dijo.' }, qInferred, system('exploration'));
    const qPending = await question('¿Pendiente?');
    const qPostponed = await question('¿Pospuesta?');
    await inProject('question.postpone', { reason: 'Luego.' }, qPostponed);
    // An agent's observations: a run's output.
    const run = await inProject('run.request', { action: 'exploration_chat', scope: { type: 'exploration', id: e } });
    const agent: Actor = { type: 'agent_run', run: run.entityId };
    for (const type of ['claim', 'hypothesis', 'unknown']) {
      await inProject('message.post', { exploration_id: e, text: `Observación ${type}`, type, respond: false }, undefined, agent);
    }
    // Link pending review: the decision an FDR is based on changes.
    const base = await newDecision(s, pid, true);
    const fdr = await inProject('record.create', {
      type: 'fdr',
      domain: 'socios',
      title: 'Alta',
      sections: FDR_SECTIONS,
      criteria: [AC('alta')],
      links: [{ type: 'based_on', target: { code: base.code, version: 1 } }],
    });
    await inProject('record_version.approve', {}, (fdr.result as { versionId: string }).versionId);
    await newDecisionVersion(base.recordId, true, pid);

    const b = await inbox(s.db, pid);
    const state = await productState(s.db, pid);
    const exploration = await explorationDetail(s.db, pid, e);
    const acceptedDetail = await batchDetail(s.db, pid, accepted.batchId);
    const epistemicOf = (id: string) => exploration.questions.find((q) => q.id === id)?.epistemic_status;
    const observation = (type: string) => exploration.messages.find((m) => m.kind === type)?.epistemic_status;
    const rows = {
      'Approved version': state.decisions.find((d) => d.code === approved.code)?.epistemic_status,
      'Draft version (state)': state.decisions.find((d) => d.code === draft.code)?.epistemic_status,
      'Draft version (inbox)': b.versions_to_approve.find((v) => v.code === draft.code)?.epistemic_status,
      'Pending proposal': b.batches.find((l) => l.id === pendingBatch.batchId)?.proposals[0]?.epistemic_status,
      'Accepted proposal': acceptedDetail.proposals[0]?.epistemic_status,
      'Confirmed question': epistemicOf(qConfirmed),
      'Inferred question': b.questions_to_confirm.find((q) => q.id === qInferred)?.epistemic_status,
      'Pending question': b.open_questions.find((q) => q.id === qPending)?.epistemic_status,
      'Postponed question': b.open_questions.find((q) => q.id === qPostponed)?.epistemic_status,
      'Claim observation': observation('claim'),
      'Hypothesis observation': observation('hypothesis'),
      'Unknown observation': observation('unknown'),
      'Link pending review': b.links_under_review[0]?.epistemic_status,
    };
    expect(rows).toEqual({
      'Approved version': 'confirmed',
      'Draft version (state)': 'proposed',
      'Draft version (inbox)': 'proposed',
      'Pending proposal': 'proposed',
      'Accepted proposal': 'confirmed',
      'Confirmed question': 'confirmed',
      'Inferred question': 'proposed',
      'Pending question': 'pending',
      'Postponed question': 'pending',
      'Claim observation': 'proposed',
      'Hypothesis observation': 'proposed',
      'Unknown observation': 'unknown',
      'Link pending review': 'pending',
    });
    // The inbox counts everything waiting on the person, including what does not come from an agent.
    expect(b.open_questions).toHaveLength(2);
    // The draft and the decision that accepting the proposal without approving it created.
    expect(b.versions_to_approve).toHaveLength(2);
    expect(state.inbox.total).toBe(b.total);
  });
});

describe('project across every entity', () => {
  it('AC-ESQ-001-17 nothing is written to another project: not versions, not dependencies, not even by skipping the guards', async () => {
    const another = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Other' } })).projectId;
    const foreign = await newDecision(s, another, true);
    await expect(
      cmd('record_version.create', {
        record_id: foreign.recordId,
        title: 'x',
        sections: DECISION_SECTIONS,
        change_note: 'x',
      }),
    ).rejects.toMatchObject({ type: 'guard', reasons: expect.arrayContaining(['The record does not exist in this project.']) });
    await expect(
      cmd(
        'batch.submit',
        { proposals: [{ type: 'exploration', payload: { purpose: 'x' }, dependencies: [dependency(foreign)] }] },
        undefined,
        externalAgent('bot', 'probe'),
      ),
    ).rejects.toMatchObject({ type: 'guard', reasons: [`The dependency ${foreign.code} v1 does not exist in this project.`] });
    await expect(
      sql`insert into record_versions (project_id, record_id, n, title, sections, author, content_hash, state)
          values (${projectId}::uuid, ${foreign.recordId}::uuid, 9, 't', '[]', 'human:ana', 'h', 'draft')`.execute(s.db),
    ).rejects.toThrow(/different projects/);
    expect(await versions(foreign.recordId)).toMatchObject([{ n: 1, state: 'approved' }]);
  });

  it('AC-ESQ-001-17 every domain table carries project_id, and the authority tables and the event log reject DELETE', async () => {
    const withoutProject = await sql<{ table_name: string }>`
      select t.table_name from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        -- Infrastructure without a project: identity, engine, migrations, cache by input_hash, classifier evaluations,
        -- and the workspace settings of models and providers (FDR-AGE-002).
        and t.table_name not in ('projects', 'humans', 'sessions', 'step_completions', 'schema_migrations', 'verdict_cache', 'classifier_evaluations', 'provider_catalogs', 'agent_assignments')
        and not exists (select 1 from information_schema.columns c
                        where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'project_id')`.execute(
      s.db,
    );
    expect(withoutProject.rows).toEqual([]);
    // Its own data: the test does not depend on the order of the others.
    const e = await newExploration(s, projectId);
    await cmd('message.post', { exploration_id: e, text: 'Hello', respond: false });
    await cmd('question.raise', { exploration_id: e, question: '¿Algo?' });
    await fdrOn(await newDecision(s, projectId, true));
    await newBatch(s, projectId, false);
    for (const table of [
      'projects',
      'records',
      'record_versions',
      'criteria',
      'links',
      'proposals',
      'proposal_batches',
      'questions',
      'messages',
      'explorations',
      'events',
    ]) {
      const { rows } = await sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)}`.execute(s.db);
      expect({ table, withRows: (rows[0]?.n ?? 0) > 0 }).toEqual({ table, withRows: true });
      await expect(sql`delete from ${sql.table(table)}`.execute(s.db)).rejects.toThrow(/DELETE|only admits INSERT/);
    }
  });
});
