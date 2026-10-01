// A task's whole page as one read model (its feature, build order, covered criteria, dependencies,
// provenance, development and history), for an approved task and for a draft proposed by the task
// planner. Both read the same shape so the page is the same. Nothing is stored: all derived.

import { DomainError, criterionState, type CriterionState, type TaskBuildState } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { currentOf, evidenceOf, featureDelivery, implementationOf, latestSize, originExploration, taskBuildOf } from './read.ts';
import { taskCoversOf } from './sizes.ts';

type Size = 'XS' | 'S' | 'M' | 'L' | 'XL';
type Ref = { ref: string; title: string; code: string | null; state: string };

export type ReviewComment = { path: string; line: number | null; severity: string; body: string };

export type TaskView = {
  draft: null | {
    proposal_id: string;
    batch_id: string;
    resolution: 'item' | 'package';
    state: 'pending' | 'accepted' | 'rejected';
    siblings: number;
  };
  code: string | null;
  title: string;
  state: string;
  version: { n: number; state: string; change_note: string | null } | null;
  goal: string;
  scope: string;
  size: Size | null;
  size_reason: string | null;
  split: string | null;
  walking_skeleton: boolean;
  feature: { code: string; version: number; title: string; current_version: number; epic: { code: string; title: string } | null };
  order: { n: number; of: number };
  covers: {
    code: string;
    title: string;
    given: string | null;
    when: string | null;
    then: string | null;
    statement: string;
    step: number | null;
    state: string;
  }[];
  depends_on: Ref[];
  blocks: Ref[];
  dod: { item: string; met: boolean }[];
  development: {
    branch: string | null;
    pr_url: string | null;
    pr_number: number | null;
    checks: { name: string; state: string }[];
    review: { verdict: string; summary: string; comments: ReviewComment[] } | null;
    evidence: { criterion: string; result: string; test_name: string | null }[];
  } | null;
  sources: { title: string; url: string | null; note: string | null }[];
  provenance: {
    proposed_by: { agent: string; run_id: string; engine: string | null } | null;
    thread: { id: string; title: string } | null;
    accepted_by: string | null;
    accepted_at: string | null;
    approved_at: string | null;
  };
  history: { n: number; state: string; change_note: string | null; created_at: string; author: string }[];
};

type Payload = {
  title?: string;
  sections?: { title: string; content: string }[];
  covers?: string[];
  size?: Size;
  size_reason?: string;
  split?: string;
  depends_on_titles?: string[];
  based_on?: { code: string; version: number };
  sources?: { title: string; url?: string; used_for?: string }[];
};

const iso = (d: unknown) => new Date(d as Date).toISOString();
const key = (t: string) => t.trim().toLowerCase();
const section = (sections: { title: string; content: string }[] | undefined, title: string) =>
  (sections ?? []).find((s) => s.title === title)?.content ?? '';
const SKELETON = /Walking skeleton:/;

/** The feature a task rests on, with its epic, its criteria and the tasks already built for it. */
async function featureOf(db: Db, projectId: string, code: string, version: number) {
  const rec = await db
    .selectFrom('records')
    .select(['id', 'code'])
    .where('project_id', '=', projectId)
    .where('code', '=', code)
    .executeTakeFirst();
  if (!rec) throw new DomainError('not_found', `Feature ${code} does not exist.`);
  const current = await currentOf(db, rec.id);
  const v =
    (await db
      .selectFrom('record_versions')
      .select(['id', 'n', 'title'])
      .where('record_id', '=', rec.id)
      .where('n', '=', version)
      .executeTakeFirst()) ??
    (await db
      .selectFrom('record_versions')
      .select(['id', 'n', 'title'])
      .where('record_id', '=', rec.id)
      .orderBy('n', 'desc')
      .executeTakeFirstOrThrow());
  const epicLink = await db
    .selectFrom('links')
    .innerJoin('record_versions as ev', 'ev.id', 'links.to_id')
    .innerJoin('records as epic', 'epic.id', 'ev.record_id')
    .select(['epic.code', 'ev.title'])
    .where('links.from_id', '=', v.id)
    .where('links.type', '=', 'based_on')
    .where('epic.type', '=', 'epic')
    .executeTakeFirst();
  const criteria = await db
    .selectFrom('criteria')
    .select(['id', 'code', 'title', 'statement', 'step', 'verification', 'given_text', 'when_text', 'then_text'])
    .where('record_version_id', '=', v.id)
    .orderBy('position')
    .execute();
  const delivery = await featureDelivery(db, projectId, rec.id, current);
  return {
    recordId: rec.id,
    feature: {
      code,
      version: v.n,
      title: v.title,
      current_version: current ?? v.n,
      epic: epicLink ? { code: epicLink.code, title: epicLink.title } : null,
    },
    criteria,
    delivery,
  };
}

