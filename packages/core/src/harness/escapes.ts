// Harness escapes (salud-del-harness §4): what design did not see and building (or the person) found later, written
// append-only by deterministic rules (rules/escapes/*.ts). No model call. `detectEscapes` reads the stored facts of a
// project once, runs every rule and inserts what is not there yet: the same escape is never written twice per rules
// version (unique project + rules version + dedupe key).

import { type RawBuilder, sql } from "kysely";
import type { Db } from "../db/connection.ts";
import {
  ESCAPE_RULES,
  ESCAPES_RULES_VERSION,
  E11_COMMANDS,
  PENDING_ESCAPE_RULES,
  type Escape,
  type EscapeInputs,
} from "./rules/escapes/index.ts";

export {
  ESCAPES_RULES_VERSION,
  PENDING_ESCAPE_RULES,
} from "./rules/escapes/index.ts";
export type { Escape, EscapeInputs } from "./rules/escapes/index.ts";

export type EscapeWindow = {
  from?: Date | string | null;
  to?: Date | string | null;
};

const iso = (d: unknown): string => new Date(d as Date | string).toISOString();
const isoOrNull = (d: unknown): string | null =>
  d === null || d === undefined ? null : iso(d);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

/** Every stored fact the rules read, for one project. Detail columns are cut to the few keys a rule needs. */
export async function loadEscapeInputs(
  db: Db,
  projectId: string,
): Promise<EscapeInputs> {
  const q = <T>(query: RawBuilder<T>) => query.execute(db).then((r) => r.rows);
  const records = await q(
    sql<{
      id: string;
      code: string;
      type: string;
      created_at: Date;
    }>`select id, code, type, created_at from records where project_id = ${projectId}`,
  );
  const versions = await q(
    sql<{
      id: string;
      record_id: string;
      n: number;
      state: string;
      created_at: Date;
      approved_at: Date | null;
      change_note: string | null;
    }>`
      select id, record_id, n, state, created_at, approved_at, change_note from record_versions where project_id = ${projectId}`,
  );
  const criteria = await q(
    sql<{
      record_version_id: string;
      code: string;
      carry: string;
      verification: string;
    }>`
      select record_version_id, code, carry, verification from criteria where project_id = ${projectId}`,
  );
  const requests = await q(
    sql<{
      id: string;
      task_id: string;
      requested_at: Date;
      state: string;
      withdrawn_at: Date | null;
    }>`
      select id, task_id, requested_at, state, withdrawn_at from build_requests where project_id = ${projectId}`,
  );
  // One small object per step: the whole detail of a builder or evidence step can be hundreds of kilobytes.
  const steps = await q(
    sql<{
      id: string;
      build_request_id: string;
      attempt: number;
      stage: string;
      outcome: string;
      created_at: Date;
      detail: unknown;
    }>`
      select id, build_request_id, attempt, stage, outcome, created_at,
        case when jsonb_typeof(detail) <> 'object' then null
          when stage = 'merge' then jsonb_build_object('needs_you', detail->'needs_you', 'escalated', detail->'escalated', 'tried', detail->'tried')
          when stage = 'withdraw' then jsonb_build_object('reason', detail->'reason')
          when stage = 'design' then jsonb_build_object('ownership', detail->'ownership')
          when stage = 'evidence' then jsonb_build_object('not_run', detail->'not_run')
          when stage = 'builder' then jsonb_build_object('uncovered', detail->'tdd'->'uncovered')
        end as detail
      from build_steps
      where project_id = ${projectId} and stage in ('merge', 'withdraw', 'design', 'evidence', 'builder')`,
  );
  const reviews = await q(
    sql<{
      id: string;
      build_request_id: string;
      created_at: Date;
      comments: unknown;
    }>`select id, build_request_id, created_at, comments from pr_reviews where project_id = ${projectId}`,
  );
  const findingKinds = await q(
    sql<{
      pr_review_id: string;
      comment_index: number;
      category: string;
    }>`select pr_review_id, comment_index, category from review_finding_kinds where project_id = ${projectId}`,
  );
  const holds = await q(
    sql<{
      id: string;
      task_id: string;
      reason: string;
      held_at: Date;
      released_at: Date | null;
    }>`select id, task_id, reason, held_at, released_at from task_holds where project_id = ${projectId}`,
  );
  const covers = await q(
    sql<{
      record_id: string;
      codes: string[];
    }>`select distinct on (record_id) record_id, codes from task_covers where project_id = ${projectId} order by record_id, created_at desc, id desc`,
  );
  // task -> feature it is based on, and the proposal batch that created the task's first version.
  const taskBases = await q(
    sql<{ task_id: string; fdr_id: string; batch_id: string | null }>`
      select distinct tv.record_id as task_id, fv.record_id as fdr_id,
        (select p.batch_id from record_versions v1
           join proposals p on p.id::text = v1.origin->>'id' and v1.origin->>'type' = 'proposal'
           where v1.record_id = tv.record_id and v1.n = 1) as batch_id
      from links l
      join record_versions tv on tv.id = l.from_id
      join records tr on tr.id = tv.record_id and tr.type = 'task'
      join record_versions fv on fv.id = l.to_id
      join records fr on fr.id = fv.record_id and fr.type = 'fdr'
      where l.project_id = ${projectId} and l.type = 'based_on' and l.from_type = 'record_version'`,
  );
  const reviewProposals = await q(
    sql<{
      id: string;
      batch_id: string;
      state: string;
      resolved_at: Date | null;
      verdict: string | null;
      record_code: string | null;
    }>`
      select id, batch_id, state, resolved_at, payload->>'verdict' as verdict, payload->'record'->>'code' as record_code
      from proposals where project_id = ${projectId} and type = 'review'`,
  );
  const ideaConflicts = await q(
    sql<{
      assessment_id: string;
      proposal_id: string;
      citation: string | null;
      created_at: Date;
    }>`
      select a.id as assessment_id, a.proposal_id, f->>'citation' as citation, a.created_at
      from idea_assessments a, jsonb_array_elements(case when jsonb_typeof(a.findings->'findings') = 'array' then a.findings->'findings' else '[]'::jsonb end) f
      where a.project_id = ${projectId} and f->>'finding' = 'conflicts'`,
  );
  const events = await q(
    sql<{
      id: string;
      command: string;
      at: Date;
      entity_id: string | null;
      after: unknown;
      cause: unknown;
      proposal_type: string | null;
    }>`
      select e.id, e.command, e.at, e.entity_id, e.after, e.cause, p.type as proposal_type
      from events e left join proposals p on e.command = 'proposal.reject' and p.id = e.entity_id
      where e.project_id = ${projectId} and e.command in (${sql.join(E11_COMMANDS)})`,
  );
  const bases = await q(
    sql<{
      id: string;
      build_request_id: string;
      attempt: number;
      adopted_at: Date;
    }>`select id, build_request_id, attempt, adopted_at from build_request_bases where project_id = ${projectId}`,
  );
  return {
    projectId,
    records: records.map((r) => ({ ...r, created_at: iso(r.created_at) })),
    versions: versions.map((v) => ({
      ...v,
      created_at: iso(v.created_at),
      approved_at: isoOrNull(v.approved_at),
    })),
    criteria,
    requests: requests.map((r) => ({
      ...r,
      requested_at: iso(r.requested_at),
      withdrawn_at: isoOrNull(r.withdrawn_at),
    })),
    steps: steps.map((s) => ({
      ...s,
      created_at: iso(s.created_at),
      detail: obj(s.detail),
    })),
    reviews: reviews.map((r) => ({
      ...r,
      created_at: iso(r.created_at),
      comments: Array.isArray(r.comments) ? r.comments : [],
    })),
    findingKinds,
    holds: holds.map((h) => ({
      ...h,
      held_at: iso(h.held_at),
      released_at: isoOrNull(h.released_at),
    })),
    covers: covers.map((c) => ({
      record_id: c.record_id,
      codes: c.codes ?? [],
    })),
    taskBases,
    reviewProposals: reviewProposals.map((p) => ({
      ...p,
      resolved_at: isoOrNull(p.resolved_at),
    })),
    ideaConflicts: ideaConflicts.map((c) => ({
      ...c,
      created_at: iso(c.created_at),
    })),
    events: events.map((e) => ({
      ...e,
      at: iso(e.at),
      after: obj(e.after),
      cause: obj(e.cause),
    })),
    bases: bases.map((b) => ({ ...b, adopted_at: iso(b.adopted_at) })),
  };
}

