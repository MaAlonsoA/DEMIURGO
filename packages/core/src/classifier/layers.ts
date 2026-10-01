// Jev's guess at which layers of the product a task will change (H101): database schema, server, UI,
// tests only, deploy. «Build the queue» uses `schema` to never run two schema-changing tasks at once:
// the app numbers migrations in sequence, so two parallel tasks that both add a migration would both
// create the same number and collide.
//
// One System One request per task (speculative fan-out, https://docs.typesafe.ai/patterns/fan-out):
// five Nouls (https://docs.typesafe.ai/primitives/noul) over the same text, because several layers can
// apply to one task. The raw probabilities are stored (derived data, recomputable); the threshold lives
// in code. It runs after the commit, never blocks, never changes the task, and without TYPESAFE_API_KEY
// it does nothing.

import { createHash } from 'node:crypto';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import type { Db } from '../db/connection.ts';
import type { Services } from '../services.ts';
import { jevAllowed } from './aspect.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';
import { taskSizeText } from './size.ts';

/**
 * A task counts as schema-changing from this probability of `schema`. Our convention (not a standard):
 * 0.5 is the Noul's own midpoint; tune it with packages/core/scripts/eval-layers.ts against the merged tasks.
 */
export const SCHEMA_THRESHOLD = 0.5;

export type TaskLayers = { schema: number; server: number; ui: number; tests_only: number; deploy: number };
export type TaskLayer = keyof TaskLayers;
export type LayersJudgment = TaskLayers & { input_hash: string };

type Client = Pick<TypeSafeClient, 'systemOne'>;

const NOULS = {
  schema: {
    statement: 'Will building this task create or change database tables, columns or migrations?',
    criteria: {
      true: 'The work adds, alters or removes a table, a column, an index or a migration of the project database.',
      false: 'The work needs no change to the database structure: it uses the tables that exist or has no database at all.',
    },
  },
  server: {
    statement: 'Will building this task change server-side code: server actions, API endpoints, jobs or data access?',
    criteria: {
      true: 'The work adds or changes code that runs on the server: endpoints, server actions, queries, background jobs.',
      false: 'The work leaves the server-side code alone.',
    },
  },
  ui: {
    statement: 'Will building this task change screens or UI components that people see?',
    criteria: {
      true: 'The work adds or changes pages, screens, components or styles shown to people.',
      false: 'The work does not change anything people see on a screen.',
    },
  },
  tests_only: {
    statement: 'Does this task only add tests, evidence or documentation, with no production code change?',
    criteria: {
      true: 'The whole task is tests, test evidence or documentation; no production code is added or changed.',
      false: 'The task adds or changes production code.',
    },
  },
  deploy: {
    statement: 'Will building this task change CI, deployment or infrastructure configuration?',
    criteria: {
      true: 'The work adds or changes a CI pipeline, a deployment, hosting or infrastructure configuration.',
      false: 'The work leaves CI, deployment and infrastructure configuration alone.',
    },
  },
} as const;

export const LAYERS = Object.keys(NOULS) as TaskLayer[];

/** The one request of a task: the shared text and the five questions about it. */
export function buildLayersRequest(text: string) {
  const questions: Record<string, ReturnType<typeof noul>> = {};
  for (const k of LAYERS) questions[k] = noul(NOULS[k].statement, NOULS[k].criteria);
  return { state: { task: text }, questions };
}

/** Asks Jev the five layer questions about a task text. */
export async function judgeLayers(
  client: Client,
  text: string,
  model: string = JEV_DEFAULT_MODEL,
  onUsage?: (inputTokens: number) => void,
): Promise<LayersJudgment> {
  const { state, questions } = buildLayersRequest(text);
  const r = await client.systemOne({ state, questions, model });
  onUsage?.(r.usage.input_tokens);
  const answers = r.answers as Record<string, { noul?: number } | undefined>;
  const p = (k: TaskLayer): number => {
    const v = answers[k]?.noul;
    if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`Jev: the task came back without an answer to ${k}.`);
    return v;
  };
  return {
    schema: p('schema'),
    server: p('server'),
    ui: p('ui'),
    tests_only: p('tests_only'),
    deploy: p('deploy'),
    input_hash: createHash('sha256')
      .update(JSON.stringify({ state, model: r.model || model }))
      .digest('hex'),
  };
}

export type LayersDeps = {
  /** Tests pass a fake client; by default it is the TypeSafe API with the key. */
  client?: Client;
  text?: (services: Pick<Services, 'db'>, versionId: string) => Promise<string | null>;
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
      server_p: j.server,
      ui_p: j.ui,
      tests_only_p: j.tests_only,
      deploy_p: j.deploy,
      classifier_id: classifierId,
      input_hash: j.input_hash,
    })
    .execute();
}

/** Asks Jev which layers a task version changes and stores the probabilities. After the commit; never throws. */
export async function classifyTaskLayers(
  services: Services,
  projectId: string,
  recordId: string,
  versionId: string,
  deps: LayersDeps = {},
): Promise<void> {
  if (!jevAllowed()) return;
  try {
    const text = await (deps.text ?? taskSizeText)(services, versionId);
    if (!text) return;
    let tokens = 0;
    const model = JEV_DEFAULT_MODEL;
    const client = deps.client ?? new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: model, timeout: 30_000 });
    const judgment = await judgeLayers(client, text, model, (n) => (tokens += n));
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

/** The latest stored layers of each task (by record id); tasks without an opinion are absent. */
export async function taskLayersOf(db: Db, recordIds: string[]): Promise<Map<string, TaskLayers>> {
  const out = new Map<string, TaskLayers>();
  if (recordIds.length === 0) return out;
  const rows = await db
    .selectFrom('task_layers_opinions')
    .select(['record_id', 'schema_p', 'server_p', 'ui_p', 'tests_only_p', 'deploy_p'])
    .where('record_id', 'in', recordIds)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  for (const r of rows) {
    if (out.has(r.record_id)) continue;
    out.set(r.record_id, { schema: r.schema_p, server: r.server_p, ui: r.ui_p, tests_only: r.tests_only_p, deploy: r.deploy_p });
  }
  return out;
}