type Feature = Awaited<ReturnType<typeof featureOf>>;

/** What each covered criterion looks like now: its Given/When/Then and how far it is. */
async function coversOf(db: Db, f: Feature, codes: readonly string[], reference: string | null = null) {
  const out: TaskView['covers'] = [];
  const evidence: NonNullable<TaskView['development']>['evidence'] = [];
  for (const code of codes) {
    const c = f.criteria.find((k) => k.code === code);
    if (!c) {
      out.push({ code, title: code, given: null, when: null, then: null, statement: '', step: null, state: 'not_started' });
      continue;
    }
    const e = await evidenceOf(db, c.id, { reference });
    const covering = f.delivery.tasks.filter((t) => t.covers.includes(code));
    const state: CriterionState = criterionState({ verification: c.verification, evidence: e, tasks: covering.map((t) => t.build) });
    out.push({
      code,
      title: c.title,
      given: c.given_text ?? null,
      when: c.when_text ?? null,
      then: c.then_text ?? null,
      statement: c.statement,
      step: c.step,
      state,
    });
    if (e) evidence.push({ criterion: code, result: e.result ?? 'pass', test_name: e.test_name });
  }
  return { covers: out, evidence };
}

/**
 * Every task of the feature by title, the ones built and the ones still proposed, with the titles each
 * waits for: what "depends on" and "blocks" are read from. A dependency accepted before its task
 * exists is a title only until then.
 */
async function poolOf(db: Db, projectId: string, f: Feature) {
  const pool: { ref: string; code: string | null; title: string; state: string; waits: Set<string> }[] = [];
  for (const t of f.delivery.tasks) {
    const rec = await db.selectFrom('records').select('id').where('project_id', '=', projectId).where('code', '=', t.code).executeTakeFirstOrThrow();
    const v = await shownVersion(db, rec.id);
    const waits = new Set<string>();
    if (v) {
      const linked = await db
        .selectFrom('links')
        .innerJoin('record_versions as dv', 'dv.id', 'links.to_id')
        .select('dv.title')
        .where('links.from_id', '=', v.id)
        .where('links.type', '=', 'depends_on')
        .execute();
      for (const l of linked) waits.add(key(l.title));
      const origin = v.origin as { type?: string; id?: string } | null;
      if (origin?.type === 'proposal' && origin.id) {
        const p = await db.selectFrom('proposals').select('payload').where('id', '=', origin.id).executeTakeFirst();
        for (const d of (p?.payload as Payload | undefined)?.depends_on_titles ?? []) waits.add(key(d));
      }
    }
    pool.push({ ref: t.code, code: t.code, title: t.title, state: t.build, waits });
  }
  const drafts = await db
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select(['proposals.id', 'proposals.payload'])
    .where('proposals.project_id', '=', projectId)
    .where('proposals.type', '=', 'design_record')
    .where('proposals.state', '=', 'pending')
    .where('proposal_batches.state', '=', 'pending')
    .orderBy('proposal_batches.created_at')
    .orderBy('proposals.position')
    .execute();
  for (const d of drafts) {
    const p = d.payload as Payload & { record_type?: string };
    if (p.record_type !== 'task' || p.based_on?.code !== f.feature.code) continue;
    pool.push({ ref: d.id, code: null, title: p.title ?? '', state: 'proposed', waits: new Set((p.depends_on_titles ?? []).map(key)) });
  }
  return pool;
}

async function shownVersion(db: Db, recordId: string) {
  const versions = await db.selectFrom('record_versions').selectAll().where('record_id', '=', recordId).where('state', '<>', 'discarded').execute();
  return versions.sort((a, b) => (a.state === 'approved' ? 1e6 : 0) + a.n - ((b.state === 'approved' ? 1e6 : 0) + b.n)).at(-1) ?? null;
}

function linksOf(pool: Awaited<ReturnType<typeof poolOf>>, self: { ref: string; title: string; waits: Set<string> }) {
  const others = pool.filter((p) => p.ref !== self.ref);
  const toRef = (p: (typeof pool)[number]): Ref => ({ ref: p.ref, title: p.title, code: p.code, state: p.state });
  return {
    depends_on: others.filter((p) => self.waits.has(key(p.title))).map(toRef),
    blocks: others.filter((p) => p.waits.has(key(self.title))).map(toRef),
  };
}

