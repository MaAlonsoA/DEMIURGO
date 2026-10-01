// E09 — a piece built outside its task's scope: the design step found that the change re-creates or touches
// something another feature owns (a route, a table, a module), so a dependency was not declared (P7); found while
// building (P9). Source: build_steps stage design, detail.ownership[] (entries with kind, name, owner and reason).
// esc-2: when no design step of the request listed anything (the list was empty in every step of the sample), the
// footprint stands in: a file the task changed that an earlier merged task of ANOTHER feature added, with no
// dependency on that task (direct or through others) nor on its feature, is a piece built outside the scope. One row
// per request (listing the owner tasks); `evidence.source` is `footprint`. A heuristic by path, never by table.

import { taskDepends, reaches, taskFootprintsOf } from "./footprints.ts";
import { type EscapeRule, approvalOf, introducedAt, isCodePath, ms, recordById, requestTaskCode } from "./types.ts";

export const e09: EscapeRule = (i) => {
  const taskCode = requestTaskCode(i);
  const taskOfRequest = new Map(i.requests.map((r) => [r.id, r.task_id]));
  const out = [];
  const seen = new Set<string>();
  const withOwnership = new Set<string>();
  for (const s of i.steps)
    if (
      s.stage === "design" &&
      Array.isArray(s.detail.ownership) &&
      s.detail.ownership.length > 0
    )
      withOwnership.add(s.build_request_id);
  for (const s of i.steps) {
    if (
      s.stage !== "design" ||
      s.outcome !== "ok" ||
      !Array.isArray(s.detail.ownership)
    )
      continue;
    for (const raw of s.detail.ownership) {
      const o = (
        raw && typeof raw === "object" ? raw : { name: String(raw) }
      ) as {
        kind?: string;
        name?: string;
        owner?: { code?: string };
        reason?: string;
      };
      const subject = `${o.kind ?? "piece"} ${o.name ?? ""}`.trim();
      const key = `${s.build_request_id}:${subject}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        rule: "E09",
        introduced_phase: "P7" as const,
        found_phase: "P9" as const,
        record_code: taskCode.get(s.build_request_id) || null,
        build_request_id: s.build_request_id,
        subject,
        evidence: {
          build_step_id: s.id,
          attempt: s.attempt,
          owner: o.owner?.code ?? null,
          reason: o.reason ?? null,
          ...introducedAt(approvalOf(i, taskOfRequest.get(s.build_request_id) ?? "", s.created_at)),
        },
        occurred_at: s.created_at,
        key,
      });
    }
  }
  const byId = recordById(i);
  const fp = taskFootprintsOf(i);
  const deps = taskDepends(i);
  const featureOf = new Map(i.taskBases.map((b) => [b.task_id, b.fdr_id]));
  const waits = new Map<string, Set<string>>();
  for (const l of i.links)
    if (l.type === "depends_on" && l.to_type === "fdr" && l.state !== "obsolete")
      waits.set(l.from_record_id, (waits.get(l.from_record_id) ?? new Set()).add(l.to_record_id));
  const firstAdder = new Map<string, { task: string; at: string }>();
  for (const f of [...fp.values()]
    .filter((x) => x.merged)
    .sort((a, b) => ms(a.at) - ms(b.at)))
    for (const file of f.files)
      if (file.status === "added" && !firstAdder.has(file.path))
        firstAdder.set(file.path, { task: f.task_id, at: f.at });
  for (const [taskId, mine] of fp) {
    const requestId = mine.request_id;
    if (withOwnership.has(requestId)) continue;
    const feature = featureOf.get(taskId);
    if (!feature) continue;
    const reachable = reaches(deps, taskId);
    const byOwner = new Map<string, string[]>();
    for (const file of mine.files.filter((f) => isCodePath(f.path))) {
      const owner = firstAdder.get(file.path);
      if (!owner || owner.task === taskId || ms(owner.at) >= ms(mine.at)) continue;
      const ownerFeature = featureOf.get(owner.task);
      if (!ownerFeature || ownerFeature === feature) continue;
      if (reachable.has(owner.task) || waits.get(taskId)?.has(ownerFeature)) continue;
      byOwner.set(owner.task, [...(byOwner.get(owner.task) ?? []), file.path]);
    }
    if (byOwner.size === 0) continue;
    const key = `${requestId}:footprint`;
    if (seen.has(key)) continue;
    seen.add(key);
    const first = [...byOwner.values()][0]?.[0];
    out.push({
      rule: "E09",
      introduced_phase: "P7" as const,
      found_phase: "P9" as const,
      record_code: byId.get(taskId)?.code ?? null,
      build_request_id: requestId,
      subject: `file ${first}`,
      evidence: {
        source: "footprint",
        owners: Object.fromEntries(
          [...byOwner].map(([id, files]) => [byId.get(id)?.code ?? id, files.slice(0, 10)]),
        ),
        merged: mine.merged,
        ...introducedAt(approvalOf(i, taskId, mine.at)),
      },
      occurred_at: mine.at,
      key,
    });
  }
  return out;
};
