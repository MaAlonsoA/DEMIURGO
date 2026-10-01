// H101: «Build the queue» never runs two tasks predicted to change the database schema at once.
// Fake Jev client, fake footprints and a fake selection state: no database and no real call.

import { afterEach, describe, expect, it } from 'vitest';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import { selectStarts } from '../src/build/auto.ts';
import { isSchemaFile, schemaEvidence } from '../src/build/schema-risk.ts';
import { SCHEMA_THRESHOLD, classifyTaskLayers, judgeLayers, LAYERS } from '../src/classifier/layers.ts';
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
  const fake = () => {
    const requests: { questions: Record<string, unknown> }[] = [];
    const client = {
      systemOne: async (r: { questions: Record<string, unknown> }) => {
        requests.push(r);
        return { model: 'jev-test', answers: Object.fromEntries(Object.keys(r.questions).map((k) => [k, { type: 'noul', noul: k === 'schema' ? 0.8 : 0.1 }])), usage: { input_tokens: 5, output_tokens: 0 } };
      },
    } as unknown as Pick<TypeSafeClient, 'systemOne'>;
    return { client, requests };
  };
  const services = () => ({ db: {}, logger: { info: () => {}, error: () => {} } }) as unknown as Services;

  it('asks one request with the five Nouls', async () => {
    const { client, requests } = fake();
    const j = await judgeLayers(client, 'Task: add a table');
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]?.questions ?? {})).toEqual(LAYERS);
    expect(j.schema).toBe(0.8);
  });

  it('does nothing without the key and stores with it', async () => {
    const { client, requests } = fake();
    const stored: number[] = [];
    const deps = { client, text: async () => 'Task', store: async (_s: Services, _i: unknown, _c: string, j: { schema: number }) => void stored.push(j.schema) };
    delete process.env.TYPESAFE_API_KEY;
    await classifyTaskLayers(services(), 'p', 'r', 'v', deps);
    expect(requests).toHaveLength(0);
    process.env.TYPESAFE_API_KEY = 'test';
    await classifyTaskLayers(services(), 'p', 'r', 'v', deps);
    expect(stored).toEqual([0.8]);
  });

  it('never throws when Jev fails', async () => {
    process.env.TYPESAFE_API_KEY = 'test';
    const client = { systemOne: async () => { throw new Error('down'); } } as unknown as Pick<TypeSafeClient, 'systemOne'>;
    await expect(classifyTaskLayers(services(), 'p', 'r', 'v', { client, text: async () => 'Task' })).resolves.toBeUndefined();
  });
});
