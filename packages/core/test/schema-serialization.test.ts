// H101: «Build the queue» never runs two tasks predicted to change the database schema at once.
// Fake Jev client, fake footprints and a fake selection state: no database and no real call.

import { afterEach, describe, expect, it } from 'vitest';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import { selectStarts } from '../src/build/auto.ts';
import { isSchemaFile, schemaEvidence } from '../src/build/schema-risk.ts';
import { SCHEMA_THRESHOLD, buildLayersRequest, classifyTaskLayers, judgeLayers } from '../src/classifier/layers.ts';
import type { QueueTask } from '../src/build/queue.ts';
import type { TaskDependencyIndex } from '../src/queries/task-deps.ts';
import type { SchemaEvidence } from '../src/build/schema-risk.ts';
import type { Services } from '../src/services.ts';

const task = (code: string, feature: string): QueueTask => ({ code, title: code, feature: { code: feature, title: feature } }) as unknown as QueueTask;
const index = { tasks: new Map(), features: new Map(), featureTasks: new Map(), taskFeature: new Map(), titles: new Map(), merged: new Map() } as unknown as TaskDependencyIndex;
const select = (ready: QueueTask[], running: string[], schema: Record<string, SchemaEvidence>, limit = 3) =>
  selectStarts({
    ready,
    running,
    limit,
    index,
    featureOf: (c) => ready.find((t) => t.code === c)?.feature?.code ?? null,
    stateOf: async () => ({ kind: 'start', hasRequest: false }),
    schema: new Map(Object.entries(schema)),
  });

describe('selectStarts and the schema rule', () => {
  it('skips a second schema task while one runs and picks the next non-schema one', async () => {
    const ready = [task('TSK-2', 'F2'), task('TSK-3', 'F3'), task('TSK-4', 'F4')];
    const r = await select(ready, ['TSK-1'], { 'TSK-1': 'jev', 'TSK-2': 'jev' });
    expect(r.schemaWaiting).toEqual(['TSK-2']);
    expect(r.start.map((s) => s.code)).toEqual(['TSK-3', 'TSK-4']);
  });

  it('starts only one schema task in the same round', async () => {
    const ready = [task('TSK-1', 'F1'), task('TSK-2', 'F2'), task('TSK-3', 'F3')];
    const r = await select(ready, [], { 'TSK-1': 'jev', 'TSK-2': 'footprint' });
    expect(r.start.map((s) => s.code)).toEqual(['TSK-1', 'TSK-3']);
    expect(r.schemaWaiting).toEqual(['TSK-2']);
  });

  it('does not wait when the running task is not schema-changing', async () => {
    const r = await select([task('TSK-2', 'F2')], ['TSK-1'], { 'TSK-2': 'jev' });
    expect(r.start.map((s) => s.code)).toEqual(['TSK-2']);
    expect(r.schemaWaiting).toEqual([]);
  });
});

describe('selectStarts and Jev testability flags', () => {
  it('leaves a flagged task waiting for the person and starts the next one', async () => {
    const flagged = { ...task('TSK-2', 'F2'), testability: [{ criterion: 'AC-1' }] } as unknown as QueueTask;
    const r = await select([flagged, task('TSK-3', 'F3')], [], {});
    expect(r.testabilityWaiting).toEqual(['TSK-2']);
    expect(r.start.map((s) => s.code)).toEqual(['TSK-3']);
  });

  it('starts a flagged task the person requested', async () => {
    const flagged = { ...task('TSK-2', 'F2'), testability: [{ criterion: 'AC-1' }] } as unknown as QueueTask;
    const r = await selectStarts({
      ready: [flagged],
      running: [],
      limit: 1,
      index,
      featureOf: () => 'F2',
      stateOf: async () => ({ kind: 'start', hasRequest: true }),
      schema: new Map(),
    });
    expect(r.start.map((s) => s.code)).toEqual(['TSK-2']);
  });
});

