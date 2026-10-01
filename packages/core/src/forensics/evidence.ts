// The evidence bundle of a task forensic: everything stored about how one task was designed and built, gathered
// from the database in a deterministic order and bounded (each section is cut with a note, the whole stays at
// about 120k characters). Pure assembly: no model, no clock, no write. Its sha256 is the `evidence_hash` of the
// forensic: the same hash means the agent would read the same evidence. A blameless postmortem needs the whole
// timeline, not only the failure (Google SRE book, ch. 15 «Postmortem Culture: Learning from Failure»).

import { fingerprint } from '@demiurgo/domain';
import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';
import { taskCoversOf } from '../queries/sizes.ts';

/** The total the bundle stays under, in characters (convención nuestra: what one agent run reads comfortably). */
export const EVIDENCE_MAX_CHARS = 120_000;

/** What each section may take; they add up to less than `EVIDENCE_MAX_CHARS`. */
export const EVIDENCE_CAPS = {
  definition: 3_000,
  feature: 8_000,
  task_versions: 12_000,
  criteria: 9_000,
  graph: 4_000,
  opinions: 5_000,
  queue_decisions: 4_000,
  build_requests: 5_000,
  build_steps: 28_000,
  pr_reviews: 12_000,
  tests: 6_000,
  merge_footprint: 5_000,
  harness_post_mortem: 5_000,
  harness_escapes: 5_000,
  issues: 3_000,
  events: 8_000,
} as const;

export type EvidenceSection = { name: string; text: string; omitted_chars: number };

export type EvidenceBundle = {
  task: { id: string; code: string; title: string | null };
  /** The latest approved (else latest) version of the task at the time of the analysis. */
  task_version_id: string;
  request_ids: string[];
  sections: EvidenceSection[];
  total_chars: number;
  hash: string;
};

// Timestamps come out of pg as Date; the schema types them as column types, hence `unknown`.
const iso = (d: unknown): string | null => (d === null || d === undefined ? null : new Date(d as Date | string).toISOString());
const id8 = (id: string | null | undefined): string | null => (id ? id.slice(0, 8) : null);

type ClipOptions = { str: number; arr: number; depth: number };
const CLIP: ClipOptions = { str: 500, arr: 25, depth: 6 };

/** Cuts long strings and long arrays inside a value so one verbose field cannot eat a section. */
export function clip(value: unknown, o: ClipOptions = CLIP, depth = 0): unknown {
  if (typeof value === 'string') return value.length > o.str ? `${value.slice(0, o.str)}…[+${value.length - o.str} chars]` : value;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= o.depth) return '[…]';
  if (Array.isArray(value)) {
    const head = value.slice(0, o.arr).map((v) => clip(v, o, depth + 1));
    return value.length > o.arr ? [...head, `[+${value.length - o.arr} more]`] : head;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, clip(v, o, depth + 1)]),
  );
}

/** A section: rows are dropped from the middle (the start and the end of a story matter most); an object is cut by length. */
function section(name: string, cap: number, data: unknown): EvidenceSection {
  const whole = JSON.stringify(data);
  if (whole.length <= cap) return { name, text: whole, omitted_chars: 0 };
  if (Array.isArray(data)) {
    const rows = data.map((r) => JSON.stringify(r));
    let head = Math.ceil(rows.length / 2);
    let tail = rows.length - head;
    const render = () => {
      const omitted = rows.length - head - tail;
      return `[${[...rows.slice(0, head), JSON.stringify({ omitted_rows: omitted }), ...rows.slice(rows.length - tail)].join(',')}]`;
    };
    let text = render();
    while (text.length > cap && head + tail > 2) {
      if (head >= tail) head--;
      else tail--;
      text = render();
    }
    return { name, text, omitted_chars: Math.max(0, whole.length - text.length) };
  }
  const text = `${whole.slice(0, cap)}…[section truncated]`;
  return { name, text, omitted_chars: whole.length - cap };
}

