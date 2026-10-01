// Dependencies between tasks, not between whole features. Practice: dependencies between backlog items at story
// level, as «is blocked by» issue links in Jira or Linear (a story waits for the stories it needs, not for the whole
// epic that holds them). Our convention (not a published rule): Jev judges each pair (task A, unmerged task B of a
// feature A's feature needs or A depends on) with one Noul, and A waits for B when p >= 0.5, the same STRONG
// threshold «Build the queue» uses for files (build/auto.ts STRONG_FILE_P), or when there is no opinion yet
// (conservative: as before this existed, the task waits for the whole feature). An explicit task-to-task
// `depends_on` link always counts and is never asked. The read path (queries/task-deps.ts) only reads the stored
// opinions through `loadTaskNeeds`; `ensureTaskNeeds` is what calls Jev, from the queue, and without TYPESAFE_API_KEY
// it does nothing, so readiness stays as it was.

import { createHash } from 'node:crypto';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import type { Db } from '../db/connection.ts';
import type { Services } from '../services.ts';
import { jevAllowed } from './aspect.ts';
import { recordedCall } from './calls.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';
import { questionVersion } from './question-version.ts';
import { type TaskObject, loadTaskObject } from './task-input.ts';

/** A waits for B from this probability (our convention; the same value as STRONG_FILE_P in build/auto.ts). */
export const TASK_NEED_THRESHOLD = 0.5;
/** Candidates asked in one request (one Noul each). */
const MAX_CANDIDATES_PER_REQUEST = 20;

const QUESTION =
  'Does `task` need something that `candidates[{i}]` builds (a screen, an endpoint, a table, a component or data) to exist before `task` can be built and its acceptance criteria checked?';

export const TASK_NEEDS_QUESTION_VERSION = questionVersion('task_needs.need_noul', QUESTION);

/**
 * Whether task A waits for the unmerged task B: an explicit link always; otherwise the latest opinion
 * (`p`, undefined when there is none yet) decides, and no opinion means it waits (conservative).
 */
export function taskNeedsWait(p: number | undefined, explicit = false): boolean {
  return explicit || p === undefined || p >= TASK_NEED_THRESHOLD;
}

type Client = Pick<TypeSafeClient, 'systemOne'>;

export type TaskNeedOpinion = { p: number; input_hash: string };

/** The key of a pair in the maps below: the version of A, then the version of B. */
export const needKey = (versionId: string, neededVersionId: string): string => `${versionId}|${neededVersionId}`;

/** The latest opinion of each pair with the current question (key: `needKey`). Pure read: it never calls Jev. */
export async function loadTaskNeeds(db: Db, projectId: string): Promise<Map<string, TaskNeedOpinion>> {
  const rows = await db
    .selectFrom('task_need_opinions')
    .select(['record_version_id', 'needed_version_id', 'p', 'input_hash'])
    .where('project_id', '=', projectId)
    .where('question_version', '=', TASK_NEEDS_QUESTION_VERSION)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const out = new Map<string, TaskNeedOpinion>();
  for (const r of rows) {
    const k = needKey(r.record_version_id, r.needed_version_id);
    if (!out.has(k)) out.set(k, { p: r.p, input_hash: r.input_hash });
  }
  return out;
}

type Candidate = { recordId: string; versionId: string; code: string; feature: string; featureTitle: string };
type Subject = Candidate & { candidates: Candidate[] };

