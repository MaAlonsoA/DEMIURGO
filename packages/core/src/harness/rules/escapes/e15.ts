// E15 — a task's declared `depends_on` against the files it really changed (the footprint of the merged pull request;
// the practice is the audit of the queue, auditoria-cola §4: of 12 sampled dependencies 3 were doubtful and 2 were
// missing; the rule is our convention). Two classes, both between merged tasks:
//   declared_without_shared_files — A depends on B (directly) but no file of A is a file B changed: the dependency
//     may be invented (P7 → P9);
//   shared_without_dependency — A changed a file that B added and A does not depend on B, directly or through other
//     tasks, nor waits for B's feature: a dependency that was missing. Only source files count (not styles, tests or
//     documents), and it is one row per task listing the tasks it should have waited for.
// Root configuration, lockfiles, barrels and generated files are not evidence of ownership (`isOwnedPath`).

import { taskDepends, reaches, taskFootprintsOf } from "./footprints.ts";
import { type Escape, type EscapeRule, isCodePath, recordById } from "./types.ts";

export const e15: EscapeRule = (i) => {
  const byId = recordById(i);
  const fp = taskFootprintsOf(i);
  const deps = taskDepends(i);
  const featureOf = new Map<string, string>();
  for (const b of i.taskBases) featureOf.set(b.task_id, b.fdr_id);
  const waits = new Map<string, Set<string>>();
  for (const l of i.links)
    if (l.type === "depends_on" && l.to_type === "fdr" && l.state !== "obsolete")
      waits.set(l.from_record_id, (waits.get(l.from_record_id) ?? new Set()).add(l.to_record_id));
  const out: Escape[] = [];
  const merged = [...fp.values()].filter((f) => f.merged);
  for (const a of merged) {
    const aFiles = new Set(a.files.map((f) => f.path));
    for (const bId of deps.get(a.task_id) ?? []) {
      const b = fp.get(bId);
      if (!b?.merged) continue;
      const shared = b.files.filter((f) => aFiles.has(f.path));
      if (shared.length > 0) continue;
      out.push({
        rule: "E15",
        introduced_phase: "P7",
        found_phase: "P9",
        record_code: byId.get(a.task_id)?.code ?? null,
        subject: `declared_without_shared_files ${byId.get(bId)?.code ?? bId}`,
        evidence: { class: "declared_without_shared_files", task_id: a.task_id, depends_on: bId },
        occurred_at: a.at,
        key: `${a.task_id}:${bId}:declared`,
      });
    }
    const reachable = reaches(deps, a.task_id);
    const missing = new Map<string, string[]>();
    for (const b of merged) {
      if (b.task_id === a.task_id || reachable.has(b.task_id)) continue;
      if (Date.parse(b.at) >= Date.parse(a.at)) continue;
      const bFeature = featureOf.get(b.task_id);
      if (bFeature && waits.get(a.task_id)?.has(bFeature)) continue;
      const added = new Set(b.files.filter((f) => f.status === "added" && isCodePath(f.path)).map((f) => f.path));
      const touched = a.files.filter((f) => added.has(f.path)).map((f) => f.path);
      if (touched.length > 0) missing.set(b.task_id, touched);
    }
    if (missing.size === 0) continue;
    const codes = [...missing.keys()].map((id) => byId.get(id)?.code ?? id);
    out.push({
      rule: "E15",
      introduced_phase: "P7",
      found_phase: "P9",
      record_code: byId.get(a.task_id)?.code ?? null,
      subject: `shared_without_dependency ${codes.join(" ")}`,
      evidence: {
        class: "shared_without_dependency",
        task_id: a.task_id,
        other_tasks: Object.fromEntries([...missing].map(([id, files]) => [byId.get(id)?.code ?? id, files.slice(0, 10)])),
      },
      occurred_at: a.at,
      key: `${a.task_id}:shared`,
    });
  }
  return out;
};
