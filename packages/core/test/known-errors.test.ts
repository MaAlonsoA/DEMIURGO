// The known-error vault end to end with the simulated provider (no Claude, no Codex): a forensic opens a new entry,
// the next one matches it, a claimed fix is compared with later tasks (recurred with its why, or validated after three
// clean forensics), the seed builds entries from forensics that predate the vault, and the sweeper runs the forensic of
// a task when its build request ends. Practice: ITIL Known Error Database; the threshold of three is our convention.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { human, system, type ActionOutput } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { CHECKERS } from '../src/actions/appliers.ts';
import { insertChoice } from '../src/assignments/assignments.ts';
import { DEFAULT_SCRIPTS, createSimulatedProvider } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { clearDrain, setDrain } from '../src/drain.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { dueForensics, sweepForensics } from '../src/forensics/auto.ts';

const EPOCH = '1970-01-01T00:00:00Z';
import { forensicTasks, runTaskForensic } from '../src/forensics/run.ts';
import { vaultFix, vaultSeed } from '../src/forensics/vault-ops.ts';
import { VALIDATION_CLEAN_FORENSICS, latestKnownError, validationsDue } from '../src/forensics/vault.ts';
import { waitForKnowledge } from '../src/knowledge/workflows.ts';
import { knownErrorDetail, knownErrorsOverview } from '../src/queries/known-errors.ts';
import { QUERIES } from '../../api/src/queries.ts';
import { useEnvironment } from './support/env.ts';

type Analysis = ActionOutput<'task_forensics'>;
const script: { current: ((p: Parameters<typeof DEFAULT_SCRIPTS.task_forensics>[0]) => unknown) | null } = { current: null };
const environment = useEnvironment({
  durable: true,
  providers: () => [createSimulatedProvider({ scripts: { task_forensics: (p) => (script.current ? script.current(p) : DEFAULT_SCRIPTS.task_forensics(p)) } })],
});

const ana = human('ana');
let projectId = '';
let tasks: { id: string; code: string }[] = [];
let featureVersionId = '';

type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string) => executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });
const db = () => environment().services.db;
const services = () => environment().services;
const DAY = 86_400_000;
const past = (day: number, minute = 0) => new Date(Date.UTC(2026, 8, day, 10, minute));
const future = (days: number) => new Date(Date.now() + days * DAY);

async function draftRun(action: string, scope: { type: string; id: string }) {
  await waitForKnowledge(services(), projectId, 15_000);
  const r = await cmd('run.request', { action, scope });
  await waitForRun(r.entityId);
}

async function accepted(action: string, scope: { type: string; id: string }) {
  await waitForKnowledge(services(), projectId, 15_000);
  const r = await cmd('run.request', { action, scope });
  await waitForRun(r.entityId);
  return db()
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select(['proposals.id'])
    .where('proposal_batches.run_id', '=', r.entityId)
    .orderBy('proposals.position')
    .execute();
}

