// When does a pull request behind main need CI again (build/recheck.ts).

import { describe, expect, it } from 'vitest';
import { assemble, type CodeFile } from '../src/build/code-map.ts';
import { needsRecheck } from '../src/build/recheck.ts';

const file = (path: string, imports: string[] = []): CodeFile => ({ path, kind: 'lib', modules: [], symbols: [], imports });
const map = assemble('c', [file('src/a.ts', ['src/b.ts']), file('src/b.ts', ['src/c.ts']), file('src/c.ts'), file('src/x.ts'), file('src/y.ts')]);

describe('needsRecheck', () => {
  it('skips CI when the two sides are disjoint', () => {
    expect(needsRecheck({ taskFiles: ['src/x.ts'], mainFiles: ['src/y.ts'], map })).toEqual({ recheck: false, reason: 'disjoint' });
  });
  it('rechecks when a file is in both sets', () => {
    expect(needsRecheck({ taskFiles: ['src/x.ts'], mainFiles: ['src/x.ts'], map }).reason).toBe('same_file');
  });
  it('rechecks when the task imports, even transitively, something main changed', () => {
    expect(needsRecheck({ taskFiles: ['src/a.ts'], mainFiles: ['src/c.ts'], map })).toEqual({ recheck: true, reason: 'task_imports_main_change' });
  });
  it('rechecks when what main changed imports something the task changed', () => {
    expect(needsRecheck({ taskFiles: ['src/c.ts'], mainFiles: ['src/a.ts'], map })).toEqual({ recheck: true, reason: 'main_change_imports_task' });
  });
  it.each([
    ['migrations/0005_x.sql', 'schema'],
    ['db/schema.prisma', 'schema'],
    ['package.json', 'dependencies'],
    ['pnpm-lock.yaml', 'dependencies'],
    ['.github/workflows/ci.yml', 'ci_workflow'],
    ['next.config.mjs', 'config'],
    ['playwright.config.ts', 'config'],
    ['vitest.config.ts', 'config'],
    ['apps/web/tsconfig.json', 'config'],
  ])('rechecks when main touches %s', (path, reason) => {
    expect(needsRecheck({ taskFiles: ['src/x.ts'], mainFiles: [path], map })).toEqual({ recheck: true, reason });
  });
  it('rechecks when the task touches a shared surface', () => {
    expect(needsRecheck({ taskFiles: ['package.json'], mainFiles: ['src/y.ts'], map }).reason).toBe('dependencies');
  });
  it('rechecks when there is no code map (fail safe)', () => {
    expect(needsRecheck({ taskFiles: ['src/x.ts'], mainFiles: ['src/y.ts'], map: null })).toEqual({ recheck: true, reason: 'no_code_map' });
  });
});
