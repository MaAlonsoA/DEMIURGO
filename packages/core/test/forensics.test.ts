// Task forensics end to end with the simulated provider (no Claude, no Codex): the evidence bundle (shape, bounds,
// determinism), the run applied through the bus, the checklist gate, the skip by evidence hash, the append-only rows,
// the playbooks aggregated per class and the overview.

import { human, type ActionOutput } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { CHECKERS } from '../src/actions/appliers.ts';
import { packContentOf } from '../src/actions/drafting.ts';
import { DEFAULT_SCRIPTS, createSimulatedProvider } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { EVIDENCE_MAX_CHARS, buildTaskEvidence } from '../src/forensics/evidence.ts';
import { catalogVersion, loadPieceCatalog } from '../src/forensics/catalog.ts';
import { forensicTasks, runForensics, runPlaybooks, runTaskForensic } from '../src/forensics/run.ts';
import { latestForensics, overviewOf, type ForensicRow } from '../src/forensics/store.ts';
import { forensicsOverview, taskForensicsOf } from '../src/queries/forensics.ts';
import { waitForKnowledge } from '../src/knowledge/workflows.ts';
import { recordDetail } from '../src/queries/read.ts';
import { QUERIES } from '../../api/src/queries.ts';
import { useEnvironment } from './support/env.ts';

/** A test can replace the simulated forensic's script (to hand back an incomplete checklist). */
const script: { current: ((p: Parameters<typeof DEFAULT_SCRIPTS.task_forensics>[0]) => unknown) | null } = { current: null };
const environment = useEnvironment({
  durable: true,
  providers: () => [createSimulatedProvider({ scripts: { task_forensics: (p) => (script.current ? script.current(p) : DEFAULT_SCRIPTS.task_forensics(p)) } })],
});

const ana = human('ana');
let projectId = '';
let tasks: { id: string; code: string }[] = [];
let bounced: { id: string; code: string };
let buildRequestId = '';
let codes: string[] = [];

type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });
const db = () => environment().services.db;

async function draftRun(action: string, scope: { type: string; id: string }, input?: unknown) {
  await waitForKnowledge(environment().services, projectId, 15_000);
  const r = await cmd('run.request', { action, scope, ...(input ? { input } : {}) });
  await waitForRun(r.entityId);
  return db().selectFrom('ai_runs').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
}

async function accepted(runId: string) {
  return db()
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select(['proposals.id', 'proposal_batches.id as batchId'])
    .where('proposal_batches.run_id', '=', runId)
    .orderBy('proposals.position')
    .execute();
}

