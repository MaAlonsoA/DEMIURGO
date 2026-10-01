// E09 — a piece built outside its task's scope: the design step found that the change re-creates or touches
// something another feature owns (a route, a table, a module), so a dependency was not declared (P7); found while
// building (P9). Source: build_steps stage design, detail.ownership[] (entries with kind, name, owner and reason).
// The guard fails the design step (`failed`/`blocked`) precisely when the list is not empty, so every outcome with the
// list counts (validacion-fugas-esc3 §3: the one real ownership escape, TSK-MYA-018 re-creating /auth/sign-in of
// TSK-MEA-008, was dropped by requiring `ok`). `evidence.source` is `guard`. The esc-2 footprint fallback was removed:
// it was E15's shared_without_dependency restricted to another feature, one fact counted twice.

import { type EscapeRule, approvalOf, introducedAt, requestTaskCode } from "./types.ts";

export const e09: EscapeRule = (i) => {
  const taskCode = requestTaskCode(i);
  const taskOfRequest = new Map(i.requests.map((r) => [r.id, r.task_id]));
  const out = [];
  const seen = new Set<string>();
  for (const s of i.steps) {
    if (
      s.stage !== "design" ||
      !["ok", "failed", "blocked"].includes(s.outcome) ||
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
          source: "guard",
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
  return out;
};
