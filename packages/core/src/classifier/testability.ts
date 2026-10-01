// Jev's check of what a task asks of its builder (H97): before a task is built, can each automatic
// criterion it covers be verified by an automated test in the project's CI, or does it need a person,
// production, a real device, or a part of another feature that is not built yet? Flagging those early
// saves builder + CI + review loops that can never end well.
//
// One System One request per task (speculative fan-out, https://docs.typesafe.ai/patterns/fan-out):
// all questions share the same state, so they go together and are answered in parallel. Per automatic
// criterion: two Nouls (needs production or a person? needs an unbuilt feature?) and one Choice (which
// kind of need it is). The questions point at `criteria_covered[i]` instead of repeating the text, and
// the state says what the project's CI really runs (`project_stack.ci`, read from its repository) and
// which features are built. The state and questions are the "T3" variant of the A/B audit of
// 01-10-2026 (35 criteria, real Jev calls): see classifier/testability-policy.ts. The raw
// probabilities are stored (derived data, recomputable) and the policy turns them into a warning when
// read. It runs after the commit, never blocks, never changes the criterion or the task (the model
// proposes, the person decides), and without TYPESAFE_API_KEY it does nothing.

import { createHash } from 'node:crypto';
import { TypeSafeClient, choice, noul } from '@typesafe-ai/sdk';
import type { Db } from '../db/connection.ts';
import { implementationOf } from '../queries/read.ts';
import { taskCoversOf } from '../queries/sizes.ts';
import { loadTaskDependencies } from '../queries/task-deps.ts';
import type { Services } from '../services.ts';
import { jevAllowed } from './aspect.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';
import { type ProjectStack, loadRepoContext } from './repo-context.ts';
import { type NeedsKind, type TestabilityProbabilities, isNeedsKind } from './testability-policy.ts';

export * from './testability-policy.ts';

/** A convention of ours: criteria per request, to keep one request's questions in a sane number. */
export const MAX_CRITERIA_PER_REQUEST = 20;
const MAX_FEATURES = 60;
const MAX_DECISIONS = 30;
const MAX_TEXT = 3000;

export type TestabilityCriterion = { code: string; statement: string; verification: string };
export type TestabilityInput = {
  /** The task's code, for the state; omitted when unknown. */
  taskCode?: string;
  title: string;
  goal: string;
  scope: string;
  criteria: TestabilityCriterion[];
  /** Codes of the tasks and features its plan declares it depends on. */
  declaredDependencies?: string[];
  /** The feature the task builds part of: its title, Goal and Scope. */
  featureBeingBuilt?: { code: string; title: string; goal: string; scope: string };
  /** Titles of the project's approved decisions (stack and hosting hints). */
  decisions: string[];
  /** The project's other features. A feature is built once any of its tasks was merged. */
  features: { code: string; title: string; built: boolean }[];
  /** What the project's CI runs, read from its repository; absent when the repository is unavailable. */
  projectStack?: ProjectStack | null;
};
export type TestabilityJudgment = TestabilityProbabilities & { code: string; needs: NeedsKind; input_hash: string };

type Client = Pick<TypeSafeClient, 'systemOne'>;

const QUESTION_KEYS = ['needs_outside_ci', 'needs_unbuilt_feature', 'needs_kind'] as const;

