// The list of threads as a tree: each thread under its parent. Active threads go first, then the
// ones set aside and the concluded ones; within each, the most recent activity first. Children keep
// the order in which they were opened. The rest of this file reads that tree the way a treegrid
// needs it (DESIGN.md §3.3, R97, R98): each row's parent, whether it has children, its place among
// its siblings, what a state filter keeps, and what collapsing a row hides.

import type { Exploration } from '../../api/types.ts';

export type ThreadRow = { thread: Exploration; depth: number };

const RANK: Record<string, number> = { active: 0, set_aside: 1, concluded: 2 };

export function threadTree(threads: readonly Exploration[]): ThreadRow[] {
  const ids = new Set(threads.map((t) => t.id));
  const children = new Map<string, Exploration[]>();
  const roots: Exploration[] = [];
  for (const t of threads) {
    if (t.parent_id && ids.has(t.parent_id) && t.parent_id !== t.id) {
      children.set(t.parent_id, [...(children.get(t.parent_id) ?? []), t]);
    } else roots.push(t);
  }
  roots.sort(
    (a, b) =>
      (RANK[a.state] ?? 3) - (RANK[b.state] ?? 3) ||
      Date.parse(b.last_activity) - Date.parse(a.last_activity) ||
      a.id.localeCompare(b.id),
  );
  const rows: ThreadRow[] = [];
  const seen = new Set<string>();
  const walk = (t: Exploration, depth: number) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    rows.push({ thread: t, depth });
    const kids = [...(children.get(t.id) ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    for (const k of kids) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // A cycle in the data would leave threads out: they still show, at the top level.
  for (const t of threads) if (!seen.has(t.id)) walk(t, 0);
  return rows;
}

/** A row of the treegrid: its parent row, whether it has children, and its place among its siblings. */
export type TreeRow = ThreadRow & { parentId: string | null; hasChildren: boolean; posInSet: number; setSize: number };

/** Reads rows in tree order (each one after its parent, as threadTree gives them) as treegrid rows. */
export function treeRows(rows: readonly ThreadRow[]): TreeRow[] {
  const path: string[] = [];
  const parents = rows.map((r) => {
    path.length = r.depth;
    const parent = r.depth > 0 ? (path[r.depth - 1] ?? null) : null;
    path[r.depth] = r.thread.id;
    return parent;
  });
  const siblings = new Map<string, number>();
  const pos = parents.map((p) => {
    const k = p ?? '';
    const n = (siblings.get(k) ?? 0) + 1;
    siblings.set(k, n);
    return n;
  });
  return rows.map((r, i) => ({
    ...r,
    parentId: parents[i] ?? null,
    hasChildren: (rows[i + 1]?.depth ?? -1) > r.depth,
    posInSet: pos[i] ?? 1,
    setSize: siblings.get(parents[i] ?? '') ?? 1,
  }));
}

export type StateFilter = 'all' | 'active' | 'concluded' | 'set_aside';

/**
 * The rows a state filter keeps: the threads in that state, and the threads they sit inside so the
 * nesting still reads (those keep their own state word). It only filters what is loaded.
 */
export function filterRows(rows: readonly ThreadRow[], state: StateFilter): ThreadRow[] {
  if (state === 'all') return [...rows];
  const keep = rows.map((r) => r.thread.state === state);
  // A row stays when it matches or when any row of its subtree (the rows after it, deeper) matches.
  for (let i = rows.length - 1; i >= 0; i--) {
    if (keep[i]) continue;
    const depth = rows[i]?.depth ?? 0;
    for (let j = i + 1; j < rows.length && (rows[j]?.depth ?? 0) > depth; j++) {
      if (keep[j]) {
        keep[i] = true;
        break;
      }
    }
  }
  return rows.filter((_, i) => keep[i]);
}

/** The rows left visible when some rows are collapsed: their descendants hide. */
export function visibleRows<R extends ThreadRow>(rows: readonly R[], collapsed: ReadonlySet<string>): R[] {
  const out: R[] = [];
  let hideDeeperThan: number | null = null;
  for (const r of rows) {
    if (hideDeeperThan !== null && r.depth > hideDeeperThan) continue;
    hideDeeperThan = collapsed.has(r.thread.id) ? r.depth : null;
    out.push(r);
  }
  return out;
}

/** How many threads there are in each state, for the filter's counts. */
export function stateCounts(threads: readonly Pick<Exploration, 'state'>[]): Record<StateFilter, number> {
  const counts: Record<StateFilter, number> = { all: threads.length, active: 0, concluded: 0, set_aside: 0 };
  for (const t of threads) if (t.state === 'active' || t.state === 'concluded' || t.state === 'set_aside') counts[t.state] += 1;
  return counts;
}