/** A build request of a task with its steps at the given time; `ended` makes it a merged one. */
async function build(task: { id: string }, at: Date, opts: { review?: boolean; ended?: boolean } = {}) {
  const version = await db().selectFrom('record_versions').select('id').where('record_id', '=', task.id).where('state', '=', 'approved').executeTakeFirstOrThrow();
  // One open request per task: an earlier one is closed (the build it stands for is over).
  await sql`update build_requests set state = 'done', done_by = 'human:ana', done_at = requested_at where task_id = ${task.id} and state in ('requested', 'in_review')`.execute(db());
  const request = await db()
    .insertInto('build_requests')
    .values({
      project_id: projectId,
      task_id: task.id,
      task_version_id: version.id,
      feature_version_id: featureVersionId,
      brief: 'Build it.',
      requested_by: 'human:ana',
      requested_at: at.toISOString() as never,
      ...(opts.ended ? { state: 'done', done_by: 'human:ana', done_at: new Date(at.getTime() + 60_000).toISOString() as never } : {}),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const step = (stage: string, outcome: string, minutes: number, detail: unknown) => ({
    project_id: projectId,
    build_request_id: request.id,
    attempt: 1,
    stage,
    outcome,
    detail: JSON.stringify(detail),
    created_at: new Date(at.getTime() + minutes * 60_000).toISOString() as never,
  });
  await db()
    .insertInto('build_steps')
    .values([step('builder', 'ok', 5, { provider: 'claude' }), ...(opts.review ? [step('review', 'changes_requested', 10, { verdict: 'request_changes' })] : [])])
    .execute();
  return request.id;
}

const analyze = (task: { id: string; code: string }) => runTaskForensic(services(), projectId, task, { force: true });
const latestRow = (taskId: string) => db().selectFrom('task_forensics').selectAll().where('task_id', '=', taskId).orderBy('created_at', 'desc').orderBy('id', 'desc').executeTakeFirstOrThrow();
const occurrences = (code: string) => db().selectFrom('known_error_occurrences').selectAll().where('ke_code', '=', code).orderBy('created_at').execute();
const versions = async (code: string) => (await db().selectFrom('known_errors').select(['version', 'status']).where('code', '=', code).orderBy('version').execute()).map((r) => `${r.version}:${r.status}`);
const keCount = async () => Number((await db().selectFrom('known_errors').select((eb) => eb.fn.countAll().as('n')).where('version', '=', 1).executeTakeFirstOrThrow()).n);

/** A forensic with nothing wrong whose checklist marks `stage:review` as involved (or not). */
const clean = (involved: 'yes' | 'no') => (p: Parameters<typeof DEFAULT_SCRIPTS.task_forensics>[0]) => {
  const out = DEFAULT_SCRIPTS.task_forensics(p) as Analysis;
  return {
    ...out,
    went_wrong: [],
    root_causes: [],
    improvements: [],
    checklist: out.checklist.map((c) => (c.piece_id === 'stage:review' ? { ...c, involved, verdict: involved === 'yes' ? ('worked' as const) : ('not_applicable' as const), evidence: '' } : c)),
  };
};

beforeAll(async () => {
  delete process.env.TYPESAFE_API_KEY;
  projectId = (await executeCommand(services(), { command: 'project.create', actor: ana, data: { name: 'Vault' } })).projectId;
  const thread = (await cmd('exploration.open', { purpose: 'Share recipes with friends' })).entityId;
  await cmd('message.post', { exploration_id: thread, text: 'People should share recipes.', respond: false });
  const epic = (await cmd('proposal.accept', { approve: false }, (await accepted('epic_plan', { type: 'exploration', id: thread }))[0]?.id)).result as { versionId: string };
  await cmd('record_version.approve', {}, epic.versionId);
  const planned = await db().selectFrom('planned_features').select(['code', 'name']).where('project_id', '=', projectId).orderBy('position').execute();
  for (const p of planned.slice(0, 2)) {
    const featureThread = (
      await cmd('exploration.open', { purpose: `Design "${p.name}" (${p.code}): Walk the whole thing`, parent_id: thread, origin: { type: 'record_version', id: epic.versionId } })
    ).entityId;
    const feature = (await cmd('proposal.accept', { approve: false }, (await accepted('feature_design', { type: 'exploration', id: featureThread }))[0]?.id)).result as { versionId: string };
    await cmd('record_version.approve', {}, feature.versionId);
    featureVersionId = feature.versionId;
    for (const t of await accepted('task_plan', { type: 'record_version', id: feature.versionId })) await cmd('proposal.accept', { approve: true }, t.id);
  }
  tasks = await forensicTasks(services(), projectId);
  expect(tasks.length).toBeGreaterThanOrEqual(4);
});

describe('the vault, from the forensics', () => {
  it('a went_wrong item that matches nothing opens a new entry (open) and its first occurrence', async () => {
    const [a] = tasks as [(typeof tasks)[number]];
    await build(a, past(1), { review: true });
    expect((await analyze(a)).status).toBe('analyzed');
    const ke = await latestKnownError(db(), 'KE-001');
    expect(ke).toMatchObject({ code: 'KE-001', version: 1, status: 'open', error_class: 'E01', phase: 'P10', dimension: 'rules', pieces: ['stage:review'], fix: null, origin_project_id: projectId });
    expect(ke?.signature.length).toBeGreaterThan(10);
    const occ = await occurrences('KE-001');
    expect(occ).toHaveLength(1);
    expect(occ[0]).toMatchObject({ project_id: projectId, task_id: a.id, went_wrong_index: 0, after_fix: false, recurrence_why: null });
    expect(occ[0]?.piece_versions).toHaveProperty('stage:review');
    const row = await latestRow(a.id);
    expect((row.analysis as Analysis).went_wrong[0]).toMatchObject({ known_error: null, new_error: { pieces: ['stage:review'] } });
    expect(new Date(row.task_ended_at as unknown as Date).toISOString()).toBe(past(1, 10).toISOString());
    const event = await db().selectFrom('events').select(['actor', 'command']).where('command', '=', 'known_error.open').executeTakeFirstOrThrow();
    expect(event.actor.startsWith('system:task-forensics')).toBe(true);
  });

  it('the vault is in the evidence, and a later item with the same signature matches the entry instead of opening another', async () => {
    const b = tasks[1] as (typeof tasks)[number];
    await build(b, past(2), { review: true });
    const before = await keCount();
    const r = await analyze(b);
    expect(r.status).toBe('analyzed');
    expect(await keCount()).toBe(before);
    const row = await latestRow(b.id);
    expect((row.analysis as Analysis).went_wrong[0]).toMatchObject({ known_error: 'KE-001', new_error: null, recurrence_why: null });
    expect(await occurrences('KE-001')).toHaveLength(2);
    expect(await versions('KE-001')).toEqual(['1:open']);
    const pack = (await db().selectFrom('context_packs').select('content').where('id', '=', (await db().selectFrom('ai_runs').select('context_pack_id').where('id', '=', row.ai_run_id).executeTakeFirstOrThrow()).context_pack_id ?? '').executeTakeFirstOrThrow()).content as {
      known_errors: { code: string; status: string; signature: string; fix: unknown }[];
    };
    expect(pack.known_errors).toEqual([expect.objectContaining({ code: 'KE-001', status: 'open', fix: null })]);
    expect(pack.known_errors[0]?.signature.length).toBeGreaterThan(10);
  });

  it('vault fix records fix_claimed with the commits, the note and the versions the pieces have now', async () => {
    const r = await vaultFix(services(), 'KE-001', { commits: ['abc1234', 'def5678'], note: 'The reviewer now reads the criterion before judging the test.' });
    expect(r).toMatchObject({ code: 'KE-001', status: 'fix_claimed', version: 2, commits: ['abc1234', 'def5678'] });
    expect(Object.keys(r.piece_versions)).toEqual(['stage:review']);
    const ke = await latestKnownError(db(), 'KE-001');
    expect(ke?.status).toBe('fix_claimed');
    expect(ke?.fix).toMatchObject({ description: 'The reviewer now reads the criterion before judging the test.', commits: ['abc1234', 'def5678'], claimed_at: r.claimed_at });
    expect(await versions('KE-001')).toEqual(['1:open', '2:fix_claimed']);
    await expect(vaultFix(services(), 'KE-999', { commits: ['abc1234'], note: 'x' })).rejects.toThrow(/does not exist/);
    await expect(executeCommand(services(), { command: 'known_error.claim_fix', actor: system('cli'), projectId, data: { code: 'KE-001', description: 'x', commits: ['not a sha'], piece_versions: {} } })).rejects.toThrow();
  });

  it('a task that ran after the fix and hit the error again marks the entry recurred, and the forensic must say why', async () => {
    const c = tasks[2] as (typeof tasks)[number];
    await build(c, future(1), { review: true });
    expect((await analyze(c)).status).toBe('analyzed');
    const row = await latestRow(c.id);
    const w = (row.analysis as Analysis).went_wrong[0];
    expect(w).toMatchObject({ known_error: 'KE-001' });
    expect(w?.recurrence_why?.length).toBeGreaterThan(5);
    expect(await versions('KE-001')).toEqual(['1:open', '2:fix_claimed', '3:recurred']);
    const occ = (await occurrences('KE-001')).at(-1);
    expect(occ).toMatchObject({ task_id: c.id, after_fix: true });
    expect(occ?.recurrence_why).toBe(w?.recurrence_why);
    // The checker hands back what is missing.
    const run = await db().selectFrom('ai_runs').selectAll().where('id', '=', row.ai_run_id).executeTakeFirstOrThrow();
    const check = (item: Partial<Analysis['went_wrong'][number]>) => CHECKERS.task_forensics?.({ db: db(), run, output: { ...(row.analysis as Analysis), went_wrong: [{ ...(w as Analysis['went_wrong'][number]), ...item }] } as never });
    // The pack of that run was built when KE-001 was fix_claimed: without the why it is refused; with it, accepted.
    expect((await check({ recurrence_why: null }))?.join(' ')).toContain('recurrence_why');
    expect(await check({})).toEqual([]);
    expect((await check({ known_error: 'KE-099' }))?.join(' ')).toContain('KE-099');
    expect((await check({ known_error: null, new_error: null }))?.join(' ')).toContain('new_error');
    expect((await check({ known_error: 'KE-001', new_error: { title: 't', description: 'd', dimension: 'rules', signature: 's', pieces: [] } }))?.join(' ')).toContain('must be null');
    expect((await check({ known_error: null, new_error: { title: 't', description: 'd', dimension: 'rules', signature: 's', pieces: ['piece:ZZZ'] } }))?.join(' ')).toContain('piece:ZZZ');
  });

  it('a fix is validated after three later forensics of tasks that involved its pieces and show no occurrence (not before, and not when the piece was not involved)', async () => {
    const [a, b, c] = tasks as [(typeof tasks)[number], (typeof tasks)[number], (typeof tasks)[number]];
    expect(VALIDATION_CLEAN_FORENSICS).toBe(3);
    // The fix is claimed again after the recurrence; every task then runs on after it.
    await vaultFix(services(), 'KE-001', { commits: ['0badc0de'], note: 'The reviewer also checks that the test name starts with the criterion code.' });
    expect(await versions('KE-001')).toEqual(['1:open', '2:fix_claimed', '3:recurred', '4:fix_claimed']);
    for (const t of [a, b, c]) await build(t, future(2), {});
    const status = async () => (await latestKnownError(db(), 'KE-001'))?.status;
    try {
      script.current = clean('no');
      await analyze(a);
      script.current = clean('yes');
      await analyze(b);
      await analyze(c);
      // Two clean forensics that involved the piece, and a third that did not: still waiting.
      expect(await status()).toBe('fix_claimed');
      await analyze(a);
    } finally {
      script.current = null;
    }
    expect(await status()).toBe('validated');
    expect(await versions('KE-001')).toEqual(['1:open', '2:fix_claimed', '3:recurred', '4:fix_claimed', '5:validated']);
    const event = await db().selectFrom('events').select(['actor', 'after']).where('command', '=', 'known_error.validate').executeTakeFirstOrThrow();
    expect(event.actor.startsWith('system:task-forensics')).toBe(true);
    expect((event.after as { clean_forensics: number }).clean_forensics).toBe(3);
  });

  it('validationsDue counts distinct tasks, only forensics after the claim whose task ran after it, and none with an occurrence', () => {
    const ke = {
      id: 'k', code: 'KE-001', version: 1, title: 't', description: 'd', error_class: 'E01', phase: 'P10', dimension: 'rules', signature: 's', pieces: ['stage:review'], status: 'fix_claimed' as const,
      fix: { description: 'f', commits: ['abc1234'], piece_versions: {}, claimed_at: '2026-10-01T00:00:00.000Z' }, origin_project_id: 'p', created_by: 'x', created_at: new Date(0),
    };
    const f = (id: string, task: string, over: Partial<{ created_at: Date; task_ended_at: Date | null; involved: Set<string> }> = {}) => ({
      id, task_id: task, created_at: new Date('2026-10-02T00:00:00Z'), task_ended_at: new Date('2026-10-01T12:00:00Z'), involved: new Set(['stage:review']), ...over,
    });
    const three = [f('1', 'a'), f('2', 'b'), f('3', 'c')];
    expect(validationsDue([ke], three, [])).toEqual([{ code: 'KE-001', forensic_ids: ['1', '2', '3'] }]);
    expect(validationsDue([ke], three.slice(0, 2), [])).toEqual([]);
    expect(validationsDue([ke], [...three.slice(0, 2), f('3', 'c', { involved: new Set() })], [])).toEqual([]);
    expect(validationsDue([ke], [...three.slice(0, 2), f('3', 'c', { task_ended_at: new Date('2026-09-30T00:00:00Z') })], [])).toEqual([]);
    expect(validationsDue([ke], [...three.slice(0, 2), f('3', 'c', { created_at: new Date('2026-09-30T00:00:00Z') })], [])).toEqual([]);
    expect(validationsDue([ke], three, [{ ke_code: 'KE-001', forensic_id: '3' }])).toEqual([]);
    expect(validationsDue([{ ...ke, status: 'validated' as const }], three, [])).toEqual([]);
  });

  it('answers the list and the detail queries, and the API routes exist', async () => {
    const overview = await knownErrorsOverview(db());
    expect(overview.total).toBe(1);
    expect(overview.by_status).toEqual({ open: 0, fix_claimed: 0, validated: 1, recurred: 0 });
    // Each task counts through its latest forensic (A, B and C were last analysed clean: no current occurrence), but the
    // recurrence after the fix stays counted: the fix failing once is not forgotten when the task is analysed again.
    expect(overview.entries[0]).toMatchObject({ code: 'KE-001', version: 5, status: 'validated', occurrences: 0, last_seen: null, tasks: [], after_fix_recurrences: 1, pieces: ['stage:review'] });
    expect((await knownErrorsOverview(db(), { status: 'open' })).entries).toEqual([]);
    const detail = await knownErrorDetail(db(), 'KE-001');
    expect(detail.versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5]);
    expect(detail.occurrences).toHaveLength(3);
    expect(detail.occurrences.map((o) => o.task.code)).toEqual([tasks[0]?.code, tasks[1]?.code, tasks[2]?.code]);
    expect(detail.occurrences[0]).toMatchObject({ project: { id: projectId, name: 'Vault' }, current: false });
    expect(detail.occurrences[2]).toMatchObject({ after_fix: true, current: false });
    await expect(knownErrorDetail(db(), 'KE-404')).rejects.toThrow(/does not exist/);
    expect(QUERIES.find((q) => q.path === '/api/observability/known-errors.json')?.queryName).toBe('query.forensics');
    expect(QUERIES.find((q) => q.path === '/api/observability/known-errors/:code')?.queryName).toBe('query.forensics');
  });

  it('the vault tables are append-only', async () => {
    await expect(db().updateTable('known_errors').set({ title: 'x' }).where('code', '=', 'KE-001').execute()).rejects.toThrow();
    await expect(db().deleteFrom('known_error_occurrences').where('ke_code', '=', 'KE-001').execute()).rejects.toThrow();
  });
});

describe('the automatic forensic when a build request ends', () => {
  const drainFile = join(mkdtempSync(join(tmpdir(), 'dmg-drain-')), 'drain');
  let task: { id: string; code: string };
  let requestId = '';

  it('does nothing for a request that has not ended', async () => {
    task = tasks[3] as (typeof tasks)[number];
    requestId = await build(task, past(10), {});
    expect(await dueForensics(db(), EPOCH)).toEqual([]);
    const r = await sweepForensics(services(), { since: EPOCH });
    expect(r).toMatchObject({ due: 0, results: [], stopped: null });
  });

  it('waits while the drain flag is up', async () => {
    await db().updateTable('build_requests').set({ state: 'done', done_by: 'human:ana', done_at: past(10, 30).toISOString() as never }).where('id', '=', requestId).execute();
    process.env.DEMIURGO_DRAIN_FILE = drainFile;
    setDrain('test', drainFile);
    try {
      expect(await sweepForensics(services(), { since: EPOCH })).toMatchObject({ results: [], stopped: 'draining' });
    } finally {
      clearDrain(drainFile);
      delete process.env.DEMIURGO_DRAIN_FILE;
    }
    expect(await db().selectFrom('task_forensics').select('id').where('task_id', '=', task.id).execute()).toEqual([]);
  });

  it('skips quietly when no engine is assigned to the agent: no run, no error', async () => {
    // A null engine removes the group's choice (a new row: the latest wins); it is put back afterwards.
    const simulated = { provider: 'simulated', model: 'simulated', effort: null };
    await insertChoice(db(), { group: 'deep' }, null, 'human:test');
    try {
      const r = await sweepForensics(services(), { since: EPOCH });
      expect(r.stopped).toBe('refused');
      expect(r.results.map((x) => [x.code, x.status])).toEqual([[task.code, 'refused']]);
      expect(r.results[0]?.reason).toMatch(/Choose a model/);
    } finally {
      await insertChoice(db(), { group: 'deep' }, simulated, 'human:setup');
    }
    expect(await db().selectFrom('ai_runs').select('id').where('action', '=', 'task_forensics').where(sql<boolean>`scope->>'id' = ${task.id}`).execute()).toEqual([]);
  });

  it('runs the forensic of the task whose build request ended, records which request triggered it, and does not run it twice', async () => {
    const due = await dueForensics(db(), EPOCH);
    expect(due).toEqual([expect.objectContaining({ code: task.code, request_id: requestId, outcome: 'merged', project_id: projectId })]);
    const r = await sweepForensics(services(), { since: EPOCH });
    expect(r.stopped).toBeNull();
    expect(r.results.map((x) => [x.code, x.status, x.request_id])).toEqual([[task.code, 'analyzed', requestId]]);
    const row = await latestRow(task.id);
    expect(row.trigger_request_id).toBe(requestId);
    expect(row.request_ids).toEqual([requestId]);
    const event = await db().selectFrom('events').select(['actor', 'after']).where('command', '=', 'task_forensics.record').where('entity_id', '=', row.id).executeTakeFirstOrThrow();
    expect(event.actor.startsWith('system:task-forensics')).toBe(true);
    expect((event.after as { trigger_request: string }).trigger_request).toBe(requestId);
    const run = await db().selectFrom('ai_runs').select('requested_by').where('id', '=', row.ai_run_id).executeTakeFirstOrThrow();
    expect(run.requested_by.startsWith('system:forensics-sweeper')).toBe(true);
    expect(await dueForensics(db(), EPOCH)).toEqual([]);
    expect(await sweepForensics(services(), { since: EPOCH })).toMatchObject({ due: 0, results: [] });
  });

  it('a task whose analysis failed after its last activity is not retried by the sweep', async () => {
    // The task ends again right now: it is due until a run for it exists after that activity.
    const at = new Date();
    const again = await db()
      .insertInto('build_requests')
      .values({ project_id: projectId, task_id: task.id, task_version_id: (await latestRow(task.id)).task_version_id, brief: 'Again.', requested_by: 'human:ana', requested_at: at.toISOString() as never, state: 'done', done_by: 'human:ana', done_at: at.toISOString() as never })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect((await dueForensics(db(), EPOCH)).map((d) => d.request_id)).toEqual([again.id]);
    // The agent hands back an incomplete checklist: the run fails and stores nothing.
    script.current = (p) => {
      const out = DEFAULT_SCRIPTS.task_forensics(p) as Analysis;
      return { ...out, checklist: out.checklist.slice(1) };
    };
    try {
      const r = await sweepForensics(services(), { since: EPOCH });
      expect(r.results.map((x) => x.status)).toEqual(['failed']);
    } finally {
      script.current = null;
    }
    // The failed run is after the activity: the sweep leaves it for a person (`forensics run --force`) and does not loop.
    expect(await dueForensics(db(), EPOCH)).toEqual([]);
    expect(await sweepForensics(services(), { since: EPOCH })).toMatchObject({ due: 0, results: [] });
  });
});

describe('seeding the vault from the forensics that predate it', () => {
  it('builds entries and occurrences with the curator, attaches an item to the entry it matches, and has nothing left to seed', async () => {
    const [a, b] = tasks as [(typeof tasks)[number], (typeof tasks)[number]];
    const free = await db()
      .selectFrom('ai_runs')
      .select('id')
      .where('project_id', '=', projectId)
      .where('action', '<>', 'task_forensics')
      .where('id', 'not in', (qb) => qb.selectFrom('task_forensics').select('ai_run_id'))
      .orderBy('created_at')
      .limit(2)
      .execute();
    expect(free).toHaveLength(2);
    // Forensics written before the vault existed: their items have no known_error and no occurrence.
    const legacy = async (task: { id: string }, runId: string, errorClass: string) => {
      const version = await db().selectFrom('record_versions').select('id').where('record_id', '=', task.id).where('state', '=', 'approved').executeTakeFirstOrThrow();
      const item = { what: `Legacy finding of class ${errorClass}.`, evidence: 'build_steps: legacy', phase: 'P9', error_class: errorClass, cost: {}, at: null, known_error: null, new_error: null, recurrence_why: null };
      await executeCommand(services(), {
        command: 'task_forensics.record',
        actor: system('legacy'),
        projectId,
        data: {
          task_id: task.id,
          task_version_id: version.id,
          request_ids: [],
          ai_run_id: runId,
          analysis: { summary: 's', outcome: 'rework', timeline: [], went_well: [], went_wrong: [item], root_causes: [], improvements: [], lessons: [], checklist: [], catalog_marks: {} },
          evidence_hash: '0'.repeat(64),
          catalog_version: 'legacy',
          agent_version: 'legacy',
          engine: { provider: 'simulated', model: 'simulated', effort: null },
          task_ended_at: future(5).toISOString(),
        },
      });
    };
    await legacy(a, free[0]?.id ?? '', 'timeout');
    await legacy(b, free[1]?.id ?? '', 'E01');
    const entriesBefore = await keCount();
    const occurrencesBefore = (await occurrences('KE-001')).length;
    const r = await vaultSeed(services(), projectId);
    expect(r).toMatchObject({ status: 'seeded', entries_created: 1, occurrences_added: 2, remaining: 0 });
    expect(await keCount()).toBe(entriesBefore + 1);
    // The timeout item opened a new entry; the E01 item went to the entry the curator matched (KE-001).
    const created = await latestKnownError(db(), `KE-${String(entriesBefore + 1).padStart(3, '0')}`);
    expect(created).toMatchObject({ status: 'open', error_class: 'timeout', created_by: expect.stringContaining('known-error-curator') });
    expect((await occurrences('KE-001')).length).toBe(occurrencesBefore + 1);
    expect(await vaultSeed(services(), projectId)).toMatchObject({ status: 'nothing_to_seed', entries_created: 0, occurrences_added: 0 });
  });

  it('the curator output is checked: an item left out, covered twice or unknown is handed back', async () => {
    const run = await db().selectFrom('ai_runs').selectAll().where('action', '=', 'known_error_curate').executeTakeFirstOrThrow();
    const pack = (await db().selectFrom('context_packs').select('content').where('id', '=', run.context_pack_id ?? '').executeTakeFirstOrThrow()).content as {
      groups: { forensic: string; went_wrong: { index: number }[] }[];
    };
    const group = pack.groups[0];
    const cover = { forensic: group?.forensic ?? '', went_wrong_index: group?.went_wrong[0]?.index ?? 0 };
    const entry = { known_error: null, title: 't', description: 'd', error_class: 'E01', phase: 'P10', dimension: 'rules' as const, signature: 's', pieces: [], covers: [cover] };
    const check = (entries: unknown[]) => CHECKERS.known_error_curate?.({ db: db(), run, output: { entries } as never });
    const all = pack.groups.flatMap((g) => g.went_wrong.map((w) => ({ forensic: g.forensic, went_wrong_index: w.index })));
    expect(await check([{ ...entry, covers: all }])).toEqual([]);
    expect((await check([entry]))?.join(' ') ?? '').toMatch(/not covered/);
    expect((await check([{ ...entry, covers: all }, entry]))?.join(' ')).toContain('already covers');
    expect((await check([{ ...entry, covers: [{ forensic: 'f-nope', went_wrong_index: 0 }] }]))?.join(' ')).toContain('not in `groups`');
    expect((await check([{ ...entry, covers: all, known_error: 'KE-777' }]))?.join(' ')).toContain('KE-777');
    expect((await check([{ ...entry, covers: all, pieces: ['piece:ZZZ'] }]))?.join(' ')).toContain('piece:ZZZ');
  });
});
