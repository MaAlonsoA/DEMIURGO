// Jev's check of what a task asks of its builder (H97): before a task is built, can each automatic
// criterion it covers be verified by an automated test in the project's CI, or does it need a person,
// production, a real device, or a part of another feature that is not built yet? Flagging those early
// saves builder + CI + review loops that can never end well.
//
// One System One request per task (speculative fan-out, https://docs.typesafe.ai/patterns/fan-out):
// all questions share the same state, so they go together and are answered in parallel. Three Nouls
// per automatic criterion; the raw probabilities are stored (derived data, recomputable) and the
// policy below turns them into a warning when read. It runs after the commit, never blocks, never
// changes the criterion or the task (the model proposes, the person decides), and without
// TYPESAFE_API_KEY it does nothing.

import { createHash } from 'node:crypto';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import type { Db } from '../db/connection.ts';
import { implementationOf } from '../queries/read.ts';
import { taskCoversOf } from '../queries/sizes.ts';
import type { Services } from '../services.ts';
import { jevAllowed } from './aspect.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';
import type { TestabilityProbabilities } from './testability-policy.ts';

export * from './testability-policy.ts';

/** A convention of ours: criteria per request, to keep one request's questions in a sane number. */
export const MAX_CRITERIA_PER_REQUEST = 20;
const MAX_FEATURES = 60;
const MAX_DECISIONS = 30;
const MAX_TEXT = 3000;

export type TestabilityCriterion = { code: string; statement: string; verification: string };
export type TestabilityInput = {
  title: string;
  goal: string;
  scope: string;
  criteria: TestabilityCriterion[];
  /** Titles of the project's approved decisions (stack and hosting hints). */
  decisions: string[];
  features: { code: string; title: string; built: boolean }[];
};
export type TestabilityJudgment = TestabilityProbabilities & { code: string; input_hash: string };

type Client = Pick<TypeSafeClient, 'systemOne'>;

const NOULS = {
  can_check_in_ci: {
    statement: (c: TestabilityCriterion) =>
      `Can an automated test running in the project's CI pipeline, with no production deployment, no real devices and no human involved, check this acceptance criterion? Criterion ${c.code}: ${c.statement}`,
    criteria: {
      true: 'A unit, integration or end-to-end test run by CI on a build of the code can decide pass or fail for this criterion by itself.',
      false: 'Nothing a CI test can run decides it: it needs something outside the code and the CI pipeline.',
    },
  },
  needs_outside_ci: {
    statement: (c: TestabilityCriterion) =>
      `Does checking this acceptance criterion require a production or deployed environment, a real device, or a human judgement (for example a screen-reader audit, a cold start of a hosted service, a usability check)? Criterion ${c.code}: ${c.statement}`,
    criteria: {
      true: 'Checking it needs a live deployment, real hardware, real third-party infrastructure behaviour, or a person looking and judging.',
      false: 'It can be checked with the code running in a test environment and an automated assertion.',
    },
  },
  needs_unbuilt_feature: {
    statement: (c: TestabilityCriterion) =>
      `Does checking this acceptance criterion need a part of another feature that is not built yet? The features not built yet are listed in the state under features (built: false). Criterion ${c.code}: ${c.statement}`,
    criteria: {
      true: 'The check cannot run until some other feature listed as not built exists (for example it needs data, a screen or an endpoint that feature provides).',
      false: 'The check needs nothing from the features not built yet: this task and the features already built are enough.',
    },
  },
} as const;

const KEYS = Object.keys(NOULS) as (keyof typeof NOULS)[];

/** The one request of a task: the shared state and every question about every automatic criterion. */
export function buildTestabilityRequest(input: TestabilityInput, criteria: readonly TestabilityCriterion[]) {
  const state = {
    task: { title: input.title, goal: input.goal.slice(0, MAX_TEXT), scope: input.scope.slice(0, MAX_TEXT) },
    criteria_covered: input.criteria.map((c) => ({ code: c.code, statement: c.statement, verification: c.verification })),
    project_decisions: input.decisions,
    features: input.features,
  };
  const questions: Record<string, ReturnType<typeof noul>> = {};
  criteria.forEach((c, i) => {
    for (const k of KEYS) questions[`${k}_${i}`] = noul(NOULS[k].statement(c), NOULS[k].criteria);
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
    const answers = r.answers as Record<string, { noul?: number } | undefined>;
    chunk.forEach((c, i) => {
      const probability = (k: keyof typeof NOULS): number => {
        const v = answers[`${k}_${i}`]?.noul;
        if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`Jev: ${c.code} came back without an answer to ${k}.`);
        return v;
      };
      out.push({
        code: c.code,
        can_check_in_ci: probability('can_check_in_ci'),
        needs_outside_ci: probability('needs_outside_ci'),
        needs_unbuilt_feature: probability('needs_unbuilt_feature'),
        input_hash: hashOf(state, c, r.model || model),
      });
    });
  }
  return out;
}

const SECTIONS = (sections: { title: string; content: string }[], name: string): string =>
  sections.find((s) => s.title.trim().toLowerCase() === name)?.content ?? '';

/**
 * Loads what Jev judges for a task version: its text, the criteria of its feature that it covers,
 * the approved decisions and the other features with their built state. Null if there is nothing
 * to judge (no feature, no covers).
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
    .select(['fr.id as record_id', 'fr.code', 'fv.id as version_id'])
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
  const features: TestabilityInput['features'] = [];
  const done = new Set<string>();
  for (const f of fdrs) {
    if (done.has(f.id) || features.length >= MAX_FEATURES) continue;
    done.add(f.id);
    features.push({ code: f.code, title: f.title, built: (await implementationOf(db, f.id)) === 'implemented' });
  }
  return {
    title: v.title,
    goal: SECTIONS(sections, 'goal'),
    scope: SECTIONS(sections, 'scope'),
    criteria: rows,
    decisions: decisions.slice(0, MAX_DECISIONS),
    features,
  };
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
        can_check_in_ci: j.can_check_in_ci,
        needs_outside_ci: j.needs_outside_ci,
        needs_unbuilt_feature: j.needs_unbuilt_feature,
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