/** Every escape the rules find in the inputs (pure), cut to a window by the time the fact happened. */
export function escapesOf(
  inputs: EscapeInputs,
  window: EscapeWindow = {},
): Escape[] {
  const from = window.from ? new Date(window.from).getTime() : null;
  const to = window.to ? new Date(window.to).getTime() : null;
  const out: Escape[] = [];
  for (const rule of Object.values(ESCAPE_RULES)) {
    for (const e of rule(inputs)) {
      const at = e.occurred_at ? new Date(e.occurred_at).getTime() : null;
      if (
        at !== null &&
        ((from !== null && at < from) || (to !== null && at > to))
      )
        continue;
      out.push(e);
    }
  }
  return out;
}

export type DetectResult = {
  rules_version: string;
  found: number;
  recorded: number;
  by_rule: Record<string, number>;
  pending_rules: readonly string[];
};

/** Detects and records the escapes of a project; idempotent. `recorded` counts only the rows that were new. */
export async function detectEscapes(
  db: Db,
  projectId: string,
  window: EscapeWindow = {},
): Promise<DetectResult> {
  const found = escapesOf(await loadEscapeInputs(db, projectId), window);
  const byRule: Record<string, number> = {};
  let recorded = 0;
  for (let at = 0; at < found.length; at += 200) {
    const batch = found.slice(at, at + 200);
    const rows = await db
      .insertInto("harness_escapes")
      .values(
        batch.map((e) => ({
          project_id: projectId,
          rule: e.rule,
          introduced_phase: e.introduced_phase,
          found_phase: e.found_phase,
          record_code: e.record_code ?? null,
          record_version_id: e.record_version_id ?? null,
          criterion_code: e.criterion_code ?? null,
          build_request_id: e.build_request_id ?? null,
          pr_review_id: e.pr_review_id ?? null,
          comment_index: e.comment_index ?? null,
          subject: e.subject ?? null,
          evidence: JSON.stringify(e.evidence),
          occurred_at: e.occurred_at ?? null,
          rules_version: ESCAPES_RULES_VERSION,
          dedupe_key: `${e.rule}:${e.key}`,
        })),
      )
      .onConflict((oc) =>
        oc.columns(["project_id", "rules_version", "dedupe_key"]).doNothing(),
      )
      .returning("rule")
      .execute();
    recorded += rows.length;
    for (const r of rows) byRule[r.rule] = (byRule[r.rule] ?? 0) + 1;
  }
  return {
    rules_version: ESCAPES_RULES_VERSION,
    found: found.length,
    recorded,
    by_rule: byRule,
    pending_rules: PENDING_ESCAPE_RULES,
  };
}
