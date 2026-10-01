// What really happened after each judgment (salud-del-harness §6.3): the post-mortem turns the stored rows of an ended
// request into `judgment_outcomes`, one fact per (judgment, outcome). Pure and deterministic: it reads the same
// inputs and findings the rules read and never calls a model. The rows are written by `harness.postmortem` in the same
// transaction as the findings, append-only and unique per (table, key, outcome, rules version), so computing twice
// writes nothing new.
// A judgment that lives in a table has its `judgment_id`; one that lives in a step's detail (test reuse, fix check) has
// only a key. The key is `<judgment id or path>@<request>` so that two requests of the same task never collide.

import { isTestFile } from '../build/flow.ts';
import { isReusableFile } from '../build/footprint.ts';
import type { PostmortemInputs } from './postmortem.ts';
import { asArray, asObject, commitFiles, detailOf, normalPath, numberOf, stepsOf, timeOf } from './rules/builder-detail.ts';
import { realFilesOf } from './rules/common.ts';
import type { Finding } from './rules/index.ts';

export type JudgmentOutcome = {
  judgment_table: string;
  judgment_id: string | null;
  judgment_key: string;
  /** touched | migration_added | manual_evidence_finding | attempts | builder_minutes | instruction_adopted | test_extended | fix_check_right */
  outcome_name: string;
  outcome_value: number | null;
  outcome_label: string | null;
  observed_at: string;
  source_type: string;
  source_id: string;
};

const iso = (ms: number): string => new Date(ms).toISOString();

/** When the request's story ended: merged, withdrawn or the last step. */
function observedAt(inputs: PostmortemInputs): number {
  const r = inputs.request;
  const last = inputs.steps.reduce((t, s) => Math.max(t, timeOf(s.created_at)), 0);
  return timeOf(r.done_at) || timeOf(r.withdrawn_at) || last || timeOf(r.requested_at);
}

/** The latest testability opinion of each criterion made before the request. */
function latestPerCriterion<T extends { criterion_code: string; created_at: unknown; id: string }>(rows: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const r of rows) {
    const seen = latest.get(r.criterion_code);
    if (!seen || timeOf(r.created_at) > timeOf(seen.created_at) || (timeOf(r.created_at) === timeOf(seen.created_at) && r.id > seen.id)) latest.set(r.criterion_code, r);
  }
  return [...latest.values()].sort((a, b) => (a.criterion_code < b.criterion_code ? -1 : 1));
}

