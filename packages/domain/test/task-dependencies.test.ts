import { describe, expect, it } from 'vitest';
import { findDependencyCycle, orderByDependencies } from '../src/records.ts';

const order = (items: { code: string; deps: string[] }[]) =>
  orderByDependencies(
    items,
    (t) => t.code,
    (t) => t.deps,
  ).map((t) => t.code);

describe('task dependency order', () => {
  it('keeps the order when nothing depends on a later item', () => {
    expect(
      order([
        { code: 'A', deps: [] },
        { code: 'B', deps: ['A'] },
        { code: 'C', deps: [] },
      ]),
    ).toEqual(['A', 'B', 'C']);
  });

  it('puts a task after what it depends on, keeping the rest in place', () => {
    expect(
      order([
        { code: 'A', deps: ['C'] },
        { code: 'B', deps: [] },
        { code: 'C', deps: [] },
        { code: 'D', deps: [] },
      ]),
    ).toEqual(['B', 'C', 'A', 'D']);
  });

  it('ignores dependencies on tasks that are not in the list (already merged) and never hangs on a cycle', () => {
    expect(
      order([
        { code: 'A', deps: ['MERGED'] },
        { code: 'B', deps: [] },
      ]),
    ).toEqual(['A', 'B']);
    expect(
      order([
        { code: 'A', deps: ['B'] },
        { code: 'B', deps: ['A'] },
        { code: 'C', deps: [] },
      ]),
    ).toEqual(['C', 'A', 'B']);
  });
});

describe('findDependencyCycle', () => {
  it('finds the cycle a node is in, and none for a node that only leads into one', () => {
    const graph = new Map([
      ['A', ['B']],
      ['B', ['C']],
      ['C', ['B']],
    ]);
    expect(findDependencyCycle(graph, 'B')).toEqual(['B', 'C']);
    expect(findDependencyCycle(graph, 'A')).toBeNull();
    expect(findDependencyCycle(new Map([['A', ['A']]]), 'A')).toEqual(['A']);
    expect(findDependencyCycle(new Map([['A', ['B']]]), 'A')).toBeNull();
  });
});