/** Who and when: the run behind a proposal (agent, engine) and the thread it came from. */
async function provenanceOf(db: Db, proposalId: string | null, versionId: string | null) {
  let proposed_by: TaskView['provenance']['proposed_by'] = null;
  let accepted_by: string | null = null;
  let accepted_at: string | null = null;
  if (proposalId) {
    const p = await db
      .selectFrom('proposals')
      .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
      .select(['proposal_batches.run_id', 'proposals.resolved_by', 'proposals.resolved_at'])
      .where('proposals.id', '=', proposalId)
      .executeTakeFirst();
    accepted_by = p?.resolved_by ?? null;
    accepted_at = p?.resolved_at ? iso(p.resolved_at) : null;
    if (p?.run_id) {
      const call = await db
        .selectFrom('agent_calls')
        .select(['agent', 'provider'])
        .where('run_id', '=', p.run_id)
        .orderBy('started_at', 'desc')
        .executeTakeFirst();
      const run = call ? null : await db.selectFrom('ai_runs').select(['action', 'provider']).where('id', '=', p.run_id).executeTakeFirst();
      proposed_by = { agent: call?.agent ?? run?.action ?? 'agent', run_id: p.run_id, engine: call?.provider ?? run?.provider ?? null };
    }
  }
  const exploration = versionId ? await originExploration(db, versionId) : await originOfProposal(db, proposalId);
  const thread = exploration
    ? await db.selectFrom('explorations').select(['id', 'purpose']).where('id', '=', exploration).executeTakeFirst()
    : undefined;
  return { proposed_by, thread: thread ? { id: thread.id, title: thread.purpose } : null, accepted_by, accepted_at };
}

async function originOfProposal(db: Db, proposalId: string | null): Promise<string | null> {
  if (!proposalId) return null;
  const p = await db
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select('proposal_batches.run_id')
    .where('proposals.id', '=', proposalId)
    .executeTakeFirst();
  if (!p?.run_id) return null;
  const run = await db.selectFrom('ai_runs').select('scope').where('id', '=', p.run_id).executeTakeFirst();
  const scope = run?.scope as { type?: string; id?: string } | undefined;
  if (scope?.type === 'exploration' && scope.id) return scope.id;
  // The task planner works from the approved feature: its thread is the one the feature came from.
  return scope?.type === 'record_version' && scope.id ? originExploration(db, scope.id) : null;
}

const sourcesOf = (raw: unknown): TaskView['sources'] =>
  ((raw ?? []) as { title?: string; url?: string; used_for?: string; note?: string }[]).map((s) => ({
    title: s.title ?? '',
    url: s.url ?? null,
    note: s.used_for ?? s.note ?? null,
  }));

const CHECK_STAGES: [string, string][] = [
  ['ci', 'ci'],
  ['demiurgo/review', 'review'],
  ['demiurgo/design', 'design'],
];

/**
 * The state of a check from its last step. `ok` is only green when the real result was: the CI
 * conclusion is `success` and the reviewer's verdict is `approve` (steps recorded before the
 * orchestrator told the truth could be `ok` with a red conclusion or a request for changes).
 */
function checkStateOf(stage: string, outcome: string, detail: unknown): string {
  if (outcome === 'started' || outcome === 'waiting') return 'pending';
  if (outcome !== 'ok') return 'failure';
  const d = (detail ?? {}) as { conclusion?: string | null; verdict?: string };
  if (stage === 'ci' && d.conclusion !== undefined && d.conclusion !== 'success') return 'failure';
  if (stage === 'review' && d.verdict !== undefined && d.verdict !== 'approve') return 'failure';
  return 'success';
}

