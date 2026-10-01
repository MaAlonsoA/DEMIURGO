// Recheck (build/recheck.ts): design records and docs that enter main never send a task through CI again.

import { describe, expect, it } from 'vitest';
import { needsRecheck } from '../src/build/recheck.ts';
import { designOnly } from '../src/repo/repo.ts';

describe('recheck after main moved', () => {
  it('only design records or docs entered main: no recheck, even when the task has a migration', () => {
    const d = needsRecheck({ taskFiles: ['migrations/0004_strength.sql', 'src/app/page.tsx'], mainFiles: ['design/tasks/TSK-MEA-038.md', 'design/tasks/TSK-MEA-039.md'], map: null });
    expect(d).toEqual({ recheck: false, reason: 'docs_only' });
  });

  it('code next to the docs still counts', () => {
    expect(needsRecheck({ taskFiles: ['migrations/0004_strength.sql'], mainFiles: ['design/tasks/TSK-MEA-038.md', 'src/lib/day.ts'], map: null }).recheck).toBe(true);
  });

  it('a design-only commit is marked to skip CI', () => {
    expect(designOnly(['design/tasks/TSK-MEA-038.md', 'design/fdr/FDR-MEA-005.md'])).toBe(true);
    expect(designOnly(['design/tasks/TSK-MEA-038.md', 'src/app/page.tsx'])).toBe(false);
    expect(designOnly([])).toBe(false);
  });
});
