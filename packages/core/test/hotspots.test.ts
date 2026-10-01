// «Build the queue» does not start two tasks that change the same hotspot or the same table/route module.
// Pure: fake footprints, predictions and code map; no database.

import { describe, expect, it } from 'vitest';
import { selectStarts, sharedItem } from '../src/build/auto.ts';
import { assemble, type CodeFile } from '../src/build/code-map.ts';
import { hotspotCounts, isHotspot, isHotspotCandidate } from '../src/build/hotspots.ts';
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

  it('does nothing without predictions', async () => {
    const r = await select([task('TSK-2', 'F2')], ['TSK-1'], {});
    expect(r.start.map((s) => s.code)).toEqual(['TSK-2']);
    expect(r.moduleWaiting).toEqual([]);
  });
});
