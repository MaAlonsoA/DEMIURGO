// Shapes of the two forensics endpoints (core queries/forensics.ts and forensics/store.ts).

export type Verdict = 'worked' | 'contributed_to_error' | 'could_have_prevented' | 'missing' | 'not_applicable';
export type Priority = 'high' | 'medium' | 'low';
export type Outcome = 'clean' | 'rework' | 'failed' | 'abandoned' | 'in_progress';

export type ForensicAnalysis = {
  summary: string;
  outcome: Outcome;
  timeline: { at: string; stage: string; what: string }[];
  went_well: { what: string; evidence: string }[];
  went_wrong: { what: string; evidence: string; phase: string; error_class: string; cost: { attempts?: number; minutes?: number; usd?: number } }[];
  root_causes: { cause: string; dimension: string; where: string; why: string; evidence: string }[];
  improvements: { change: string; dimension: string; target: string; expected_effect: string; source: string; priority: Priority; playbook_class: string }[];
  lessons: string[];
  checklist: { piece_id: string; involved: 'yes' | 'no' | 'unknown'; verdict: Verdict; note: string; evidence: string }[];
  catalog_marks?: Record<string, string>;
};

export type TaskForensic = { id: string; task_version_id: string; created_at: string; catalog_version: string; agent_version: string; analysis: ForensicAnalysis };
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
