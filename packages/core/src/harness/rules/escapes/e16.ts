// E16 — a feature approved without a task plan while other work waits for it: tasks (or features) that depend on the
// feature stay not ready until its tasks exist and are built. The case that gave the rule: FDR-MYA-002, approved
// with no plan while ten tasks waited for it for hours. Introduced where the plan was due (P7), found when the queue
// has the dependents waiting (P9). Waiting time is from the later of the approval and the first dependent's creation
// to the first task of the feature (or, with no plan at all, to the newest timestamp the inputs know). One hour is the
// least that counts (our convention). Sources: approved feature versions, task records based on features, and
// `depends_on` (a task waiting for the feature) or feature-to-feature `based_on` (its tasks wait) links.

import { type EscapeRule, introducedAt, ms, recordById } from "./types.ts";

const MIN_WAIT_MS = 60 * 60 * 1000;

export const e16: EscapeRule = (i) => {
  const byId = recordById(i);
  const planned = new Map<string, number>();
  for (const b of i.taskBases) {
    const task = byId.get(b.task_id);
    if (!task) continue;
    planned.set(b.fdr_id, Math.min(planned.get(b.fdr_id) ?? Infinity, ms(task.created_at)));
  }
  const tasksOfFeature = new Map<string, string[]>();
  for (const b of i.taskBases)
    tasksOfFeature.set(b.fdr_id, [...(tasksOfFeature.get(b.fdr_id) ?? []), b.task_id]);
  const horizon = Math.max(
    ...i.records.map((r) => ms(r.created_at)),
    ...i.versions.map((v) => ms(v.created_at)),
  );
  const out = [];
  for (const f of i.records.filter((r) => r.type === "fdr")) {
    const approved = i.versions
      .filter((v) => v.record_id === f.id && v.approved_at !== null)
      .sort((a, b) => ms(a.approved_at) - ms(b.approved_at))[0];
    if (!approved?.approved_at) continue;
    const dependents = new Map<string, number>();
    for (const l of i.links) {
      if (l.to_record_id !== f.id || l.state === "obsolete") continue;
      const from = byId.get(l.from_record_id);
      if (!from) continue;
      if (l.type === "depends_on" && from.type === "task")
        dependents.set(from.id, ms(from.created_at));
      else if (l.type === "based_on" && from.type === "fdr" && from.id !== f.id)
        for (const t of tasksOfFeature.get(from.id) ?? [])
          dependents.set(t, ms(byId.get(t)?.created_at));
    }
    const planAt = planned.get(f.id);
    const start = Math.max(ms(approved.approved_at), Math.min(...dependents.values()));
    const end = planAt ?? horizon;
    if (dependents.size === 0 || !Number.isFinite(start)) continue;
    if (planAt !== undefined && [...dependents.values()].every((d) => d >= planAt)) continue;
    const waited = end - start;
    if (waited < MIN_WAIT_MS) continue;
    out.push({
      rule: "E16",
      introduced_phase: "P7" as const,
      found_phase: "P9" as const,
      record_code: f.code,
      record_version_id: approved.id,
      subject: `${dependents.size} waiting`,
      evidence: {
        feature_id: f.id,
        waiting_tasks: [...dependents.keys()].slice(0, 50),
        waiting: dependents.size,
        hours_waited: Math.round((waited / 3_600_000) * 10) / 10,
        planned: planAt !== undefined,
        ...introducedAt(approved.approved_at),
      },
      occurred_at: approved.approved_at,
      key: f.id,
    });
  }
  return out;
};