/** Rows that repeat (the same decision on every tick) become one row with its first and last time and a count. */
function runs<T extends Record<string, unknown>>(rows: T[], key: (r: T) => string, at: (r: T) => string | null): (T & { first_at: string | null; last_at: string | null; times: number })[] {
  const out: (T & { first_at: string | null; last_at: string | null; times: number })[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && key(last) === key(r)) {
      last.last_at = at(r);
      last.times++;
    } else out.push({ ...r, first_at: at(r), last_at: at(r), times: 1 });
  }
  return out;
}

type Sections = { name: string; text: string; omitted_chars: number }[];

/** Gathers the bundle of one task (a record id of type task) of a project. Deterministic: same rows, same bundle, same hash. */
export async function buildTaskEvidence(db: Db, projectId: string, taskId: string): Promise<EvidenceBundle> {
  const task = await db.selectFrom('records').select(['id', 'code', 'type']).where('id', '=', taskId).where('project_id', '=', projectId).executeTakeFirstOrThrow();
  const versions = await db
    .selectFrom('record_versions')
    .select(['id', 'n', 'title', 'sections', 'change_note', 'state', 'approved_at', 'approved_by', 'created_at', 'author', 'origin'])
    .where('record_id', '=', taskId)
    .orderBy('n')
    .execute();
  const versionIds = versions.map((v) => v.id);
  const versionN = new Map(versions.map((v) => [v.id, v.n]));
  const latest = [...versions].reverse().find((v) => v.state === 'approved') ?? versions[versions.length - 1];
  if (!latest) throw new Error(`The task ${task.code} has no version.`);

  const requests = await db
    .selectFrom('build_requests')
    .select(['id', 'task_version_id', 'feature_version_id', 'brief', 'state', 'requested_by', 'requested_at', 'withdrawn_by', 'withdrawn_at', 'done_at', 'branch', 'pr_number', 'head_sha'])
    .where('project_id', '=', projectId)
    .where('task_id', '=', taskId)
    .orderBy('requested_at')
    .orderBy('id')
    .execute();
  const requestIds = requests.map((r) => r.id);
  const bases = requestIds.length
    ? await db.selectFrom('build_request_bases').select(['build_request_id', 'attempt', 'task_version_id', 'feature_version_id', 'adopted_by', 'adopted_at']).where('build_request_id', 'in', requestIds).orderBy('adopted_at').orderBy('id').execute()
    : [];

  // Graph: outbound and inbound links of every version of the task.
  const outbound = versionIds.length
    ? await db
        .selectFrom('links')
        .innerJoin('record_versions as tv', 'tv.id', 'links.to_id')
        .innerJoin('records as tr', 'tr.id', 'tv.record_id')
        .select(['links.type', 'links.from_id', 'links.state', 'tr.code as to_code', 'tr.type as to_type', 'tv.n as to_n', 'tv.id as to_version_id'])
        .where('links.project_id', '=', projectId)
        .where('links.from_id', 'in', versionIds)
        .orderBy('links.created_at')
        .orderBy('links.id')
        .execute()
    : [];
  const inbound = versionIds.length
    ? await db
        .selectFrom('links')
        .innerJoin('record_versions as fv', 'fv.id', 'links.from_id')
        .innerJoin('records as fr', 'fr.id', 'fv.record_id')
        .select(['links.type', 'links.to_id', 'fr.code as from_code', 'fr.type as from_type', 'fv.n as from_n'])
        .where('links.project_id', '=', projectId)
        .where('links.to_id', 'in', versionIds)
        .orderBy('links.created_at')
        .orderBy('links.id')
        .execute()
    : [];
  const covers = await taskCoversOf(db, taskId);

  // The feature (and its epic): the one the latest request was built against, else the one the task is based on.
  const featureVersionId =
    [...requests].reverse().find((r) => r.feature_version_id)?.feature_version_id ??
    outbound.find((l) => l.to_type === 'fdr')?.to_version_id ??
    null;
  const feature = featureVersionId
    ? await db
        .selectFrom('record_versions as v')
        .innerJoin('records as r', 'r.id', 'v.record_id')
        .select(['v.id', 'v.n', 'v.title', 'v.sections', 'v.change_note', 'r.code', 'r.id as record_id'])
        .where('v.id', '=', featureVersionId)
        .executeTakeFirst()
    : undefined;
  const epic = feature
    ? await db
        .selectFrom('links')
        .innerJoin('record_versions as ev', 'ev.id', 'links.to_id')
        .innerJoin('records as er', 'er.id', 'ev.record_id')
        .select(['er.code', 'ev.n', 'ev.title', 'ev.sections'])
        .where('links.from_id', '=', feature.id)
        .where('er.type', '=', 'epic')
        .orderBy('links.created_at')
        .executeTakeFirst()
    : undefined;
  const criteria =
    feature && covers.length > 0
      ? await db
          .selectFrom('criteria')
          .select(['code', 'title', 'given_text', 'when_text', 'then_text', 'statement', 'verification', 'check_text', 'step'])
          .where('record_version_id', '=', feature.id)
          .where('code', 'in', covers)
          .orderBy('position')
          .execute()
      : [];
  const definition = await db
    .selectFrom('record_versions as v')
    .innerJoin('records as r', 'r.id', 'v.record_id')
    .select(['r.code', 'v.n', 'v.title', 'v.sections'])
    .where('r.project_id', '=', projectId)
    .where('r.type', '=', 'product_definition')
    .where('v.state', '=', 'approved')
    .orderBy('v.n', 'desc')
    .executeTakeFirst();

  // Jev's judgments about the task.
  const needs = await db
    .selectFrom('task_need_opinions as o')
    .innerJoin('records as nr', 'nr.id', 'o.needed_record_id')
    .select(['o.record_version_id', 'nr.code as needed', 'o.p', 'o.question_version', 'o.created_at'])
    .where('o.record_id', '=', taskId)
    .orderBy('o.created_at')
    .orderBy('o.id')
    .execute();
  const testability = await db
    .selectFrom('task_testability_opinions')
    .select(['record_version_id', 'criterion_code', 'needs_outside_ci', 'needs_unbuilt_feature', 'needs_kind', 'classifier_id', 'created_at'])
    .where('record_id', '=', taskId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const layers = await db.selectFrom('task_layers_opinions').select(['record_version_id', 'schema_p', 'classifier_id', 'created_at']).where('record_id', '=', taskId).orderBy('created_at').orderBy('id').execute();
  const holds = await db.selectFrom('task_holds').select(['reason', 'held_by', 'held_at', 'released_by', 'released_at']).where('task_id', '=', taskId).orderBy('held_at').orderBy('id').execute();

  const decisions = await db
    .selectFrom('queue_decisions as d')
    .innerJoin('queue_plans as p', 'p.id', 'd.plan_id')
    .select(['p.decided_at', 'd.decision', 'd.item', 'd.with_task', 'd.with_source', 'd.evidence'])
    .where('d.project_id', '=', projectId)
    .where('d.task_code', '=', task.code)
    .orderBy('p.decided_at')
    .orderBy('d.id')
    .execute();

  const steps = requestIds.length
    ? await db
        .selectFrom('build_steps')
        .select(['id', 'build_request_id', 'attempt', 'stage', 'outcome', 'detail', 'created_at'])
        .where('build_request_id', 'in', requestIds)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    : [];
  const reviews = requestIds.length
    ? await db
        .selectFrom('pr_reviews as r')
        .leftJoin('ai_runs as a', 'a.id', 'r.run_id')
        .select(['r.id', 'r.build_request_id', 'r.verdict', 'r.summary', 'r.comments', 'r.criteria', 'r.created_at', 'a.provider', 'a.requested_model', 'a.model', 'a.effort', 'a.state as run_state'])
        .where('r.build_request_id', 'in', requestIds)
        .orderBy('r.created_at')
        .orderBy('r.id')
        .execute()
    : [];
  const kinds = reviews.length
    ? await db.selectFrom('review_finding_kinds').select(['pr_review_id', 'comment_index', 'category', 'p', 'avoidable_p']).where('pr_review_id', 'in', reviews.map((r) => r.id)).orderBy('pr_review_id').orderBy('comment_index').execute()
    : [];
  const testRuns = requestIds.length
    ? await db
        .selectFrom('test_runs')
        .select(['build_request_id', 'attempt', 'outcome', 'test_name', 'file', 'criterion_code', 'failure', 'recorded_at'])
        .where('build_request_id', 'in', requestIds)
        .orderBy('recorded_at')
        .orderBy('id')
        .execute()
    : [];

  // The harness post-mortem of each request: the newest rules version's, with its findings.
  const postmortems = requestIds.length
    ? await db
        .selectFrom('harness_postmortems')
        .select(['id', 'build_request_id', 'rules_version', 'outcome', 'attempts', 'findings', 'computed_at'])
        .where('build_request_id', 'in', requestIds)
        .orderBy('computed_at', 'desc')
        .orderBy('id', 'desc')
        .execute()
    : [];
  const newestPostmortem = new Map<string, (typeof postmortems)[number]>();
  for (const p of postmortems) if (!newestPostmortem.has(p.build_request_id)) newestPostmortem.set(p.build_request_id, p);
  const findingRows = newestPostmortem.size
    ? await db
        .selectFrom('harness_findings')
        .select(['postmortem_id', 'build_request_id', 'attempt', 'piece', 'finding', 'class', 'ground_truth', 'value', 'unit', 'subject'])
        .where('postmortem_id', 'in', [...newestPostmortem.values()].map((p) => p.id))
        .orderBy('build_request_id')
        .orderBy('attempt')
        .orderBy('id')
        .execute()
    : [];

  const escapes = await db
    .selectFrom('harness_escapes')
    .select(['rule', 'introduced_phase', 'found_phase', 'record_code', 'criterion_code', 'build_request_id', 'subject', 'evidence', 'rules_version', 'occurred_at', 'detected_at'])
    .where('project_id', '=', projectId)
    .where((eb) =>
      eb.or([
        eb('record_code', '=', task.code),
        ...(requestIds.length ? [eb('build_request_id', 'in', requestIds)] : []),
        eb(sql<string>`evidence::text`, 'like', `%${task.code}%`),
      ]),
    )
    .orderBy('detected_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const issues = await db
    .selectFrom('issues')
    .select(['code', 'kind', 'title', 'body', 'state', 'close_reason', 'opened_by', 'opened_at', 'criterion_code', 'attempt'])
    .where('project_id', '=', projectId)
    .where((eb) => eb.or([eb('task_id', '=', taskId), eb('resolution_task_id', '=', taskId)]))
    .orderBy('opened_at')
    .orderBy('id')
    .execute();
  const entityIds = [taskId, ...versionIds, ...requestIds, ...reviews.map((r) => r.id)];
  const events = await db
    .selectFrom('events')
    .select(['seq', 'at', 'actor', 'command', 'entity_type', 'entity_id', 'state_before', 'state_after', 'after'])
    .where('project_id', '=', projectId)
    .where('entity_id', 'in', entityIds)
    .orderBy('seq')
    .limit(400)
    .execute();

  // The merge footprint: files and symbols, kept on the merge step.
  const footprints = steps
    .filter((s) => s.stage === 'merge' && (s.detail as { footprint?: unknown } | null)?.footprint)
    .map((s) => ({ request: id8(s.build_request_id), footprint: (s.detail as { footprint: unknown }).footprint }));

  const sections: Sections = [
    section('definition', EVIDENCE_CAPS.definition, definition ? { code: definition.code, n: definition.n, title: definition.title, sections: clip(definition.sections, { str: 500, arr: 12, depth: 4 }) } : null),
    section('feature', EVIDENCE_CAPS.feature, {
      feature: feature ? { code: feature.code, n: feature.n, title: feature.title, change_note: feature.change_note, sections: clip(feature.sections, { str: 1_200, arr: 12, depth: 4 }) } : null,
      epic: epic ? { code: epic.code, n: epic.n, title: epic.title, sections: clip(epic.sections, { str: 600, arr: 6, depth: 4 }) } : null,
    }),
    section(
      'task_versions',
      EVIDENCE_CAPS.task_versions,
      versions.map((v) => ({ n: v.n, state: v.state, title: v.title, change_note: v.change_note, author: v.author, created_at: iso(v.created_at), approved_at: iso(v.approved_at), origin: clip(v.origin, { str: 200, arr: 5, depth: 3 }), sections: clip(v.sections, { str: 1_500, arr: 10, depth: 4 }) })),
    ),
    section(
      'criteria',
      EVIDENCE_CAPS.criteria,
      criteria.map((c) => ({ code: c.code, title: c.title, verification: c.verification, step: c.step, given: c.given_text, when: c.when_text, then: c.then_text, statement: c.given_text ? undefined : c.statement, check: c.check_text })),
    ),
    section('graph', EVIDENCE_CAPS.graph, {
      covers,
      outbound: outbound.map((l) => ({ type: l.type, state: l.state, from_n: versionN.get(l.from_id) ?? null, to: `${l.to_code}@${l.to_n}`, to_type: l.to_type })),
      inbound: inbound.map((l) => ({ type: l.type, from: `${l.from_code}@${l.from_n}`, from_type: l.from_type, to_n: versionN.get(l.to_id) ?? null })),
    }),
    section('opinions', EVIDENCE_CAPS.opinions, {
      needs: needs.map((o) => ({ version_n: versionN.get(o.record_version_id) ?? null, needed: o.needed, p: o.p, question_version: o.question_version, at: iso(o.created_at) })),
      testability: testability.map((o) => ({ version_n: versionN.get(o.record_version_id) ?? null, criterion: o.criterion_code, needs_outside_ci: o.needs_outside_ci, needs_unbuilt_feature: o.needs_unbuilt_feature, needs_kind: o.needs_kind, at: iso(o.created_at) })),
      layers: layers.map((o) => ({ version_n: versionN.get(o.record_version_id) ?? null, schema_p: o.schema_p, at: iso(o.created_at) })),
      holds: holds.map((h) => ({ reason: h.reason, held_by: h.held_by, held_at: iso(h.held_at), released_at: iso(h.released_at) })),
    }),
    section(
      'queue_decisions',
      EVIDENCE_CAPS.queue_decisions,
      runs(
        decisions.map((d) => ({ decision: d.decision, item: d.item, with_task: d.with_task, with_source: d.with_source, evidence: clip(d.evidence, { str: 200, arr: 5, depth: 3 }), at: iso(d.decided_at) })),
        (r) => `${r.decision}|${r.item}|${r.with_task}`,
        (r) => r.at,
      ).map(({ at: _at, ...rest }) => rest),
    ),
    section(
      'build_requests',
      EVIDENCE_CAPS.build_requests,
      requests.map((r) => ({
        id: id8(r.id),
        state: r.state,
        task_version_n: versionN.get(r.task_version_id) ?? null,
        requested_by: r.requested_by,
        requested_at: iso(r.requested_at),
        withdrawn_at: iso(r.withdrawn_at),
        done_at: iso(r.done_at),
        branch: r.branch,
        pr_number: r.pr_number,
        brief: clip(r.brief, { str: 900, arr: 5, depth: 2 }),
        bases: bases.filter((b) => b.build_request_id === r.id).map((b) => ({ attempt: b.attempt, task_version_n: versionN.get(b.task_version_id) ?? null, by: b.adopted_by, at: iso(b.adopted_at) })),
      })),
    ),
    section(
      'build_steps',
      EVIDENCE_CAPS.build_steps,
      steps.map((s) => {
        const { footprint: _f, ...detail } = (s.detail ?? {}) as Record<string, unknown>;
        return { step: id8(s.id), request: id8(s.build_request_id), attempt: s.attempt, stage: s.stage, outcome: s.outcome, at: iso(s.created_at), detail: clip(detail, { str: 450, arr: 12, depth: 5 }) };
      }),
    ),
    section(
      'pr_reviews',
      EVIDENCE_CAPS.pr_reviews,
      reviews.map((r) => ({
        review: id8(r.id),
        request: id8(r.build_request_id),
        at: iso(r.created_at),
        verdict: r.verdict,
        engine: { provider: r.provider, model: r.model ?? r.requested_model, effort: r.effort, run_state: r.run_state },
        summary: clip(r.summary, { str: 600, arr: 1, depth: 1 }),
        comments: (r.comments as { path?: string; line?: number | null; severity?: string; body?: string; needs_person?: boolean }[]).map((c, i) => ({
          i,
          path: c.path,
          line: c.line,
          severity: c.severity,
          needs_person: c.needs_person,
          body: clip(c.body, { str: 450, arr: 1, depth: 1 }),
          jev: kinds.filter((k) => k.pr_review_id === r.id && k.comment_index === i).map((k) => ({ category: k.category, p: k.p, avoidable_p: k.avoidable_p }))[0] ?? null,
        })),
        criteria: (r.criteria as { code: string; covered: boolean; test_name: string | null }[]).map((c) => ({ code: c.code, covered: c.covered, test: c.test_name })),
      })),
    ),
    section('tests', EVIDENCE_CAPS.tests, {
      per_attempt: Object.entries(
        testRuns.reduce<Record<string, { pass: number; fail: number; skip: number }>>((acc, t) => {
          const k = `${id8(t.build_request_id)}#${t.attempt ?? '?'}`;
          const row = (acc[k] ??= { pass: 0, fail: 0, skip: 0 });
          row[t.outcome]++;
          return acc;
        }, {}),
      ).map(([attempt, counts]) => ({ attempt, ...counts })),
      failures: testRuns
        .filter((t) => t.outcome === 'fail')
        .map((t) => ({ request: id8(t.build_request_id), attempt: t.attempt, test: t.test_name, file: t.file, criterion: t.criterion_code, failure: clip(t.failure, { str: 350, arr: 1, depth: 1 }) })),
    }),
    section('merge_footprint', EVIDENCE_CAPS.merge_footprint, clip(footprints, { str: 160, arr: 60, depth: 6 })),
    section(
      'harness_post_mortem',
      EVIDENCE_CAPS.harness_post_mortem,
      [...newestPostmortem.values()].map((p) => ({
        request: id8(p.build_request_id),
        rules_version: p.rules_version,
        outcome: p.outcome,
        attempts: p.attempts,
        findings: findingRows
          .filter((f) => f.postmortem_id === p.id)
          .map((f) => ({ attempt: f.attempt, piece: f.piece, class: f.class, finding: clip(f.finding, { str: 220, arr: 1, depth: 1 }), truth: f.ground_truth, value: f.value, unit: f.unit, subject: f.subject })),
      })),
    ),
    section(
      'harness_escapes',
      EVIDENCE_CAPS.harness_escapes,
      escapes.map((e) => ({ rule: e.rule, introduced: e.introduced_phase, found: e.found_phase, criterion: e.criterion_code, request: id8(e.build_request_id), subject: e.subject, rules_version: e.rules_version, at: iso(e.occurred_at ?? e.detected_at), evidence: clip(e.evidence, { str: 160, arr: 6, depth: 3 }) })),
    ),
    section(
      'issues',
      EVIDENCE_CAPS.issues,
      issues.map((i) => ({ code: i.code, kind: i.kind, state: i.state, title: i.title, criterion: i.criterion_code, attempt: i.attempt, opened_at: iso(i.opened_at), close_reason: i.close_reason, body: clip(i.body, { str: 350, arr: 1, depth: 1 }) })),
    ),
    section(
      'events',
      EVIDENCE_CAPS.events,
      events.map((e) => ({ seq: String(e.seq), at: iso(e.at), actor: e.actor, command: e.command, entity: e.entity_type, id: id8(e.entity_id), from: e.state_before, to: e.state_after, after: clip(e.after, { str: 120, arr: 4, depth: 2 }) })),
    ),
  ];

  const title = latest.title;
  const total = sections.reduce((n, s) => n + s.text.length, 0);
  return {
    task: { id: task.id, code: task.code, title },
    task_version_id: latest.id,
    request_ids: requestIds,
    sections,
    total_chars: total,
    hash: fingerprint(sections),
  };
}