beforeAll(async () => {
  delete process.env.TYPESAFE_API_KEY;
  projectId = (await executeCommand(environment().services, { command: 'project.create', actor: ana, data: { name: 'Forensics' } })).projectId;
  const thread = (await cmd('exploration.open', { purpose: 'Share recipes with friends' })).entityId;
  await cmd('message.post', { exploration_id: thread, text: 'People should share recipes.', respond: false });
  const epicRun = await draftRun('epic_plan', { type: 'exploration', id: thread });
  const epic = (await cmd('proposal.accept', { approve: false }, (await accepted(epicRun.id))[0]?.id)).result as { versionId: string };
  await cmd('record_version.approve', {}, epic.versionId);
  const planned = await db().selectFrom('planned_features').select(['code', 'name']).where('project_id', '=', projectId).orderBy('position').executeTakeFirstOrThrow();
  const featureThread = (
    await cmd('exploration.open', { purpose: `Design "${planned.name}" (${planned.code}): Walk the whole thing`, parent_id: thread, origin: { type: 'record_version', id: epic.versionId } })
  ).entityId;
  const featureRun = await draftRun('feature_design', { type: 'exploration', id: featureThread });
  const feature = (await cmd('proposal.accept', { approve: false }, (await accepted(featureRun.id))[0]?.id)).result as { versionId: string };
  await cmd('record_version.approve', {}, feature.versionId);
  const taskRun = await draftRun('task_plan', { type: 'record_version', id: feature.versionId });
  for (const p of await accepted(taskRun.id)) await cmd('proposal.accept', { approve: true }, p.id);
  const detail = await recordDetail(db(), projectId, planned.code);
  const first = detail.tasks?.[0];
  codes = first?.covers ?? [];
  expect(codes.length).toBeGreaterThan(0);
  tasks = await forensicTasks(environment().services, projectId);
  bounced = tasks.find((t) => t.code === first?.code) ?? (tasks[0] as { id: string; code: string });
  const taskVersion = await db().selectFrom('record_versions').select('id').where('record_id', '=', bounced.id).where('state', '=', 'approved').executeTakeFirstOrThrow();
  buildRequestId = (
    await db()
      .insertInto('build_requests')
      .values({ project_id: projectId, task_id: bounced.id, task_version_id: taskVersion.id, feature_version_id: feature.versionId, brief: `Build ${bounced.code}.`, requested_by: 'human:ana' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  const step = (attempt: number, stage: string, outcome: string, detail: unknown, minute: number) => ({
    project_id: projectId,
    build_request_id: buildRequestId,
    attempt,
    stage,
    outcome,
    detail: JSON.stringify(detail),
    created_at: new Date(Date.UTC(2026, 9, 1, 10, minute)).toISOString() as never,
  });
  await db()
    .insertInto('build_steps')
    .values([
      step(1, 'repo', 'started', { started_by: 'human:ana' }, 0),
      step(1, 'builder', 'failed', { provider: 'codex', failure_kind: 'timeout', error: 'The builder timed out after 30 minutes.' }, 5),
      step(2, 'builder', 'ok', { provider: 'claude', model: 'opus' }, 20),
      step(2, 'review', 'changes_requested', { verdict: 'request_changes' }, 30),
    ])
    .execute();
  // One review: it asks for changes because the diff has no test for the first criterion.
  const diff = `diff --git a/tests/x.test.ts b/tests/x.test.ts\n+++ b/tests/x.test.ts\n${codes.slice(1).map((c) => `+it('${c} does what the criterion says', () => {});`).join('\n')}\n`;
  await draftRun('pr_review', { type: 'build_request', id: buildRequestId }, { diff, pr_url: 'https://github.com/acme/recipes/pull/1', ci: { conclusion: 'success', tests: codes.slice(1).map((code) => ({ code, result: 'pass' })) } });
});

describe('the evidence bundle', () => {
  it('has the sections of how the task was designed and built, in a fixed order, under the bound', async () => {
    const b = await buildTaskEvidence(db(), projectId, bounced.id);
    expect(b.task.code).toBe(bounced.code);
    expect(b.request_ids).toEqual([buildRequestId]);
    expect(b.sections.map((s) => s.name)).toEqual([
      'definition',
      'feature',
      'task_versions',
      'criteria',
      'graph',
      'opinions',
      'queue_decisions',
      'build_requests',
      'build_steps',
      'pr_reviews',
      'tests',
      'merge_footprint',
      'harness_post_mortem',
      'harness_escapes',
      'issues',
      'events',
    ]);
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.total_chars).toBeLessThanOrEqual(EVIDENCE_MAX_CHARS);
    for (const s of b.sections) expect(() => JSON.parse(s.text.replace(/…\[section truncated\]$/, ''))).not.toThrow();
    const text = (name: string) => b.sections.find((s) => s.name === name)?.text ?? '';
    expect(text('task_versions')).toContain('"n":1');
    expect(text('criteria')).toContain(codes[0]);
    expect(text('build_steps')).toContain('The builder timed out');
    expect(text('build_steps')).toContain('changes_requested');
    expect(text('pr_reviews')).toContain('"verdict":"request_changes"');
    expect(text('pr_reviews')).toContain('blocking');
    expect(text('events')).toContain('pr_review.record');
  });

  it('is deterministic: the same rows give the same bundle and hash, and new evidence changes the hash', async () => {
    const a = await buildTaskEvidence(db(), projectId, bounced.id);
    const b = await buildTaskEvidence(db(), projectId, bounced.id);
    expect(b).toEqual(a);
    await db()
      .insertInto('build_steps')
      .values({ project_id: projectId, build_request_id: buildRequestId, attempt: 3, stage: 'withdraw', outcome: 'ok', detail: JSON.stringify({ reason: 'test' }), created_at: new Date(Date.UTC(2026, 9, 1, 11)).toISOString() as never })
      .execute();
    expect((await buildTaskEvidence(db(), projectId, bounced.id)).hash).not.toBe(a.hash);
  });

  it('cuts a section that is too big from the middle, with a note, and stays under the total', async () => {
    const before = await buildTaskEvidence(db(), projectId, bounced.id);
    const rows = Array.from({ length: 400 }, (_, i) => ({
      project_id: projectId,
      build_request_id: buildRequestId,
      attempt: 4,
      stage: 'ci',
      outcome: 'failed',
      detail: JSON.stringify({ error: `failure number ${i} ${'x'.repeat(900)}` }),
      created_at: new Date(Date.UTC(2026, 9, 2, 10, 0, i)).toISOString() as never,
    }));
    await db().insertInto('build_steps').values(rows).execute();
    const after = await buildTaskEvidence(db(), projectId, bounced.id);
    const steps = after.sections.find((s) => s.name === 'build_steps');
    expect(steps?.omitted_chars).toBeGreaterThan(0);
    expect(steps?.text).toContain('omitted_rows');
    expect(steps?.text.length).toBeLessThanOrEqual(28_000);
    // The start and the end of the story survive.
    expect(steps?.text).toContain('The builder timed out');
    expect(steps?.text).toContain('failure number 399');
    expect(after.total_chars).toBeLessThanOrEqual(EVIDENCE_MAX_CHARS);
    expect(after.hash).not.toBe(before.hash);
  });
});

describe('the forensic run', () => {
  it('is applied through the bus: one row with the analysis, its checklist complete, the evidence hash and the catalog version', async () => {
    const bundle = await buildTaskEvidence(db(), projectId, bounced.id);
    const r = await runTaskForensic(environment().services, projectId, bounced);
    expect(r.status).toBe('analyzed');
    const row = await db().selectFrom('task_forensics').selectAll().where('ai_run_id', '=', r.run_id ?? '').executeTakeFirstOrThrow();
    const analysis = row.analysis as ActionOutput<'task_forensics'> & { catalog_marks: Record<string, string> };
    const items = await loadPieceCatalog();
    expect(row).toMatchObject({ project_id: projectId, task_id: bounced.id, evidence_hash: bundle.hash, catalog_version: catalogVersion(items) });
    expect(row.request_ids).toEqual([buildRequestId]);
    expect(row.agent_version).toMatch(/^[0-9a-f]{12}$/);
    expect(row.engine).toMatchObject({ provider: 'simulated' });
    expect(analysis.outcome).toBe('rework');
    expect(analysis.checklist.map((c) => c.piece_id).toSorted()).toEqual(items.map((i) => i.id));
    expect(Object.keys(analysis.catalog_marks)).toHaveLength(items.length);
    expect(analysis.went_wrong[0]).toMatchObject({ error_class: 'E01', phase: 'P10' });
    const event = await db().selectFrom('events').select(['actor', 'entity_type', 'state_after']).where('command', '=', 'task_forensics.record').where('entity_id', '=', row.id).executeTakeFirstOrThrow();
    expect(event.actor.startsWith('system:')).toBe(true);
  });

  it('skips a task whose latest forensic has the same evidence hash, and runs again with --force or new evidence', async () => {
    const services = environment().services;
    const count = async () => Number((await db().selectFrom('task_forensics').select((eb) => eb.fn.countAll().as('n')).where('task_id', '=', bounced.id).executeTakeFirstOrThrow()).n);
    const before = await count();
    expect((await runTaskForensic(services, projectId, bounced)).status).toBe('skipped');
    expect(await count()).toBe(before);
    expect((await runTaskForensic(services, projectId, bounced, { force: true })).status).toBe('analyzed');
    expect(await count()).toBe(before + 1);
    await db()
      .insertInto('build_steps')
      .values({ project_id: projectId, build_request_id: buildRequestId, attempt: 5, stage: 'merge', outcome: 'failed', detail: JSON.stringify({ error: 'new evidence' }), created_at: new Date(Date.UTC(2026, 9, 3)).toISOString() as never })
      .execute();
    expect((await runTaskForensic(services, projectId, bounced)).status).toBe('analyzed');
    expect(await count()).toBe(before + 2);
  });

  it('rejects an output whose checklist misses a piece, has an unknown id or repeats one (the run does not complete and stores nothing)', async () => {
    const run = await draftRun('task_forensics', { type: 'task', id: bounced.id });
    const pack = await packContentOf<{ catalog: { id: string }[] }>(db(), run);
    const good = DEFAULT_SCRIPTS.task_forensics({ context: { content: pack } } as never) as ActionOutput<'task_forensics'>;
    const check = (checklist: typeof good.checklist) => CHECKERS.task_forensics?.({ db: db(), run, output: { ...good, checklist } as never });
    expect(await check(good.checklist)).toEqual([]);
    expect((await check(good.checklist.slice(1)))?.join(' ')).toContain(`Missing (1): ${good.checklist[0]?.piece_id}`);
    expect((await check([...good.checklist, { ...good.checklist[0]!, piece_id: 'piece:ZZZ' }]))?.join(' ')).toContain('piece:ZZZ');
    expect((await check([...good.checklist, good.checklist[0]!]))?.join(' ')).toContain('twice');
    expect((await check(good.checklist.map((c, i) => (i === 0 ? { ...c, involved: 'yes' as const, verdict: 'missing' as const, evidence: '' } : c))))?.join(' ')).toContain('needs the evidence');

    const rows = async () => Number((await db().selectFrom('task_forensics').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n);
    const before = await rows();
    script.current = (p) => {
      const out = DEFAULT_SCRIPTS.task_forensics(p) as ActionOutput<'task_forensics'>;
      return { ...out, checklist: out.checklist.slice(1) };
    };
    try {
      const incomplete = await draftRun('task_forensics', { type: 'task', id: bounced.id });
      expect(incomplete.state).not.toBe('completed');
      expect(await rows()).toBe(before);
    } finally {
      script.current = null;
    }
  });

  it('a stored forensic is append-only', async () => {
    const row = await db().selectFrom('task_forensics').select('id').where('task_id', '=', bounced.id).limit(1).executeTakeFirstOrThrow();
    await expect(db().updateTable('task_forensics').set({ evidence_hash: 'x' }).where('id', '=', row.id).execute()).rejects.toThrow();
    await expect(db().deleteFrom('task_forensics').where('id', '=', row.id).execute()).rejects.toThrow();
  });

  it('runs every task of the project one at a time when asked for all of them', async () => {
    const lines: string[] = [];
    const results = await runForensics(environment().services, projectId, { progress: (l) => lines.push(l) });
    expect(results.map((r) => r.code)).toEqual(tasks.map((t) => t.code));
    expect(results.every((r) => r.status === 'analyzed' || r.status === 'skipped')).toBe(true);
    expect(results.filter((r) => r.status === 'skipped').map((r) => r.code)).toEqual([bounced.code]);
    expect(lines.some((l) => l.includes(`${bounced.code}: skipped`))).toBe(true);
    expect(JSON.stringify(lines)).not.toMatch(/token|secret|password/i);
  });
});

describe('the playbooks and the overview', () => {
  it('writes one playbook per class seen in the latest forensics, versions it, and skips a class that rests on the same forensics', async () => {
    const services = environment().services;
    const results = await runPlaybooks(services, projectId, {});
    // Only the bounced task names a class (E01).
    expect(results.map((r) => [r.class_key, r.status])).toEqual([['E01', 'written']]);
    const rows = await db().selectFrom('forensic_playbooks').selectAll().where('class_key', '=', 'E01').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, project_id: projectId });
    const latest = (await latestForensics(db(), projectId)).filter((f) => f.analysis.went_wrong.length > 0);
    expect((rows[0]?.based_on as string[]).toSorted()).toEqual(latest.map((f) => f.id).toSorted());
    expect((rows[0]?.entry as { examples: string[] }).examples).toEqual([bounced.code]);
    expect((await runPlaybooks(services, projectId, {})).map((r) => r.status)).toEqual(['skipped']);
    expect((await runPlaybooks(services, projectId, { force: true })).map((r) => [r.class_key, r.status])).toEqual([['E01', 'written']]);
    expect((await db().selectFrom('forensic_playbooks').select('version').where('class_key', '=', 'E01').orderBy('version').execute()).map((r) => r.version)).toEqual([1, 2]);
    await expect(db().updateTable('forensic_playbooks').set({ version: 9 }).where('id', '=', rows[0]?.id ?? '').execute()).rejects.toThrow();
  });

  it('answers the task and overview queries with the latest of each, and the API routes exist', async () => {
    const view = await taskForensicsOf(db(), projectId, bounced.code);
    expect(view.task.code).toBe(bounced.code);
    expect(view.forensics.length).toBeGreaterThanOrEqual(3);
    expect(view.forensics.map((f) => f.created_at)).toEqual(view.forensics.map((f) => f.created_at).toSorted().reverse());
    const overview = await forensicsOverview(db(), projectId);
    expect(overview.tasks.map((t) => t.code)).toEqual(tasks.map((t) => t.code));
    expect(overview.by_class[0]).toMatchObject({ class: 'E01', playbook_version: 2 });
    expect(overview.by_piece.find((p) => p.piece_id === 'stage:review')).toMatchObject({ contributed_to_error: 1 });
    expect(overview.playbooks.map((p) => [p.class_key, p.version])).toEqual([['E01', 2]]);
    expect(QUERIES.find((q) => q.path === '/api/projects/:projectId/tasks/:code/forensics')?.queryName).toBe('query.forensics');
    expect(QUERIES.find((q) => q.path === '/api/projects/:projectId/observability/forensics.json')?.queryName).toBe('query.forensics');
    await expect(taskForensicsOf(db(), projectId, 'TSK-NOP-999')).rejects.toThrow();
  });
});

const analysis = (over: Partial<ActionOutput<'task_forensics'>> = {}): ForensicRow['analysis'] => ({
  summary: 's',
  outcome: 'rework',
  timeline: [],
  went_well: [],
  went_wrong: [],
  root_causes: [],
  improvements: [],
  lessons: [],
  checklist: [],
  ...over,
});
const row = (code: string, catalog_version: string, a: ForensicRow['analysis'], at: number): ForensicRow => ({
  id: `f-${code}-${at}`,
  task_id: code,
  code,
  task_version_id: 'v',
  request_ids: [],
  ai_run_id: 'r',
  evidence_hash: 'h',
  catalog_version,
  agent_version: 'a',
  engine: {},
  created_at: new Date(at),
  analysis: a,
});

const noVault = { at: null, known_error: null, new_error: null, recurrence_why: null };

describe('overviewOf', () => {
  const improvement = (priority: 'high' | 'medium' | 'low', target: string, cls = 'E01') => ({ change: `change ${target}`, dimension: 'rules' as const, target, expected_effect: 'x', source: 'convención nuestra', priority, playbook_class: cls });
  const check = (piece_id: string, verdict: 'worked' | 'contributed_to_error' | 'could_have_prevented' | 'missing' | 'not_applicable') => ({ piece_id, involved: 'yes' as const, verdict, note: 'n', evidence: 'e' });

  it('counts the checklist verdicts only across the newest catalog, ranks improvements by frequency times priority and counts by class and dimension', () => {
    const rows = [
      row('TSK-A-001', 'new', analysis({ went_wrong: [{ what: 'w', evidence: 'e', phase: 'P10', error_class: 'E01', cost: { attempts: 2, minutes: 10 }, ...noVault }], root_causes: [{ cause: 'c', dimension: 'jev', where: 'jev:testability', why: 'y', evidence: 'e' }], improvements: [improvement('high', 'piece:B04'), improvement('low', 'piece:B08', 'E08')], checklist: [check('piece:B04', 'could_have_prevented'), check('piece:B08', 'worked')] }), 2000),
      row('TSK-B-001', 'new', analysis({ went_wrong: [{ what: 'w', evidence: 'e', phase: 'P10', error_class: 'E01', cost: { attempts: 1, usd: 1.5 }, ...noVault }], improvements: [improvement('medium', 'Piece:B04')], checklist: [check('piece:B04', 'contributed_to_error'), check('piece:B08', 'worked')] }), 3000),
      row('TSK-C-001', 'old', analysis({ checklist: [check('piece:B04', 'missing')] }), 1000),
    ];
    const o = overviewOf(rows, []);
    expect(o.catalog_version).toBe('new');
    expect(o.catalog_excluded_tasks).toEqual(['TSK-C-001']);
    const b04 = o.by_piece.find((p) => p.piece_id === 'piece:B04');
    expect(b04).toMatchObject({ tasks: 2, could_have_prevented: 1, contributed_to_error: 1, missing: 0 });
    expect(o.by_piece[0]?.piece_id).toBe('piece:B04');
    expect(o.improvements[0]).toMatchObject({ target: 'piece:B04', frequency: 2, score: 5, priority: 'high', tasks: ['TSK-A-001', 'TSK-B-001'] });
    expect(o.improvements[1]).toMatchObject({ target: 'piece:B08', frequency: 1, score: 1 });
    expect(o.by_class[0]).toMatchObject({ class: 'E01', occurrences: 2, tasks: 2, attempts: 3, minutes: 10, usd: 1.5 });
    expect(o.by_dimension).toEqual([{ dimension: 'rules', root_causes: 0, improvements: 3, tasks: 2 }, { dimension: 'jev', root_causes: 1, improvements: 0, tasks: 1 }]);
    expect(o.tasks.map((t) => t.code)).toEqual(['TSK-A-001', 'TSK-B-001', 'TSK-C-001']);
  });
});
