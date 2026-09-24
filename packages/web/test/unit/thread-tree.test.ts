import { describe, expect, it } from 'vitest';
import type { Exploration } from '../../src/api/types.ts';
import { threadTree } from '../../src/screens/threads/tree.ts';

const at = (m: number) => new Date(Date.UTC(2026, 8, 24, 10, m)).toISOString();

function thread(id: string, state: string, created: number, activity: number, parent_id: string | null = null): Exploration {
  return {
    id,
    project_id: 'p',
    parent_id,
    purpose: `Purpose ${id}`,
    origin_type: null,
    origin_id: null,
    origin_version: null,
    state,
    state_reason: null,
    opened_by: 'human:ana',
    created_at: at(created),
    open_questions: 0,
    last_activity: at(activity),
  };
}

describe('the list of threads', () => {
  it('AC-INT-001-09 nests each thread under its parent, active ones first and the most recent first', () => {
    const rows = threadTree([
      thread('old', 'active', 0, 5),
      thread('done', 'concluded', 1, 50),
      thread('recent', 'active', 2, 40),
      thread('child-b', 'active', 4, 4, 'old'),
      thread('child-a', 'concluded', 3, 3, 'old'),
      thread('grandchild', 'active', 6, 6, 'child-a'),
      thread('aside', 'set_aside', 7, 60),
    ]);
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.thread.id}`)).toEqual([
      'recent',
      'old',
      '  child-a',
      '    grandchild',
      '  child-b',
      'aside',
      'done',
    ]);
  });

  it('AC-INT-001-09 a thread whose parent is missing, or a cycle, still shows at the top level', () => {
    const rows = threadTree([
      thread('a', 'active', 0, 0, 'gone'),
      thread('b', 'active', 1, 1, 'c'),
      thread('c', 'active', 2, 2, 'b'),
    ]);
    expect(rows.map((r) => r.thread.id).sort()).toEqual(['a', 'b', 'c']);
    expect(rows.find((r) => r.thread.id === 'a')?.depth).toBe(0);
  });
});
