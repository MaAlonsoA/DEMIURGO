import { describe, expect, it } from 'vitest';
import { buildProjectMap } from '../src/build/project-map.ts';

const file = (path: string) => ({ path, additions: 1, deletions: 0, status: 'modified' });
const fp = (code: string, paths: string[]) => ({ code, title: code, merge_commit: null, files: paths.map(file) });

describe('project map', () => {
  it('groups files by folder per feature, finds shared hotspots and lists owners', () => {
    const map = buildProjectMap({
      footprints: [fp('TSK-1', ['a/x.ts', 'a/y.ts', 'pnpm-lock.yaml']), fp('TSK-2', ['a/x.ts']), fp('TSK-3', ['a/x.ts', 'b/z.ts'])],
      taskFeature: new Map([['TSK-1', 'FDR-1'], ['TSK-2', 'FDR-2'], ['TSK-3', 'FDR-2']]),
      featureTitles: new Map([['FDR-1', 'One'], ['FDR-2', 'Two']]),
      owners: { tables: new Map([['t', { feature: 'FDR-1', task: 'TSK-1' }]]), routes: new Map() },
    });
    expect(map.merged_tasks).toBe(3);
    expect(map.hotspots).toEqual([{ path: 'a/x.ts', tasks: 3, of: 3, features: ['FDR-1', 'FDR-2'] }]);
    expect(map.features[0]).toMatchObject({ code: 'FDR-1', title: 'One', folders: [{ dir: 'a', files: ['x.ts', 'y.ts'] }] });
    expect(map.features[1]?.folders.map((f) => f.dir)).toEqual(['a', 'b']);
    expect(map.tables).toEqual([{ name: 't', feature: 'FDR-1', task: 'TSK-1' }]);
  });
  it('is empty without merged tasks', () => {
    const map = buildProjectMap({ footprints: [], taskFeature: new Map(), featureTitles: new Map(), owners: { tables: new Map(), routes: new Map() } });
    expect(map).toEqual({ merged_tasks: 0, hotspots: [], features: [], tables: [], routes: [] });
  });
});
