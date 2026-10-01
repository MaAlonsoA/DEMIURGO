// What a task really changed, read from its build steps (no repository access): the merge footprint (every file the
// merged pull request changed, with its status) and, for a task not merged yet, the files of its latest commit.
// Used by E15 (shared files against declared dependencies). A merged task's footprint is the union of all its merged
// requests, and its `at` is the merge time (`build_requests.done_at`), not the time a backfill wrote the step.

import { type EscapeInputs, isOwnedPath, ms } from "./types.ts";

export type FootprintFile = { path: string; status: string };
export type TaskFootprint = {
  task_id: string;
  request_id: string;
  /** When the footprint was written (merge step or latest commit step). */
  at: string;
  merged: boolean;
  files: FootprintFile[];
};

const filesOf = (v: unknown): FootprintFile[] =>
  Array.isArray(v)
    ? v.flatMap((x) =>
        typeof x === "string"
          ? [{ path: x, status: "unknown" }]
          : x && typeof x === "object" && typeof (x as { path?: unknown }).path === "string"
            ? [
                {
                  path: (x as { path: string }).path,
                  status:
                    typeof (x as { status?: unknown }).status === "string"
                      ? (x as { status: string }).status
                      : "unknown",
                },
              ]
            : [],
      )
    : [];

/** One footprint per task: the union of its merged requests' merge footprints, else the latest commit's files. */
export const taskFootprintsOf = (i: EscapeInputs): Map<string, TaskFootprint> => {
  const task = new Map(i.requests.map((r) => [r.id, r]));
  const out = new Map<string, TaskFootprint>();
  const sorted = [...i.steps].sort((a, b) => ms(a.created_at) - ms(b.created_at));
  for (const s of sorted) {
    const r = task.get(s.build_request_id);
    if (!r) continue;
    if (s.stage === "merge" || s.stage === "footprint") {
      const files = filesOf(s.detail.footprint_files).filter((f) => isOwnedPath(f.path));
      if (files.length === 0 || s.outcome !== "ok") continue;
      const at = r.done_at ?? s.created_at;
      const prev = out.get(r.task_id);
      if (!prev?.merged) {
        out.set(r.task_id, { task_id: r.task_id, request_id: r.id, at, merged: true, files });
        continue;
      }
      // Union of every merged request of the task; `added` wins over other statuses of the same path.
      const byPath = new Map(prev.files.map((f) => [f.path, f]));
      for (const f of files) {
        const old = byPath.get(f.path);
        if (!old || (f.status === "added" && old.status !== "added")) byPath.set(f.path, f);
      }
      const later = ms(at) >= ms(prev.at);
      out.set(r.task_id, {
        ...prev,
        request_id: later ? r.id : prev.request_id,
        at: later ? at : prev.at,
        files: [...byPath.values()],
      });
    } else if (s.stage === "commit" && !out.get(r.task_id)?.merged) {
      const files = filesOf(s.detail.files ?? s.detail.own_files).filter((f) => isOwnedPath(f.path));
      if (files.length === 0) continue;
      out.set(r.task_id, { task_id: r.task_id, request_id: r.id, at: s.created_at, merged: false, files });
    }
  }
  return out;
};

/** Task-level `depends_on` (current links), as task id -> the task ids it waits for. */
export const taskDepends = (i: EscapeInputs): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const l of i.links) {
    if (l.type !== "depends_on" || l.to_type !== "task" || l.state === "obsolete") continue;
    out.set(l.from_record_id, (out.get(l.from_record_id) ?? new Set()).add(l.to_record_id));
  }
  return out;
};

/** Every task reachable from `task` through `depends_on`. */
export const reaches = (deps: Map<string, Set<string>>, task: string): Set<string> => {
  const seen = new Set<string>();
  const stack = [...(deps.get(task) ?? [])];
  while (stack.length > 0) {
    const t = stack.pop() as string;
    if (seen.has(t)) continue;
    seen.add(t);
    for (const n of deps.get(t) ?? []) stack.push(n);
  }
  return seen;
};