export function deriveOutcomes(inputs: PostmortemInputs, findings: readonly Finding[]): JudgmentOutcome[] {
  const out: JudgmentOutcome[] = [];
  const request = inputs.request;
  const at = iso(observedAt(inputs));
  const requestRef = { source_type: 'build_request', source_id: request.id, observed_at: at };

  // Size (B04): what the task took, in attempts and builder minutes.
  const size = inputs.sizeOpinion;
  if (size) {
    const attempts = new Set(inputs.steps.map((s) => s.attempt)).size;
    const key = `${size.id}@${request.id}`;
    if (attempts > 0) out.push({ judgment_table: 'task_size_opinions', judgment_id: size.id, judgment_key: key, outcome_name: 'attempts', outcome_value: attempts, outcome_label: size.size, ...requestRef });
    const durations = stepsOf(inputs, 'builder').map((s) => numberOf(detailOf(s).duration_ms)).filter((n): n is number => n !== null);
    if (durations.length > 0) {
      const minutes = Math.round((durations.reduce((a, b) => a + b, 0) / 60_000) * 10) / 10;
      out.push({ judgment_table: 'task_size_opinions', judgment_id: size.id, judgment_key: key, outcome_name: 'builder_minutes', outcome_value: minutes, outcome_label: size.size, ...requestRef });
    }
  }

  // Layers (B02): did the pull request really add a migration? Read from the finding the schema rule already made.
  const schema = findings.find((f) => f.finding === 'schema.prediction');
  const layers = inputs.layersOpinion;
  if (schema && layers) {
    const migrations = asArray(asObject(schema.evidence).migrations).length;
    out.push({ judgment_table: 'task_layers_opinions', judgment_id: layers.id, judgment_key: `${layers.id}@${request.id}`, outcome_name: 'migration_added', outcome_value: migrations > 0 ? 1 : 0, outcome_label: schema.class, ...requestRef });
  }

  // Testability (B04): did a reviewer comment ask for manual evidence on this request? Only when Jev classified reviews.
  const kinds = inputs.reviewKinds ?? [];
  if (kinds.length > 0) {
    const manual = kinds.some((k) => k.category === 'manual_evidence' && k.p >= 0.5) ? 1 : 0;
    for (const o of latestPerCriterion(inputs.testabilityOpinions ?? [])) {
      out.push({ judgment_table: 'task_testability_opinions', judgment_id: o.id, judgment_key: `${o.id}@${request.id}`, outcome_name: 'manual_evidence_finding', outcome_value: manual, outcome_label: o.criterion_code, ...requestRef });
    }
  }

  // Files (B07): of the files «Code to extend» offered, which did the merged pull request touch?
  if (request.state === 'done') {
    const real = realFilesOf(inputs.steps);
    if (real) {
      const actual = new Set(real.map(normalPath));
      const merged = inputs.steps.filter((s) => s.stage === 'merge' && s.outcome === 'ok').at(-1)?.attempt;
      const attempt = merged !== undefined && inputs.codeOpinions.some((o) => o.attempt === merged) ? merged : Math.max(0, ...inputs.codeOpinions.map((o) => o.attempt));
      for (const o of inputs.codeOpinions.filter((c) => c.attempt === attempt && isReusableFile(c.path) && !isTestFile(c.path))) {
        out.push({ judgment_table: 'task_code_opinions', judgment_id: o.id, judgment_key: `${o.id}@${request.id}`, outcome_name: 'touched', outcome_value: actual.has(normalPath(o.path)) ? 1 : 0, outcome_label: o.path, ...requestRef });
      }
    }
  }

  // Review findings (B17): was each blocking or fix comment followed by a commit on its path (G04)?
  for (const f of findings.filter((x) => x.finding === 'review.finding_outcome' && (x.class === 'tp' || x.class === 'fp'))) {
    const e = asObject(f.evidence);
    if (typeof e.pr_review !== 'string' || typeof e.comment_index !== 'number') continue;
    const kind = kinds.find((k) => k.pr_review_id === e.pr_review && k.comment_index === e.comment_index);
    out.push({
      judgment_table: 'review_finding_kinds',
      judgment_id: kind?.id ?? null,
      judgment_key: `${e.pr_review}:${e.comment_index}`,
      outcome_name: 'instruction_adopted',
      outcome_value: f.class === 'tp' ? 1 : 0,
      outcome_label: f.subject ?? null,
      source_type: 'pr_review',
      source_id: e.pr_review,
      observed_at: at,
    });
  }

  // Test reuse (B08): of the tests the builder was told to extend, which did a commit of that attempt touch?
  for (const step of stepsOf(inputs, 'builder')) {
    const reuse = asArray(detailOf(step).test_reuse).map(asObject).filter((r) => typeof r.path === 'string');
    if (reuse.length === 0) continue;
    const commits = stepsOf(inputs, 'commit').filter((s) => s.attempt === step.attempt && s.outcome === 'ok');
    if (commits.length === 0) continue;
    const touched = new Set(commits.flatMap(commitFiles));
    for (const r of reuse) {
      const path = normalPath(r.path as string);
      out.push({ judgment_table: 'test_reuse', judgment_id: null, judgment_key: `${request.id}:${step.attempt}:${path}`, outcome_name: 'test_extended', outcome_value: touched.has(path) ? 1 : 0, outcome_label: typeof r.criterion === 'string' ? r.criterion : null, source_type: 'build_step', source_id: step.id, observed_at: at });
    }
  }

  // Fix check (B16): Jev's second look at an LGTM-with-comments waiver, right when the waiver held (ok) or the refusal was justified.
  for (const f of findings.filter((x) => x.finding === 'review.waiver' && (x.class === 'tp' || x.class === 'fp' || x.class === 'tn' || x.class === 'fn'))) {
    const stepId = asObject(f.evidence).build_step;
    const step = inputs.steps.find((s) => s.id === stepId);
    if (!step) continue;
    const jev = asObject(detailOf(step).waiver).jev;
    if (jev !== 'ok' && jev !== 'refused') continue;
    out.push({ judgment_table: 'fix_check', judgment_id: null, judgment_key: `${request.id}:${step.attempt}`, outcome_name: 'fix_check_right', outcome_value: f.class === 'tp' || f.class === 'tn' ? 1 : 0, outcome_label: jev, source_type: 'build_step', source_id: step.id, observed_at: at });
  }

  // The same (table, key, outcome) twice is one fact: the first wins.
  const seen = new Set<string>();
  return out.filter((o) => {
    const k = `${o.judgment_table}|${o.judgment_key}|${o.outcome_name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
