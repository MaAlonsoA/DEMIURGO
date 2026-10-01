// «Build the queue» does not start two tasks that change the same hotspot or the same table/route module.
// Pure: fake footprints, predictions and code map; no database.

import { describe, expect, it } from 'vitest';
import { enrichModuleWaiting, moduleKindOf, selectStarts, sharedItem } from '../src/build/auto.ts';
import { assemble, type CodeFile } from '../src/build/code-map.ts';
import { hotspotCounts, isBarrelSource, isHotspot, isHotspotCandidate, looksLikeBarrelPath } from '../src/build/hotspots.ts';
import { strongFiles } from '../src/build/predicted-files.ts';
import type { QueueTask } from '../src/build/queue.ts';
import type { TaskDependencyIndex } from '../src/queries/task-deps.ts';

const fp = (...paths: string[]) => ({ files: paths.map((path) => ({ path, additions: 1, deletions: 0, status: 'modified' })) });

describe('hotspotCounts and isHotspot', () => {
  it('counts tasks per file, ignores docs, tests and lockfiles, sorts desc', () => {
    const r = hotspotCounts([
      fp('src/a.ts', 'README.md', 'pnpm-lock.yaml', 'src/a.test.ts', 'src/b.css'),
      fp('src/a.ts', 'docs/x.md', '.env.example'),
      fp('src/a.ts', 'src/b.css', 'src/b.css'),
      fp('src/c.ts'),
    ]);
    expect(r).toEqual([
      { path: 'src/a.ts', tasks: 3, of: 4 },
      { path: 'src/b.css', tasks: 2, of: 4 },
      { path: 'src/c.ts', tasks: 1, of: 4 },
    ]);
  });

  it('filters candidates', () => {
    expect(isHotspotCandidate('src/app.tsx')).toBe(true);
    expect(isHotspotCandidate('src/app.css')).toBe(true);
    expect(isHotspotCandidate('docs/plan.md')).toBe(false);
    expect(isHotspotCandidate('test/a.ts')).toBe(false);
    expect(isHotspotCandidate('.env')).toBe(false);
  });

  it('needs at least 3 tasks and 30% of the merged ones', () => {
    expect(isHotspot({ path: 'a', tasks: 3, of: 10 })).toBe(true);
    expect(isHotspot({ path: 'a', tasks: 3, of: 11 })).toBe(false);
    expect(isHotspot({ path: 'a', tasks: 2, of: 3 })).toBe(false);
    expect(isHotspot({ tasks: 5, of: 0 })).toBe(false);
  });
});

const file = (path: string, kind: CodeFile['kind'], modules: string[]): CodeFile => ({ path, kind, modules, symbols: [], imports: [] });
const map = assemble('sha', [
  file('db/schema.ts', 'table', ['table:meals']),
  file('db/extra.ts', 'table', ['table:meals']),
  file('app/api/meals/route.ts', 'route', ['route:/api/meals']),
  file('lib/a.ts', 'lib', ['lib:lib']),
  file('lib/b.ts', 'lib', ['lib:lib']),
]);

describe('sharedItem', () => {
  const none = new Set<string>();
  it('names a shared hotspot file', () => {
    expect(sharedItem(['lib/a.ts', 'x.ts'], ['lib/a.ts'], new Set(['lib/a.ts']), map)).toBe('lib/a.ts');
  });
  it('names a table module shared through different files', () => {
    expect(sharedItem(['db/schema.ts'], ['db/extra.ts'], none, map)).toBe('table:meals');
  });
  it('lib files in the same folder do not collide, nor does the same lib file when it is no hotspot', () => {
    expect(sharedItem(['lib/a.ts'], ['lib/b.ts'], none, map)).toBeNull();
    expect(sharedItem(['lib/a.ts'], ['lib/a.ts'], none, map)).toBeNull();
  });
});