/** The candidate pairs: for each task among `codes`, the approved unmerged tasks of the features it needs or depends on. */
async function loadSubjects(db: Db, projectId: string, codes: string[]): Promise<Subject[]> {
  const approved = await db
    .selectFrom('records as r')
    .innerJoin('record_versions as v', 'v.record_id', 'r.id')
    .select(['r.id as recordId', 'r.code', 'r.type', 'v.id as versionId', 'v.n', 'v.title'])
    .where('r.project_id', '=', projectId)
    .where('r.type', 'in', ['task', 'fdr'])
    .where('v.state', '=', 'approved')
    .orderBy('v.n', 'desc')
    .execute();
  const latest = new Map<string, (typeof approved)[number]>();
  for (const v of approved) if (!latest.has(v.recordId)) latest.set(v.recordId, v);
  const byCode = new Map([...latest.values()].map((v) => [v.code, v]));
  const edges = await db
    .selectFrom('links')
    .innerJoin('record_versions as fv', 'fv.id', 'links.from_id')
    .innerJoin('records as fr', 'fr.id', 'fv.record_id')
    .innerJoin('record_versions as tv', 'tv.id', 'links.to_id')
    .innerJoin('records as tr', 'tr.id', 'tv.record_id')
    .select(['links.type as type', 'links.from_id as fromId', 'fr.code as fromCode', 'fr.type as fromType', 'tr.code as toCode', 'tr.type as toType'])
    .where('links.project_id', '=', projectId)
    .where('links.type', 'in', ['based_on', 'depends_on'])
    .where('links.state', '!=', 'obsolete')
    .execute();
  // Only the links of each record's latest approved version count.
  const mine = edges.filter((e) => [...latest.values()].some((v) => v.versionId === e.fromId));
  const featureOf = new Map<string, string>(); // task code -> feature code
  const needs = new Map<string, Set<string>>(); // feature code -> features it needs
  const dependsOn = new Map<string, Set<string>>(); // task code -> features it depends on
  const explicit = new Map<string, Set<string>>(); // task code -> task codes it depends on
  const add = (m: Map<string, Set<string>>, k: string, v: string) => m.set(k, (m.get(k) ?? new Set()).add(v));
  for (const e of mine) {
    if (e.type === 'based_on' && e.fromType === 'task' && e.toType === 'fdr') featureOf.set(e.fromCode, e.toCode);
    else if (e.type === 'based_on' && e.fromType === 'fdr' && e.toType === 'fdr') add(needs, e.fromCode, e.toCode);
    else if (e.type === 'depends_on' && e.fromType === 'task' && e.toType === 'fdr') add(dependsOn, e.fromCode, e.toCode);
    else if (e.type === 'depends_on' && e.fromType === 'task' && e.toType === 'task') add(explicit, e.fromCode, e.toCode);
  }
  const tasksOf = new Map<string, string[]>(); // feature code -> approved task codes
  for (const [task, feature] of featureOf) if (byCode.get(task)?.type === 'task') tasksOf.set(feature, [...(tasksOf.get(feature) ?? []), task]);
  // Loaded on use: queries/read.ts reaches this module through task-deps.ts, so a static import would be a cycle.
  const { mergedBuildOf } = await import('../queries/read.ts');
  const merged = new Map<string, boolean>();
  const isMerged = async (code: string): Promise<boolean> => {
    let m = merged.get(code);
    if (m === undefined) {
      const rec = byCode.get(code);
      m = rec ? !!(await mergedBuildOf(db, rec.recordId)) : false;
      merged.set(code, m);
    }
    return m;
  };
  const toCandidate = (code: string): Candidate | null => {
    const t = byCode.get(code);
    const feature = featureOf.get(code);
    const f = feature ? byCode.get(feature) : undefined;
    if (!t || !feature) return null;
    return { recordId: t.recordId, versionId: t.versionId, code, feature, featureTitle: f?.title ?? '' };
  };
  const out: Subject[] = [];
  for (const code of codes) {
    const a = toCandidate(code);
    if (!a) continue;
    const features = new Set([...(needs.get(a.feature) ?? []), ...(dependsOn.get(code) ?? [])]);
    features.delete(a.feature);
    const candidates: Candidate[] = [];
    for (const f of features) {
      for (const b of tasksOf.get(f) ?? []) {
        if (b === code || explicit.get(code)?.has(b) || (await isMerged(b))) continue;
        const c = toCandidate(b);
        if (c) candidates.push(c);
      }
    }
    if (candidates.length > 0) out.push({ ...a, candidates });
  }
  return out;
}

type Pair = { subject: Candidate; candidate: Candidate; input_hash: string };

function hashOf(a: TaskObject, aFeature: string, b: TaskObject, bFeature: string, model: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ task: a, feature: aFeature, candidate: b, candidate_feature: bFeature, model, question_version: TASK_NEEDS_QUESTION_VERSION }))
    .digest('hex');
}

/** The request for one task and some candidates: the state holds both and each Noul points at `candidates[i]`. */
export function buildNeedsRequest(task: TaskObject, feature: string, candidates: { object: TaskObject; feature: string }[]) {
  const state = {
    task: { ...task, feature },
    candidates: candidates.map((c) => ({ ...c.object, feature: c.feature })),
  };
  const questions: Record<string, ReturnType<typeof noul>> = {};
  candidates.forEach((_, i) => {
    questions[`needs_${i}`] = noul(QUESTION.replace('{i}', String(i)), {
      true: {
        what: 'The task cannot be built or its criteria checked until the candidate task has built something it uses.',
        examples: ['A task that lists saved foods needs the task that creates the food table', 'A task that edits a meal needs the screen the candidate task builds to open it'],
      },
      false: {
        what: 'The task can be built and checked with what already exists, or the two only touch the same area.',
        examples: ['Two tasks of different screens that share only a feature', 'A task about validation messages and a task that adds an export button'],
      },
    });
  });
  return { state, questions };
}