/** The task's development panel (Jira's Development, Linear's linked PR): branch, PR, checks, review, evidence. */
async function developmentOf(
  db: Db,
  projectId: string,
  taskId: string,
  build: Awaited<ReturnType<typeof taskBuildOf>>,
  evidence: NonNullable<TaskView['development']>['evidence'],
) {
  const request = await db
    .selectFrom('build_requests')
    .select(['id', 'pr_number'])
    .where('project_id', '=', projectId)
    .where('task_id', '=', taskId)
    .orderBy('requested_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const checks: { name: string; state: string }[] = [];
  if (request) {
    const steps = await db
      .selectFrom('build_steps')
      .select(['attempt', 'stage', 'outcome', 'detail', 'created_at'])
      .where('build_request_id', '=', request.id)
      .orderBy('attempt')
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    for (const [name, stage] of CHECK_STAGES) {
      const last = steps.filter((s) => s.stage === stage).at(-1);
      if (!last) continue;
      checks.push({ name, state: checkStateOf(stage, last.outcome, last.detail) });
    }
  }
  if (!request && evidence.length === 0) return { development: null, checks };
  return {
    checks,
    development: {
      branch: build.branch,
      pr_url: build.pr_url,
      pr_number: request?.pr_number ?? null,
      checks,
      review: build.review ? { verdict: build.review.verdict, summary: build.review.summary, comments: build.review.comments } : null,
      evidence,
    },
  };
}

/** The task DoD (VISION «Tareas», our convention): covered criteria green in CI, PR reviewed and merged, and the three checks green. */
function dodOf(covers: TaskView['covers'], merged: boolean, checks: { name: string; state: string }[]) {
  const green = (name: string) => checks.some((c) => c.name === name && c.state === 'success');
  return [
    ...covers.map((c) => ({ item: `${c.code} verified in CI`, met: c.state === 'verified' })),
    { item: 'Pull request reviewed and merged', met: merged },
    { item: 'ci check green', met: green('ci') },
    { item: 'demiurgo/review check green', met: green('demiurgo/review') },
    { item: 'demiurgo/design check green', met: green('demiurgo/design') },
  ];
}

function orderOf(pool: Awaited<ReturnType<typeof poolOf>>, ref: string) {
  const i = pool.findIndex((p) => p.ref === ref);
  return { n: i < 0 ? pool.length + 1 : i + 1, of: Math.max(pool.length, 1) };
}

/** An approved task (a record with TSK-… code). */
export async function taskViewOfRecord(db: Db, projectId: string, recordId: string): Promise<TaskView | null> {
  const rec = await db.selectFrom('records').selectAll().where('id', '=', recordId).executeTakeFirstOrThrow();
  const versions = await db.selectFrom('record_versions').selectAll().where('record_id', '=', recordId).orderBy('n').execute();
  const shown = await shownVersion(db, recordId);
  if (!shown) return null;
  const basis = await db
    .selectFrom('links')
    .innerJoin('record_versions as fv', 'fv.id', 'links.to_id')
    .innerJoin('records as fr', 'fr.id', 'fv.record_id')
    .select(['fr.code', 'fv.n'])
    .where('links.from_id', '=', shown.id)
    .where('links.type', '=', 'based_on')
    .where('fr.type', '=', 'fdr')
    .executeTakeFirst();
  if (!basis) return null;
  const f = await featureOf(db, projectId, basis.code, basis.n);
  const codes = await taskCoversOf(db, recordId);
  // With a pull request, a criterion's state is the evidence of its current head commit.
  const pr = await db
    .selectFrom('build_requests')
    .select('head_sha')
    .where('project_id', '=', projectId)
    .where('task_id', '=', recordId)
    .where('pr_number', 'is not', null)
    .orderBy('requested_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const { covers, evidence } = await coversOf(db, f, codes, pr?.head_sha ?? null);
  const build = await taskBuildOf(db, projectId, recordId, (await implementationOf(db, recordId)) === 'implemented');
  const { development, checks } = await developmentOf(db, projectId, recordId, build, evidence);
  const pool = await poolOf(db, projectId, f);
  const self = pool.find((p) => p.ref === rec.code) ?? { ref: rec.code, title: shown.title, waits: new Set<string>() };
  const origin = shown.origin as { type?: string; id?: string } | null;
  const proposalId = origin?.type === 'proposal' && origin.id ? origin.id : null;
  const proposal = proposalId ? await db.selectFrom('proposals').select('payload').where('id', '=', proposalId).executeTakeFirst() : undefined;
  const payload = (proposal?.payload ?? {}) as Payload;
  const who = await provenanceOf(db, proposalId, shown.id);
  const sections = shown.sections as { title: string; content: string }[];
  const merged = build.state === 'merged';
  const version = { n: shown.n, state: shown.state, change_note: shown.change_note };
  return {
    draft: null,
    code: rec.code,
    title: shown.title,
    state: shown.state === 'approved' ? build.state : shown.state,
    version,
    goal: section(sections, 'Goal'),
    scope: section(sections, 'Scope'),
    size: (await latestSize(db, recordId)) as Size | null,
    size_reason: payload.size_reason ?? null,
    split: payload.split ?? null,
    walking_skeleton: SKELETON.test(section(sections, 'Scope')),
    feature: f.feature,
    order: orderOf(pool, rec.code),
    covers,
    ...linksOf(pool, self),
    dod: dodOf(covers, merged, checks),
    development,
    sources: sourcesOf(shown.practice_sources),
    provenance: {
      proposed_by: who.proposed_by,
      thread: who.thread,
      accepted_by: who.accepted_by ?? shown.author,
      accepted_at: who.accepted_at,
      approved_at: shown.approved_at ? iso(shown.approved_at) : null,
    },
    history: versions.map((v) => ({ n: v.n, state: v.state, change_note: v.change_note, created_at: iso(v.created_at), author: v.author })),
  };
}

/** A task proposed by the task planner, pending, accepted or rejected: the same page before it is a record. */
export async function taskDraftView(db: Db, projectId: string, proposalId: string): Promise<TaskView> {
  const p = await db
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select([
      'proposals.id',
      'proposals.batch_id',
      'proposals.position',
      'proposals.payload',
      'proposals.state',
      'proposals.resolution',
      'proposal_batches.resolution_mode',
    ])
    .where('proposals.project_id', '=', projectId)
    .where('proposals.id', '=', proposalId)
    .executeTakeFirst();
  const first = p?.payload as (Payload & { record_type?: string }) | undefined;
  if (!p || p.state === undefined || first?.record_type !== 'task' || !first.based_on)
    throw new DomainError('not_found', 'That is not a task proposal.');
  const resolution = p.resolution as { effect?: { code?: string }; edit?: Payload } | null;
  const payload: Payload = { ...first, ...(resolution?.edit ?? {}) };
  const based = payload.based_on ?? first.based_on;
  const f = await featureOf(db, projectId, based.code, based.version);
  const { covers } = await coversOf(db, f, payload.covers ?? []);
  const siblings = await db
    .selectFrom('proposals')
    .select(['id', 'position'])
    .where('batch_id', '=', p.batch_id)
    .where('type', '=', 'design_record')
    .orderBy('position')
    .execute();
  const pool = await poolOf(db, projectId, f);
  const self = { ref: p.id, title: payload.title ?? '', waits: new Set((payload.depends_on_titles ?? []).map(key)) };
  // Dependencies and dependants come from the pool (records and pending drafts) and, for a decided draft, from the siblings' payloads.
  const links = linksOf(pool, self);
  if (p.state !== 'pending') {
    const rows = await db.selectFrom('proposals').select(['id', 'payload', 'state']).where('batch_id', '=', p.batch_id).execute();
    const known = new Set([...links.depends_on, ...links.blocks].map((r) => key(r.title)));
    for (const r of rows) {
      const rp = r.payload as Payload;
      if (r.id === p.id || known.has(key(rp.title ?? ''))) continue;
      const ref: Ref = { ref: r.id, title: rp.title ?? '', code: null, state: r.state === 'rejected' ? 'rejected' : 'proposed' };
      if (self.waits.has(key(ref.title))) links.depends_on.push(ref);
      else if ((rp.depends_on_titles ?? []).some((t) => key(t) === key(self.title))) links.blocks.push(ref);
    }
  }
  const sections = payload.sections ?? [];
  const state: 'pending' | 'accepted' | 'rejected' =
    p.state === 'accepted' || p.state === 'accepted_edited' ? 'accepted' : p.state === 'pending' ? 'pending' : 'rejected';
  const code = resolution?.effect?.code ?? null;
  const who = await provenanceOf(db, p.id, null);
  const pending = state === 'pending';
  return {
    draft: {
      proposal_id: p.id,
      batch_id: p.batch_id,
      resolution: p.resolution_mode as 'item' | 'package',
      state,
      siblings: siblings.length,
    },
    code,
    title: payload.title ?? '',
    state: pending ? 'proposed' : state,
    version: null,
    goal: section(sections, 'Goal'),
    scope: section(sections, 'Scope'),
    size: payload.size ?? null,
    size_reason: payload.size_reason ?? null,
    split: payload.split ?? null,
    walking_skeleton: SKELETON.test(section(sections, 'Scope')),
    feature: f.feature,
    order: { n: Math.max(siblings.findIndex((s) => s.id === p.id), 0) + 1, of: Math.max(siblings.length, 1) },
    covers,
    ...links,
    dod: dodOf(covers, false, []),
    development: null,
    sources: sourcesOf(payload.sources),
    provenance: { proposed_by: who.proposed_by, thread: who.thread, accepted_by: who.accepted_by, accepted_at: who.accepted_at, approved_at: null },
    history: [],
  };
}