const task = (code: string, feature: string): QueueTask => ({ code, title: code, feature: { code: feature, title: feature } }) as unknown as QueueTask;
const index = { tasks: new Map(), features: new Map(), featureTasks: new Map(), taskFeature: new Map(), titles: new Map(), merged: new Map() } as unknown as TaskDependencyIndex;
const select = (ready: QueueTask[], running: string[], predicted: Record<string, string[]>, hotspots: string[] = []) =>
  selectStarts({
    ready,
    running,
    limit: 3,
    index,
    featureOf: (c) => ready.find((t) => t.code === c)?.feature?.code ?? null,
    stateOf: async () => ({ kind: 'start', hasRequest: false }),
    schema: new Map(),
    predicted: new Map(Object.entries(predicted)),
    hotspots: new Set(hotspots),
    map,
  });

describe('selectStarts and the module rule', () => {
  it('skips a task that shares a table with a running one and starts the next', async () => {
    const r = await select([task('TSK-2', 'F2'), task('TSK-3', 'F3')], ['TSK-1'], { 'TSK-1': ['db/schema.ts'], 'TSK-2': ['db/extra.ts'], 'TSK-3': ['lib/a.ts'] });
    expect(r.moduleWaiting).toEqual([{ code: 'TSK-2', item: 'table:meals', with: 'TSK-1' }]);
    expect(r.start.map((s) => s.code)).toEqual(['TSK-3']);
  });

  it('serializes two ready tasks that share a hotspot in the same round', async () => {
    const r = await select([task('TSK-1', 'F1'), task('TSK-2', 'F2')], [], { 'TSK-1': ['lib/a.ts'], 'TSK-2': ['lib/a.ts'] }, ['lib/a.ts']);
    expect(r.start.map((s) => s.code)).toEqual(['TSK-1']);
    expect(r.moduleWaiting).toEqual([{ code: 'TSK-2', item: 'lib/a.ts', with: 'TSK-1' }]);
  });

  it('a running task collides by its real files: tests only do not block a ready task that shared a hotspot with its prediction', async () => {
    // The planner swaps the running task's prediction for the files its commit really changed.
    const real = { 'TSK-1': ['test/a.test.ts'], 'TSK-2': ['lib/a.ts'] };
    const r = await select([task('TSK-2', 'F2')], ['TSK-1'], real, ['lib/a.ts']);
    expect(r.start.map((s) => s.code)).toEqual(['TSK-2']);
    expect(r.moduleWaiting).toEqual([]);
    const wrong = await select([task('TSK-2', 'F2')], ['TSK-1'], { ...real, 'TSK-1': ['lib/a.ts'] }, ['lib/a.ts']);
    expect(wrong.moduleWaiting).toEqual([{ code: 'TSK-2', item: 'lib/a.ts', with: 'TSK-1' }]);
  });

  it('does nothing without predictions', async () => {
    const r = await select([task('TSK-2', 'F2')], ['TSK-1'], {});
    expect(r.start.map((s) => s.code)).toEqual(['TSK-2']);
    expect(r.moduleWaiting).toEqual([]);
  });
});

describe('enrichModuleWaiting', () => {
  it('derives the kind, the source of the blocker set and the hotspot counts', () => {
    const r = enrichModuleWaiting(
      [
        { code: 'TSK-2', item: 'src/app/layout.tsx', with: 'TSK-1' },
        { code: 'TSK-3', item: 'table:strength_sets', with: 'TSK-4' },
        { code: 'TSK-5', item: 'server_action:src/app/x.ts', with: 'TSK-4' },
      ],
      new Set(['TSK-1']),
      [{ path: 'src/app/layout.tsx', tasks: 12, of: 27 }],
    );
    expect(r[0]).toMatchObject({ kind: 'hotspot', with_source: 'actual', hotspot: { tasks: 12, of: 27 } });
    expect(r[1]).toMatchObject({ kind: 'table', with_source: 'predicted' });
    expect(r[1]?.hotspot).toBeUndefined();
    expect(r[2]?.kind).toBe('server_action');
    expect(moduleKindOf('route:/api/x')).toBe('route');
    expect(moduleKindOf('page:/')).toBe('page');
  });
});

