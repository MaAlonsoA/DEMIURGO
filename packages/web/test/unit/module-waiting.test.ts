import { describe, expect, it } from 'vitest';
import { groupModuleWaiting, itemLabel, kindsOf, type ModuleWaitingEntry } from '../../src/screens/build/moduleWaitingLogic.ts';

const e = (code: string, item: string, w: string, kind: ModuleWaitingEntry['kind'], source: 'actual' | 'predicted' = 'predicted'): ModuleWaitingEntry => ({ code, item, with: w, kind, with_source: source });

describe('groupModuleWaiting', () => {
  it('groups by item and blocker, keeps order and lists each waiting task once', () => {
    const hot = { tasks: 12, of: 27 };
    const groups = groupModuleWaiting([
      { ...e('TSK-2', 'src/layout.tsx', 'TSK-1', 'hotspot', 'actual'), hotspot: hot },
      e('TSK-3', 'table:sets', 'TSK-4', 'table'),
      { ...e('TSK-5', 'src/layout.tsx', 'TSK-1', 'hotspot', 'actual'), hotspot: hot },
      e('TSK-2', 'src/layout.tsx', 'TSK-1', 'hotspot', 'actual'),
      { ...e('TSK-6', 'src/layout.tsx', 'TSK-7', 'hotspot'), hotspot: hot },
    ]);
    expect(groups.map((g) => [g.item, g.with, g.waiting])).toEqual([
      ['src/layout.tsx', 'TSK-1', ['TSK-2', 'TSK-5']],
      ['table:sets', 'TSK-4', ['TSK-3']],
      ['src/layout.tsx', 'TSK-7', ['TSK-6']],
    ]);
    expect(groups[0]).toMatchObject({ kind: 'hotspot', source: 'actual', hotspot: hot });
    expect(groups[1]?.hotspot).toBeUndefined();
    expect(kindsOf(groups)).toEqual(['hotspot', 'table']);
  });

  it('shows a module id without its prefix', () => {
    expect(itemLabel('table:sets')).toBe('sets');
    expect(itemLabel('server_action:src/app/x.ts')).toBe('src/app/x.ts');
    expect(itemLabel('src/a.ts')).toBe('src/a.ts');
  });
});
