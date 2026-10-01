// E15 — shared_without_dependency: a merged task A changed a file that another merged task B added, and A does not
// depend on B (directly or through other tasks), nor waits for B's feature, nor is A's feature based on B's feature.
// The practice is the audit of the queue (auditoria-cola §4: of 12 sampled dependencies 3 were doubtful and 2 were
// missing); the rule is our convention, tuned by the case-by-case validation of 01-10-2026 (validacion-fugas-esc3 §2):
//   - a feature -> feature `based_on` chain counts as declared (the engine enforces it, queries/task-deps.ts
//     `featureNeeds`);
//   - shared infrastructure (`isInfraPath`: CI, migrate scripts, db client, shared UI primitives) is not evidence;
//   - across features the defect is the feature, designed without the dependency: one row per (feature, owner
//     feature) pair, phase P5, listing the tasks as evidence; within one feature it stays one row per task, P7;
//   - the class `declared_without_shared_files` was removed (0 of 11 real: contract dependencies share no files).
// Only source files count (not styles, tests or documents). Root configuration, lockfiles, barrels and generated
// files are not evidence of ownership (`isOwnedPath`).

import { taskDepends, reaches, taskFootprintsOf } from "./footprints.ts";
import {
  type Escape,
  type EscapeRule,
  approvalOf,
  featureNeedsOf,
  introducedAt,
  isCodePath,
  isInfraPath,
  ms,
  recordById,
} from "./types.ts";

export const e15: EscapeRule = (i) => {
  const byId = recordById(i);
  const fp = taskFootprintsOf(i);
  const deps = taskDepends(i);
  const needs = featureNeedsOf(i);
  const featureOf = new Map<string, string>();
  for (const b of i.taskBases) featureOf.set(b.task_id, b.fdr_id);
  const waits = new Map<string, Set<string>>();
  for (const l of i.links)
    if (l.type === "depends_on" && l.to_type === "fdr" && l.state !== "obsolete")
      waits.set(l.from_record_id, (waits.get(l.from_record_id) ?? new Set()).add(l.to_record_id));
  const out: Escape[] = [];
  const merged = [...fp.values()].filter((f) => f.merged);
  type Pair = { feature: string; owner: string; tasks: Map<string, Record<string, string[]>>; at: string };
  const pairs = new Map<string, Pair>();
  for (const a of merged) {
    const aFeature = featureOf.get(a.task_id);
    const reachable = reaches(deps, a.task_id);
    const missing = new Map<string, string[]>();
    for (const b of merged) {
      if (b.task_id === a.task_id || reachable.has(b.task_id)) continue;
      if (ms(b.at) >= ms(a.at)) continue;
      const bFeature = featureOf.get(b.task_id);
      if (bFeature && waits.get(a.task_id)?.has(bFeature)) continue;
      if (bFeature && aFeature && needs.get(aFeature)?.has(bFeature)) continue;
      const added = new Set(
        b.files.filter((f) => f.status === "added" && isCodePath(f.path) && !isInfraPath(f.path)).map((f) => f.path),
      );
      const touched = a.files.filter((f) => added.has(f.path)).map((f) => f.path);
      if (touched.length > 0) missing.set(b.task_id, touched);
    }
    if (missing.size === 0) continue;
    const sameFeature = new Map<string, string[]>();
    for (const [bId, files] of missing) {
      const bFeature = featureOf.get(bId);
      if (!aFeature || !bFeature || aFeature === bFeature) {
        sameFeature.set(bId, files);
        continue;
      }
      const key = `${aFeature}:${bFeature}`;
      const pair = pairs.get(key) ?? { feature: aFeature, owner: bFeature, tasks: new Map(), at: a.at };
      const mine = pair.tasks.get(a.task_id) ?? {};
      mine[byId.get(bId)?.code ?? bId] = files.slice(0, 10);
      pair.tasks.set(a.task_id, mine);
      if (ms(a.at) < ms(pair.at)) pair.at = a.at;
      pairs.set(key, pair);
    }
    if (sameFeature.size === 0) continue;
    const codes = [...sameFeature.keys()].map((id) => byId.get(id)?.code ?? id);
    out.push({
      rule: "E15",
      introduced_phase: "P7",
      found_phase: "P9",
      record_code: byId.get(a.task_id)?.code ?? null,
      subject: `shared_without_dependency ${codes.join(" ")}`,
      evidence: {
        class: "shared_without_dependency",
        task_id: a.task_id,
        other_tasks: Object.fromEntries([...sameFeature].map(([id, files]) => [byId.get(id)?.code ?? id, files.slice(0, 10)])),
        ...introducedAt(approvalOf(i, a.task_id, a.at)),
      },
      occurred_at: a.at,
      key: `${a.task_id}:shared`,
    });
  }
  for (const p of pairs.values()) {
    const featureCode = byId.get(p.feature)?.code ?? p.feature;
    const ownerCode = byId.get(p.owner)?.code ?? p.owner;
    out.push({
      rule: "E15",
      introduced_phase: "P5",
      found_phase: "P9",
      record_code: featureCode,
      subject: `shared_without_dependency ${ownerCode}`,
      evidence: {
        class: "shared_without_dependency",
        feature_id: p.feature,
        owner_feature_id: p.owner,
        owner_feature: ownerCode,
        tasks: Object.fromEntries([...p.tasks].map(([id, other]) => [byId.get(id)?.code ?? id, other])),
        ...introducedAt(approvalOf(i, p.feature, p.at)),
      },
      occurred_at: p.at,
      key: `${p.feature}:${p.owner}:shared`,
    });
  }
  return out;
};