/** The three questions about `criteria_covered[i]`; `stack` says whether the state carries `project_stack`. */
function questionsFor(i: number, stack: boolean) {
  const ci = (question: string): Record<string, string> => (stack ? { question, focus: '`project_stack.ci` describes what CI can run.' } : { question });
  return {
    needs_outside_ci: noul(
      ci(`Does checking \`criteria_covered[${i}]\`, as \`task\` scopes the work, need a deployed environment, real devices or networks, real third-party infrastructure, or a person's judgement?`),
      {
        true: {
          what: 'The check only means something outside CI.',
          examples: [
            'Measure save time on the deployed Vercel Hobby and Neon Free environment',
            'Restart and replace the Neon compute and compare with an operation log',
            'An audit with a phone screen reader',
          ],
        },
        false: {
          what: 'A test on the CI machine with the local database and fakes is enough.',
          examples: [
            'Server validation rejects calories of zero',
            'The day view shows 800 kcal remaining for the example values',
            'An end-to-end test with the Open Food Facts fake returning an error',
          ],
        },
      },
    ),
    needs_unbuilt_feature: noul(
      {
        question: `Does the Given, When or Then of \`criteria_covered[${i}]\` need data, a screen or behaviour that only a feature in \`features_not_built\` provides, and that is not part of \`feature_being_built\` or \`features_built\`?`,
        focus: 'Look for nouns in the criterion such as a workout, a session, an export or a weekly summary, and check which feature creates them.',
      },
      {
        true: {
          what: 'Setting up or observing the criterion needs something only an unbuilt feature creates.',
          examples: [
            'Given a saved workout with calories burned, when only the meals features are built',
            'Given an exported file, when the export feature is not built',
          ],
        },
        false: {
          what: 'Everything it needs comes from this task, its feature or features already built.',
          examples: [
            'Given saved foods and goals, when meals and goals are built',
            'Given a product found in the Open Food Facts search, when that search is built',
          ],
        },
      },
    ),
    needs_kind: choice(
      ci(`What does checking \`criteria_covered[${i}]\` need, as \`task\` scopes the work?`),
      {
        ci_automated: {
          what: 'An automated test on the CI machine (local app, ephemeral database, fakes for external services) decides it.',
          examples: ['Playwright saves a food and checks it after reload', 'A unit test of remaining calories'],
        },
        needs_production: {
          what: 'A deployed environment, real hosting, network or provider behaviour.',
          examples: ['p95 save time on Vercel and Neon with cold starts', 'Recovery drill restarting the Neon compute'],
        },
        needs_person: { what: 'A person must use or judge it.', examples: ['Phone screen reader audit', 'Readability check by eye'] },
        needs_unbuilt_part: {
          what: 'Data, a screen or behaviour from a feature in `features_not_built`.',
          examples: ['Given a saved workout, when workouts are not built'],
        },
      },
    ),
  };
}

/** The one request of a task: the shared state and every question about every automatic criterion. */
export function buildTestabilityRequest(input: TestabilityInput, criteria: readonly TestabilityCriterion[]) {
  const stack = !!input.projectStack;
  const feature = input.featureBeingBuilt;
  const state = {
    task: {
      ...(input.taskCode ? { code: input.taskCode } : {}),
      title: input.title,
      goal: input.goal.slice(0, MAX_TEXT),
      scope: input.scope.slice(0, MAX_TEXT),
      declared_dependencies: input.declaredDependencies ?? [],
    },
    criteria_covered: input.criteria.map((c) => ({ code: c.code, statement: c.statement })),
    ...(feature ? { feature_being_built: { code: feature.code, title: feature.title, goal: feature.goal.slice(0, MAX_TEXT), scope: feature.scope.slice(0, MAX_TEXT) } } : {}),
    ...(input.projectStack ? { project_stack: input.projectStack } : {}),
    project_decisions: input.decisions,
    features_built: input.features.filter((f) => f.built).map((f) => `${f.code}: ${f.title}`),
    features_not_built: input.features.filter((f) => !f.built).map((f) => `${f.code}: ${f.title}`),
  };
  const questions: Record<string, ReturnType<typeof noul> | ReturnType<typeof choice>> = {};
  criteria.forEach((c, n) => {
    // The question points at the criterion by its place in `criteria_covered`, which lists every covered one.
    const at = input.criteria.findIndex((x) => x.code === c.code);
    const q = questionsFor(at < 0 ? n : at, stack);
    for (const k of QUESTION_KEYS) questions[`${k}_${n}`] = q[k];
  });
  return { state, questions };
}

function hashOf(state: unknown, criterion: TestabilityCriterion, model: string): string {
  return createHash('sha256').update(JSON.stringify({ state, criterion: criterion.statement, model })).digest('hex');
}

