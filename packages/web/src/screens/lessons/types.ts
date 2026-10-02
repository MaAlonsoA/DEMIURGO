// Shapes of the two forensics endpoints (core queries/forensics.ts and forensics/store.ts).

export type Verdict = 'worked' | 'contributed_to_error' | 'could_have_prevented' | 'missing' | 'not_applicable';
export type Priority = 'high' | 'medium' | 'low';
export type Outcome = 'clean' | 'rework' | 'failed' | 'abandoned' | 'in_progress';

export type WentWrong = {
  what: string;
  evidence: string;
  phase: string;
  error_class: string;
  cost: { attempts?: number; minutes?: number; usd?: number };
  /** The known error (KE-…) of the vault it matches, or null with `new_error` when it opened a new one. */
  known_error?: string | null;
  new_error?: { title: string; description?: string; signature?: string; pieces?: string[] } | null;
  recurrence_why?: string | null;
};

export type ForensicAnalysis = {
  summary: string;
  outcome: Outcome;
  timeline: { at: string; stage: string; what: string }[];
  went_well: { what: string; evidence: string }[];
  went_wrong: WentWrong[];
  root_causes: { cause: string; dimension: string; where: string; why: string; evidence: string }[];
  improvements: { change: string; dimension: string; target: string; expected_effect: string; source: string; priority: Priority; playbook_class: string }[];
  lessons: string[];
  checklist: { piece_id: string; involved: 'yes' | 'no' | 'unknown'; verdict: Verdict; note: string; evidence: string }[];
  catalog_marks?: Record<string, string>;
};

export type TaskForensic = {
  id: string;
  task_version_id: string;
  /** Build requests the analysis covers. */
  request_ids?: string[];
  /** The request whose end triggered it; the per-task endpoint does not send it yet (the web falls back on `request_ids`). */
  trigger_request_id?: string | null;
  created_at: string; catalog_version: string;
  agent_version: string;
  analysis: ForensicAnalysis;
};
export type TaskForensics = { task: { id: string; code: string }; forensics: TaskForensic[] };

export type PlaybookEntry = {
  class_key: string;
  title: string;
  what_it_is: string;
  symptoms: string[];
  detection: string;
  prevention: { dimension: string; change: string }[];
  response: string;
  examples: string[];
  sources: string[];
};

export type ForensicsOverview = {
  catalog_version: string | null;
  catalog_excluded_tasks: string[];
  tasks: { code: string; task_id: string; analyzed_at: string; outcome: string; summary: string; counts: { went_wrong: number; root_causes: number; improvements: number } }[];
  by_class: { class: string; occurrences: number; tasks: number; attempts: number; minutes: number; usd: number; improvements: number; playbook_version: number | null }[];
  by_dimension: { dimension: string; root_causes: number; improvements: number; tasks: number }[];
  improvements: { target: string; dimension: string; playbook_class: string; change: string; expected_effect: string; source: string; priority: Priority; frequency: number; score: number; tasks: string[] }[];
  by_piece: { piece_id: string; involved: number; worked: number; contributed_to_error: number; could_have_prevented: number; missing: number; not_applicable: number; tasks: number }[];
  playbooks: { class_key: string; version: number; title: string; created_at: string; entry: PlaybookEntry; based_on: string[] }[];
};

export type KnownErrorStatus = 'open' | 'fix_claimed' | 'validated' | 'recurred';
export const KNOWN_ERROR_STATUSES: KnownErrorStatus[] = ['open', 'fix_claimed', 'validated', 'recurred'];
export type KnownErrorFix = { description: string; commits: string[]; piece_versions: Record<string, string>; claimed_at: string };
export type KnownErrorEntry = {
  code: string;
  version: number;
  title: string;
  description: string;
  error_class: string;
  phase: string;
  dimension: string;
  signature: string;
  pieces: string[];
  status: KnownErrorStatus | 'merged';
  fix: KnownErrorFix | null;
  /** Set when the status is merged: the entry this duplicate was merged into, and why. */
  merged_into?: string | null;
  merge_note?: string | null;
  origin_project_id: string;
  created_by: string;
  created_at: string;
};
export type KnownErrorSummary = Omit<KnownErrorEntry, 'created_by'> & {
  created_by?: string;
  occurrences: number;
  last_seen: string | null;
  after_fix_recurrences: number;
  tasks: string[];
};
export type KnownErrorsOverview = { total: number; by_status: Record<KnownErrorStatus, number>; entries: KnownErrorSummary[] };
export type KnownErrorOccurrence = {
  id: string;
  ke_code?: string;
  project: { id: string; name: string };
  task: { id: string; code: string };
  forensic_id: string;
  went_wrong_index: number;
  occurred_at: string;
  piece_versions: Record<string, string>;
  after_fix: boolean;
  recurrence_why: string | null;
  created_at: string;
  current: boolean;
};
export type KnownErrorDetail = { entry: KnownErrorEntry; versions: KnownErrorEntry[]; occurrences: KnownErrorOccurrence[] };