export type NeedsDeps = {
  /** Tests pass a fake client; by default it is the TypeSafe API with the key. */
  client?: Client;
};

/**
 * Jev's opinion on every pair (task among `codes`, unmerged candidate task) that has none yet for the current versions,
 * the current question and the same input. «Build the queue» calls it before choosing. Never throws; without
 * TYPESAFE_API_KEY it does nothing. Returns the number of pairs judged.
 */
export async function ensureTaskNeeds(services: Services, projectId: string, codes: string[], deps: NeedsDeps = {}): Promise<number> {
  if (!jevAllowed() || codes.length === 0) return 0;
  try {
    const subjects = await loadSubjects(services.db, projectId, codes);
    if (subjects.length === 0) return 0;
    const known = await loadTaskNeeds(services.db, projectId);
    const model = JEV_DEFAULT_MODEL;
    const client = deps.client ?? new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: model, timeout: 30_000 });
    const objects = new Map<string, TaskObject | null>();
    const objectOf = async (c: Candidate): Promise<TaskObject | null> => {
      if (!objects.has(c.versionId)) objects.set(c.versionId, await loadTaskObject(services.db, c.recordId, c.versionId));
      return objects.get(c.versionId) ?? null;
    };
    let judged = 0;
    for (const s of subjects) {
      const a = await objectOf(s);
      if (!a) continue;
      const missing: { pair: Pair; object: TaskObject }[] = [];
      for (const c of s.candidates) {
        const b = await objectOf(c);
        if (!b) continue;
        const input_hash = hashOf(a, s.featureTitle, b, c.featureTitle, model);
        if (known.get(needKey(s.versionId, c.versionId))?.input_hash === input_hash) continue;
        missing.push({ pair: { subject: s, candidate: c, input_hash }, object: b });
      }
      for (let at = 0; at < missing.length; at += MAX_CANDIDATES_PER_REQUEST) {
        const chunk = missing.slice(at, at + MAX_CANDIDATES_PER_REQUEST);
        try {
          let tokens = 0;
          const answers = await recordedCall(
            services.db,
            { projectId, question: 'task_needs', questionVersion: TASK_NEEDS_QUESTION_VERSION, judgmentTable: 'task_need_opinions', model },
            async (note) => {
              const { state, questions } = buildNeedsRequest(a, s.featureTitle, chunk.map((m) => ({ object: m.object, feature: m.pair.candidate.featureTitle })));
              const r = await client.systemOne({ state, questions, model });
              tokens += r.usage.input_tokens;
              note(r.usage.input_tokens);
              return r.answers as Record<string, { noul?: number } | undefined>;
            },
          );
          const rows = chunk.flatMap((m, i) => {
            const v = answers[`needs_${i}`]?.noul;
            return typeof v === 'number' && !Number.isNaN(v)
              ? [
                  {
                    project_id: projectId,
                    record_id: s.recordId,
                    record_version_id: s.versionId,
                    needed_record_id: m.pair.candidate.recordId,
                    needed_version_id: m.pair.candidate.versionId,
                    p: Math.min(1, Math.max(0, v)),
                    classifier_id: `jev@${model}`,
                    input_hash: m.pair.input_hash,
                    question_version: TASK_NEEDS_QUESTION_VERSION,
                  },
                ]
              : [];
          });
          if (rows.length > 0) await services.db.insertInto('task_need_opinions').values(rows).execute();
          judged += rows.length;
          services.logger.info('Jev judged what a task needs from other tasks', { projectId, task: s.code, pairs: rows.length, input_tokens: tokens, usd: jevCostUsd(tokens) });
        } catch (err) {
          services.logger.error('Jev could not judge what a task needs from other tasks', { task: s.code, error: String(err) });
        }
      }
    }
    return judged;
  } catch (err) {
    services.logger.error('Jev could not fill in the missing task needs', { projectId, error: String(err) });
    return 0;
  }
}