/** Asks Jev about the automatic criteria of a task: one request per `MAX_CRITERIA_PER_REQUEST` (one in practice). */
export async function judgeTestability(
  client: Client,
  input: TestabilityInput,
  model: string = JEV_DEFAULT_MODEL,
  onUsage?: (inputTokens: number) => void,
): Promise<TestabilityJudgment[]> {
  const automatic = input.criteria.filter((c) => c.verification === 'automatic');
  const out: TestabilityJudgment[] = [];
  for (let at = 0; at < automatic.length; at += MAX_CRITERIA_PER_REQUEST) {
    const chunk = automatic.slice(at, at + MAX_CRITERIA_PER_REQUEST);
    const { state, questions } = buildTestabilityRequest(input, chunk);
    const r = await client.systemOne({ state, questions, model });
    onUsage?.(r.usage.input_tokens);
    const answers = r.answers as Record<string, { noul?: number; choice?: string } | undefined>;
    chunk.forEach((c, i) => {
      const probability = (k: 'needs_outside_ci' | 'needs_unbuilt_feature'): number => {
        const v = answers[`${k}_${i}`]?.noul;
        if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`Jev: ${c.code} came back without an answer to ${k}.`);
        return v;
      };
      const needs = answers[`needs_kind_${i}`]?.choice;
      if (!isNeedsKind(needs)) throw new Error(`Jev: ${c.code} came back without an answer to needs_kind.`);
      out.push({
        code: c.code,
        needs_outside_ci: probability('needs_outside_ci'),
        needs_unbuilt_feature: probability('needs_unbuilt_feature'),
        needs,
        input_hash: hashOf(state, c, r.model || model),
      });
    });
  }
  return out;
}

const SECTIONS = (sections: { title: string; content: string }[], name: string): string =>
  sections.find((s) => s.title.trim().toLowerCase() === name)?.content ?? '';

/**
 * Loads what Jev judges for a task version: its text, the criteria of its feature that it covers, the
 * feature itself (Goal and Scope), the dependencies its plan declares, the approved decisions, the other
 * features with their built state and, when the project's repository is there, what its CI runs. Null if
 * there is nothing to judge (no feature, no covers).
 */
export async function loadTestabilityInput(db: Db, projectId: string, recordId: string, versionId: string): Promise<TestabilityInput | null> {
  const v = await db.selectFrom('record_versions').select(['title', 'sections']).where('id', '=', versionId).executeTakeFirst();
  if (!v) return null;
  const covers = await taskCoversOf(db, recordId);
  if (covers.length === 0) return null;
  const basis = await db
    .selectFrom('links')
    .innerJoin('record_versions as fv', 'fv.id', 'links.to_id')
    .innerJoin('records as fr', 'fr.id', 'fv.record_id')
    .select(['fr.id as record_id', 'fr.code', 'fv.id as version_id', 'fv.title', 'fv.sections'])
    .where('links.from_id', '=', versionId)
    .where('links.type', '=', 'based_on')
    .where('fr.type', '=', 'fdr')
    .executeTakeFirst();
  if (!basis) return null;
  const rows = await db
    .selectFrom('criteria')
    .select(['code', 'statement', 'verification'])
    .where('record_version_id', '=', basis.version_id)
    .where('code', 'in', covers)
    .orderBy('position')
    .execute();
  const sections = v.sections as { title: string; content: string }[];
  const featureSections = basis.sections as { title: string; content: string }[];

  const adrs = await db
    .selectFrom('records')
    .innerJoin('record_versions', 'record_versions.record_id', 'records.id')
    .select(['records.code', 'record_versions.title', 'record_versions.n'])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'adr')
    .where('record_versions.state', '=', 'approved')
    .orderBy('records.code')
    .orderBy('record_versions.n', 'desc')
    .execute();
  const seen = new Set<string>();
  const decisions: string[] = [];
  for (const a of adrs) {
    if (seen.has(a.code)) continue;
    seen.add(a.code);
    decisions.push(`${a.code}: ${a.title}`);
  }

  const fdrs = await db
    .selectFrom('records')
    .innerJoin('record_versions', 'record_versions.record_id', 'records.id')
    .select(['records.id', 'records.code', 'record_versions.title', 'record_versions.n'])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'fdr')
    .where('records.id', '<>', basis.record_id)
    .orderBy('records.code')
    .orderBy('record_versions.n', 'desc')
    .execute();
  const mergedFeatures = await featuresWithMergedTask(db, projectId);
  const features: TestabilityInput['features'] = [];
  const done = new Set<string>();
  for (const f of fdrs) {
    if (done.has(f.id) || features.length >= MAX_FEATURES) continue;
    done.add(f.id);
    features.push({ code: f.code, title: f.title, built: mergedFeatures.has(f.code) || (await implementationOf(db, f.id)) === 'implemented' });
  }

  const own = await db.selectFrom('records').select('code').where('id', '=', recordId).executeTakeFirst();
  let declaredDependencies: string[] | undefined;
  if (own) {
    const index = await loadTaskDependencies(db, projectId, { code: own.code, versionId });
    declaredDependencies = [...(index.tasks.get(own.code) ?? []), ...(index.features.get(own.code) ?? [])];
  }
  const repo = await loadRepoContext(db, projectId).catch(() => null);
  return {
    ...(own ? { taskCode: own.code } : {}),
    title: v.title,
    goal: SECTIONS(sections, 'goal'),
    scope: SECTIONS(sections, 'scope'),
    criteria: rows,
    declaredDependencies,
    featureBeingBuilt: { code: basis.code, title: basis.title, goal: SECTIONS(featureSections, 'goal'), scope: SECTIONS(featureSections, 'scope') },
    decisions: decisions.slice(0, MAX_DECISIONS),
    features,
    projectStack: repo?.project_stack ?? null,
  };
}

