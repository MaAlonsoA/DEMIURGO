import { describe, expect, it } from 'vitest';
import type { Exploration } from '../../src/api/types.ts';
import { filterRows, stateCounts, threadTree, treeRows, visibleRows } from '../../src/screens/threads/tree.ts';

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

describe('the list of threads as a treegrid', () => {
  const rows = () =>
    threadTree([
      thread('old', 'active', 0, 5),
      thread('done', 'concluded', 1, 50),
      thread('child-b', 'concluded', 4, 4, 'old'),
      thread('child-a', 'active', 3, 3, 'old'),
      thread('grandchild', 'concluded', 6, 6, 'child-a'),
    ]);

  it("AC-INT-001-09 knows each row's parent, whether it has children and its place among its siblings", () => {
    const tree = treeRows(rows());
    expect(tree.map((r) => [r.thread.id, r.parentId, r.hasChildren, r.posInSet, r.setSize])).toEqual([
      ['old', null, true, 1, 2],
      ['child-a', 'old', true, 1, 2],
      ['grandchild', 'child-a', false, 1, 1],
      ['child-b', 'old', false, 2, 2],
      ['done', null, false, 2, 2],
    ]);
  });

  it('AC-INT-001-09 a state filter keeps the threads in that state and the ones they sit inside', () => {
    expect(filterRows(rows(), 'concluded').map((r) => r.thread.id)).toEqual(['old', 'child-a', 'grandchild', 'child-b', 'done']);
    expect(filterRows(rows(), 'active').map((r) => r.thread.id)).toEqual(['old', 'child-a']);
    expect(filterRows(rows(), 'set_aside')).toEqual([]);
    expect(filterRows(rows(), 'all')).toHaveLength(5);
  });

  it('AC-INT-001-09 collapsing a thread hides every thread inside it, and nothing else', () => {
    const tree = treeRows(rows());
    expect(visibleRows(tree, new Set(['old'])).map((r) => r.thread.id)).toEqual(['old', 'done']);
    expect(visibleRows(tree, new Set(['child-a'])).map((r) => r.thread.id)).toEqual(['old', 'child-a', 'child-b', 'done']);
  });

  it('AC-INT-001-09 counts the threads of each state for the filter', () => {
    expect(stateCounts(rows().map((r) => r.thread))).toEqual({ all: 5, active: 2, concluded: 3, set_aside: 0 });
  });
});