describe('schemaEvidence', () => {
  it('knows schema files', () => {
    expect(isSchemaFile('packages/core/migrations/0004_x.sql')).toBe(true);
    expect(isSchemaFile('db/seed.sql')).toBe(true);
    expect(isSchemaFile('src/app/page.tsx')).toBe(false);
  });

  it('deterministic footprint evidence wins over a low Jev probability', () => {
    const fp = { files: [{ path: 'migrations/0003_a.sql', additions: 1, deletions: 0, status: 'added' }] };
    expect(schemaEvidence(fp, { schema: 0.01 })).toBe('footprint');
    expect(schemaEvidence(undefined, { schema: SCHEMA_THRESHOLD })).toBe('jev');
    expect(schemaEvidence(undefined, { schema: SCHEMA_THRESHOLD - 0.01 })).toBe(null);
    expect(schemaEvidence({ files: [{ path: 'src/a.ts', additions: 1, deletions: 0, status: 'modified' }] }, undefined)).toBe(null);
  });
});

describe('judgeLayers and classifyTaskLayers', () => {
  const saved = process.env.TYPESAFE_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  });
  const TASK = { title: 'Add goals', goal: 'Save daily goals.', scope: 'A form.', acceptance_criteria: ['Goals are saved.'] };
  const REPO = {
    project_stack: { ci: 'GitHub Actions: ephemeral Postgres 17, Vitest; no deployed environment, no person.' },
    repository: { migrations: ['0001_init.sql'], database_tables: [{ table: 'food_entries', columns: ['id', 'name'] }], server_modules: [], server_actions: [], route_handlers: [], pages: [], ui_components: [] },
  };
  // A Score over three levels: the expected score is what Jev returns.
  const fake = (value = 1.6) => {
    const requests: { state: unknown; questions: Record<string, unknown> }[] = [];
    const client = {
      systemOne: async (r: { state: unknown; questions: Record<string, unknown> }) => {
        requests.push(r);
        return { model: 'jev-test', answers: Object.fromEntries(Object.keys(r.questions).map((k) => [k, { type: 'score', score: value }])), usage: { input_tokens: 5, output_tokens: 0 } };
      },
    } as unknown as Pick<TypeSafeClient, 'systemOne'>;
    return { client, requests };
  };
  const services = () => ({ db: {}, logger: { info: () => {}, error: () => {} } }) as unknown as Services;

  it('asks one request with only the schema Score, over the task and the repository', async () => {
    const { client, requests } = fake(1.6);
    const j = await judgeLayers(client, { task: TASK, repo: REPO });
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]?.questions ?? {})).toEqual(['schema_score']);
    expect(requests[0]?.state).toMatchObject({ task: TASK, project_stack: REPO.project_stack, repository: { database_tables: [{ table: 'food_entries' }] } });
    expect(j.schema).toBeCloseTo(0.8); // 1.6 of a top level of 2
  });

  it('degrades without the repository: no repository or project_stack in the state', () => {
    const { state, questions } = buildLayersRequest({ task: TASK, repo: null });
    expect(Object.keys(state)).toEqual(['task']);
    expect(JSON.stringify(questions)).not.toContain('database_tables');
  });

  it('the threshold is the midpoint of the scale: one new column or more', async () => {
    expect((await judgeLayers(fake(1).client, { task: TASK })).schema).toBeGreaterThanOrEqual(SCHEMA_THRESHOLD);
    expect((await judgeLayers(fake(0.9).client, { task: TASK })).schema).toBeLessThan(SCHEMA_THRESHOLD);
  });

  it('does nothing without the key and stores with it', async () => {
    const { client, requests } = fake(1.6);
    const stored: number[] = [];
    const deps = { client, input: async () => ({ task: TASK }), store: async (_s: Services, _i: unknown, _c: string, j: { schema: number }) => void stored.push(j.schema) };
    delete process.env.TYPESAFE_API_KEY;
    await classifyTaskLayers(services(), 'p', 'r', 'v', deps);
    expect(requests).toHaveLength(0);
    process.env.TYPESAFE_API_KEY = 'test';
    await classifyTaskLayers(services(), 'p', 'r', 'v', deps);
    expect(stored[0]).toBeCloseTo(0.8);
  });

  it('never throws when Jev fails', async () => {
    process.env.TYPESAFE_API_KEY = 'test';
    const client = { systemOne: async () => { throw new Error('down'); } } as unknown as Pick<TypeSafeClient, 'systemOne'>;
    await expect(classifyTaskLayers(services(), 'p', 'r', 'v', { client, input: async () => ({ task: TASK }) })).resolves.toBeUndefined();
  });
});