describe('a stopped task no longer stops the line', () => {
  it('skips it, records it and starts the next task', async () => {
    const ready = [task('TSK-1', 'F1'), task('TSK-2', 'F2')];
    const r = await selectStarts({
      ready,
      running: [],
      limit: 3,
      index,
      featureOf: (c) => ready.find((t) => t.code === c)?.feature?.code ?? null,
      stateOf: async (t) =>
        t.code === 'TSK-1' ? { kind: 'stopped', stopped: { code: 'TSK-1', kind: 'needs_you', tried: 3 } } : { kind: 'start', hasRequest: false },
      schema: new Map(),
    });
    expect(r.start.map((s) => s.code)).toEqual(['TSK-2']);
    expect(r.stoppedWaiting).toEqual([{ code: 'TSK-1', kind: 'needs_you', tried: 3 }]);
    expect(r.stopped).toBeNull();
  });

  it('reports it as stopped only when nothing can run', async () => {
    const ready = [task('TSK-1', 'F1')];
    const r = await selectStarts({
      ready,
      running: [],
      limit: 3,
      index,
      featureOf: () => null,
      stateOf: async () => ({ kind: 'stopped', stopped: { code: 'TSK-1', kind: 'ended', tried: null } }),
      schema: new Map(),
    });
    expect(r.start).toEqual([]);
    expect(r.stopped).toEqual({ code: 'TSK-1', kind: 'ended', tried: null });
  });
});

describe('collisions only on strong evidence', () => {
  it('a low-p prediction is dropped, so it cannot block; p >= 0.5 and files named by the task stay', async () => {
    const strong = strongFiles(
      [
        { path: 'lib/a.ts', jev_p: 0.2 },
        { path: 'lib/b.ts', jev_p: 0.5 },
        { path: 'lib/c.ts', jev_p: null },
      ],
      'Change lib/d.ts to show the total',
      ['lib/a.ts', 'lib/b.ts', 'lib/c.ts', 'lib/d.ts'],
    );
    expect(strong.sort()).toEqual(['lib/b.ts', 'lib/d.ts']);
    // Unknown (no evidence) means no collision.
    const r = await select([task('TSK-2', 'F2')], ['TSK-1'], { 'TSK-1': ['lib/a.ts'], 'TSK-2': strongFiles([{ path: 'lib/a.ts', jev_p: 0.2 }], '', ['lib/a.ts']) }, ['lib/a.ts']);
    expect(r.start.map((s) => s.code)).toEqual(['TSK-2']);
  });

  it('files a running build really committed still block', async () => {
    const r = await select([task('TSK-2', 'F2')], ['TSK-1'], { 'TSK-1': ['lib/a.ts'], 'TSK-2': ['lib/a.ts'] }, ['lib/a.ts']);
    expect(r.moduleWaiting).toEqual([{ code: 'TSK-2', item: 'lib/a.ts', with: 'TSK-1' }]);
  });
});

describe('barrels are not hotspots', () => {
  it('recognises a file made only of re-exports', () => {
    expect(isBarrelSource("// components\nexport * from './a';\nexport { B, type C } from './b.tsx';\n/* x */\nexport type * from \"./t\";\n")).toBe(true);
    expect(isBarrelSource("export {\n  A,\n  B,\n} from './ab';\n")).toBe(true);
    expect(isBarrelSource("export * from './a';\nexport const x = 1;\n")).toBe(false);
    expect(isBarrelSource("import { a } from './a';\nexport { a };\n")).toBe(false);
    expect(isBarrelSource('// only a comment\n')).toBe(false);
  });

  it('the path heuristic is a fallback for index files under src', () => {
    expect(looksLikeBarrelPath('src/design-system/index.ts')).toBe(true);
    expect(looksLikeBarrelPath('src/design-system/button.ts')).toBe(false);
    expect(looksLikeBarrelPath('lib/index.ts')).toBe(false);
  });

  it('a barrel shared by two tasks does not block once excluded (the planner removes it from the predictions and hotspots)', async () => {
    const barrel = 'src/design-system/index.ts';
    const exclude = (files: string[]) => files.filter((f) => f !== barrel);
    const r = await select([task('TSK-2', 'F2')], ['TSK-1'], { 'TSK-1': exclude([barrel, 'lib/a.ts']), 'TSK-2': exclude([barrel, 'lib/b.ts']) }, []);
    expect(r.start.map((s) => s.code)).toEqual(['TSK-2']);
    const blocked = await select([task('TSK-2', 'F2')], ['TSK-1'], { 'TSK-1': [barrel], 'TSK-2': [barrel] }, [barrel]);
    expect(blocked.moduleWaiting).toHaveLength(1);
  });
});