/**
 * The codes of the features that have at least one task whose pull request was merged. A feature counts as
 * built for Jev from its first merged task: the audit of 01-10-2026 found a feature shown as not built
 * although a task of it had built it, because the feature's own readiness waits for evidence on every
 * criterion (convención nuestra).
 */
export async function featuresWithMergedTask(db: Db, projectId: string): Promise<Set<string>> {
  const rows = await db
    .selectFrom('build_requests as b')
    .innerJoin('record_versions as tv', 'tv.id', 'b.task_version_id')
    .innerJoin('links', 'links.from_id', 'tv.id')
    .innerJoin('record_versions as fv', 'fv.id', 'links.to_id')
    .innerJoin('records as fr', 'fr.id', 'fv.record_id')
    .select('fr.code')
    .distinct()
    .where('b.project_id', '=', projectId)
    .where('b.state', '=', 'done')
    .where('links.type', '=', 'based_on')
    .where('fr.type', '=', 'fdr')
    .execute();
  return new Set(rows.map((r) => r.code));
}

export type TestabilityDeps = {
  /** Tests pass a fake client; by default it is the TypeSafe API with the key. */
  client?: Client;
  load?: typeof loadTestabilityInput;
  store?: (
    services: Services,
    ids: { projectId: string; recordId: string; versionId: string },
    classifierId: string,
    judgments: TestabilityJudgment[],
  ) => Promise<void>;
};

async function storeJudgments(
  services: Services,
  ids: { projectId: string; recordId: string; versionId: string },
  classifierId: string,
  judgments: TestabilityJudgment[],
): Promise<void> {
  if (judgments.length === 0) return;
  await services.db
    .insertInto('task_testability_opinions')
    .values(
      judgments.map((j) => ({
        project_id: ids.projectId,
        record_id: ids.recordId,
        record_version_id: ids.versionId,
        criterion_code: j.code,
        needs_outside_ci: j.needs_outside_ci,
        needs_unbuilt_feature: j.needs_unbuilt_feature,
        needs_kind: j.needs,
        classifier_id: classifierId,
        input_hash: j.input_hash,
      })),
    )
    .execute();
}

/** Checks a task version's criteria with Jev and stores the probabilities. After the commit; never throws. */
export async function classifyTaskTestability(
  services: Services,
  projectId: string,
  recordId: string,
  versionId: string,
  deps: TestabilityDeps = {},
): Promise<void> {
  if (!jevAllowed()) return;
  try {
    const input = await (deps.load ?? loadTestabilityInput)(services.db, projectId, recordId, versionId);
    if (!input || !input.criteria.some((c) => c.verification === 'automatic')) return;
    let tokens = 0;
    const model = JEV_DEFAULT_MODEL;
    const client = deps.client ?? new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: model, timeout: 30_000 });
    const judgments = await judgeTestability(client, input, model, (n) => (tokens += n));
    await (deps.store ?? storeJudgments)(services, { projectId, recordId, versionId }, `jev@${model}`, judgments);
    services.logger.info('Jev checked the testability of a task', {
      projectId,
      recordId,
      criteria: judgments.length,
      input_tokens: tokens,
      usd: jevCostUsd(tokens),
    });
  } catch (err) {
    services.logger.error('Jev could not check the testability of a task', { recordId, versionId, error: String(err) });
  }
}
