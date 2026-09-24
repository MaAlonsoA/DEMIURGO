// The list of threads as a tree: each thread under its parent. Active threads go first, then the
// ones set aside and the concluded ones; within each, the most recent activity first. Children keep
// the order in which they were opened.

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
