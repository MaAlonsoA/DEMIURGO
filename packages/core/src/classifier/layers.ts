// Jev's guess at how much database schema work a task needs (H101). «Build the queue» uses it to never
// run two schema-changing tasks at once: the app numbers migrations in sequence, so two parallel tasks
// that both add a migration would both create the same number and collide.
//
// One Score (https://docs.typesafe.ai/primitives/score) over the task as JSON and the repository as it
// is before the task (`repository`: the migrations, the tables and columns they create, the server
// modules, routes and pages, read from the project's git at its base commit) and what its CI runs
// (`project_stack`). Levels: None / one new column or index / a new table. The A/B audit of 01-10-2026
// on 30 merged tasks of «Comidas y entrenos» replaced five Nouls on one text with this: the Nouls for
// server, UI, tests-only and deploy were never read by anything and are no longer asked. The stored
// `schema_p` is the expected score divided by the top level (0..1), so the threshold below is the
// midpoint of the scale (one column or more). The raw value is stored (derived data, recomputable); the
// threshold lives in code. It runs after the commit, never blocks, never changes the task, and without
// TYPESAFE_API_KEY it does nothing.

import { createHash } from 'node:crypto';
import { TypeSafeClient, score } from '@typesafe-ai/sdk';
import type { Db } from '../db/connection.ts';
import type { Services } from '../services.ts';
import { jevAllowed } from './aspect.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';
import { type RepoContext, loadRepoContext } from './repo-context.ts';
import { type TaskObject, loadTaskObject } from './task-input.ts';

/**
 * A task counts as schema-changing from this value of `schema` (the expected score over the top level).
 * Our convention (not a standard): the midpoint of the scale, as in the audit; tune it with
 * packages/core/scripts/eval-layers.ts against the merged tasks.
 */
export const SCHEMA_THRESHOLD = 0.5;

export type TaskLayers = { schema: number };
export type LayersJudgment = TaskLayers & { input_hash: string };
export type LayersInput = { task: TaskObject; repo?: RepoContext | null };

type Client = Pick<TypeSafeClient, 'systemOne'>;

const SCHEMA_LEVELS = [
  'None: the task saves and reads only data the existing tables already hold, or stores nothing.',
  'A small change: one new column or index on an existing table, in one new migration.',
  'A new table: the task stores a new kind of record that no existing table holds, in a new migration.',
] as const;

/** The one request of a task: the task and the repository as the state, and the schema Score. */
export function buildLayersRequest(input: LayersInput) {
  const repo = input.repo ?? null;
  const state = {
    task: input.task,
    ...(repo?.project_stack ? { project_stack: repo.project_stack } : {}),
    ...(repo ? { repository: repo.repository } : {}),
  };
  const question = repo
    ? 'How much database schema work does building `task` require, given the tables in `repository.database_tables`?'
    : 'How much database schema work does building `task` require?';
  return { state, questions: { schema_score: score(question, [...SCHEMA_LEVELS]) } };
}

/** Asks Jev how much schema work a task needs. */
export async function judgeLayers(
  client: Client,
  input: LayersInput,
  model: string = JEV_DEFAULT_MODEL,
  onUsage?: (inputTokens: number) => void,
): Promise<LayersJudgment> {
  const { state, questions } = buildLayersRequest(input);
  const r = await client.systemOne({ state, questions, model });
  onUsage?.(r.usage.input_tokens);
  const answers = r.answers as Record<string, { score?: number } | undefined>;
  const v = answers.schema_score?.score;
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error('Jev: the task came back without an answer to the schema score.');
  return {
    schema: Math.min(1, Math.max(0, v / (SCHEMA_LEVELS.length - 1))),
    input_hash: createHash('sha256')
      .update(JSON.stringify({ state, model: r.model || model }))
      .digest('hex'),
  };
}

export type LayersDeps = {
  /** Tests pass a fake client; by default it is the TypeSafe API with the key. */
  client?: Client;
  input?: (services: Services, projectId: string, recordId: string, versionId: string) => Promise<LayersInput | null>;
  store?: (
    services: Services,
    ids: { projectId: string; recordId: string; versionId: string },
    classifierId: string,
    judgment: LayersJudgment,
  ) => Promise<void>;
};

async function storeLayers(
  services: Services,
  ids: { projectId: string; recordId: string; versionId: string },
  classifierId: string,
  j: LayersJudgment,
): Promise<void> {
  await services.db
    .insertInto('task_layers_opinions')
    .values({
      project_id: ids.projectId,
      record_id: ids.recordId,
      record_version_id: ids.versionId,
      schema_p: j.schema,
      classifier_id: classifierId,
      input_hash: j.input_hash,
    })
    .execute();
}

async function loadLayersInput(services: Services, projectId: string, recordId: string, versionId: string): Promise<LayersInput | null> {
  const task = await loadTaskObject(services.db, recordId, versionId);
  if (!task) return null;
  return { task, repo: await loadRepoContext(services.db, projectId).catch(() => null) };
}

/** Asks Jev how much schema work a task version needs and stores the value. After the commit; never throws. */
export async function classifyTaskLayers(
  services: Services,
  projectId: string,
  recordId: string,
  versionId: string,
  deps: LayersDeps = {},
): Promise<void> {
  if (!jevAllowed()) return;
  try {
    const input = await (deps.input ?? loadLayersInput)(services, projectId, recordId, versionId);
    if (!input) return;
    let tokens = 0;
    const model = JEV_DEFAULT_MODEL;
    const client = deps.client ?? new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: model, timeout: 30_000 });
    const judgment = await judgeLayers(client, input, model, (n) => (tokens += n));
    await (deps.store ?? storeLayers)(services, { projectId, recordId, versionId }, `jev@${model}`, judgment);
    services.logger.info('Jev guessed the layers of a task', {
      projectId,
      recordId,
      schema: judgment.schema,
      input_tokens: tokens,
      usd: jevCostUsd(tokens),
    });
  } catch (err) {
    services.logger.error('Jev could not guess the layers of a task', { recordId, versionId, error: String(err) });
  }
}

/** The latest stored schema value of each task (by record id); tasks without an opinion are absent. */
export async function taskLayersOf(db: Db, recordIds: string[]): Promise<Map<string, TaskLayers>> {
  const out = new Map<string, TaskLayers>();
  if (recordIds.length === 0) return out;
  const rows = await db
    .selectFrom('task_layers_opinions')
    .select(['record_id', 'schema_p'])
    .where('record_id', 'in', recordIds)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  for (const r of rows) {
    if (out.has(r.record_id)) continue;
    out.set(r.record_id, { schema: r.schema_p });
  }
  return out;
}
