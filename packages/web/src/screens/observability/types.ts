// Shapes of GET /api/projects/:id/observability (core queries/execution-facts.ts). Kept here, not in
// api/types.ts: this screen owns them.

export type TaskSizeCode = 'XS' | 'S' | 'M' | 'L' | 'XL';

export type UsageFact = {
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  turns: number | null;
};

export type FactOutcome = 'merged' | 'changes_requested' | 'failed' | 'running' | 'cancelled' | 'open';

export type ExecutionFact = {
  request_id: string;
  attempt: number;
  request_attempts: number;
  task_code: string;
  task_title: string | null;
  feature_code: string | null;
  size_person: TaskSizeCode | null;
  size_jev: TaskSizeCode | null;
  jev_confidence: number | null;
  criteria_count: number;
  provider: string | null;
  model: string | null;
  agent_version: string | null;
  outcome: FactOutcome;
  failure_kind: string | null;
  ended_stage: string | null;
  blocking_comments: number;
  blocking_kinds: string[];
  started_at: string;
  ended_at: string;
  attempt_minutes: number;
  builder_minutes: number | null;
  ci_minutes: number;
  review_minutes: number;
  wait_minutes: number;
  lead_minutes: number | null;
  builder_usage: UsageFact | null;
  reviewer_usage: UsageFact | null;
  files_changed: number | null;
  context_recall: number | null;
  context_precision: number | null;
  merged_at: string | null;
  main_conclusion: string | null;
  issues_later: number | null;
};

export type CalibrationRow = {
  size: TaskSizeCode | 'none';
  tasks: number;
  median_lead_minutes: number | null;
  median_attempts: number | null;
  median_builder_minutes: number | null;
  median_tokens: number | null;
  median_cost_usd: number | null;
};

export type Correlation = { rho: number; n: number };
export type Calibration = { rows: CalibrationRow[]; correlation: Correlation | null };

export type CostRow = {
  key: string;
  title: string | null;
  tasks: number;
  attempts: number;
  tokens: number | null;
  cost_usd: number | null;
  attempts_without_usage: number;
};

export type ReworkCause = { cause: string; count: number };

export type AgentRow = {
  agent: string;
  provider: string | null;
  model: string | null;
  runs: number;
  failures: number;
  tokens: number | null;
  cost_usd: number | null;
  median_duration_seconds: number | null;
};

export type ObservabilitySummary = {
  tasks_merged: number;
  attempts: number;
  calibration: { by_jev: Calibration; by_person: Calibration };
  cost: { per_task: CostRow[]; per_feature: CostRow[]; attempts_without_usage: number; attempts_with_builder: number };
  rework: {
    changes_requested_by_kind: ReworkCause[];
    changes_requested_attempts: number;
    failed_by_kind: ReworkCause[];
    failed_attempts: number;
  };
  agents: AgentRow[];
};

export type Observability = { facts: ExecutionFact[]; summary: ObservabilitySummary };

// GET /api/projects/:id/observability/calibration (core queries/calibration.ts).
export type SizeRow = {
  size: TaskSizeCode;
  n: number;
  median_minutes: number | null;
  p25_minutes: number | null;
  p75_minutes: number | null;
  median_first_attempt_minutes: number | null;
  band: { from: number | null; to: number | null } | null;
  in_band: number;
};
export type ConfidenceBucket = { bucket: 'low' | 'mid' | 'high'; n: number; correct: number; accuracy: number | null; mean_confidence: number | null };
export type SizeCalibration = {
  tasks: number;
  builds: number;
  by_size: SizeRow[];
  spearman: { rho: number; n: number } | null;
  buckets: ConfidenceBucket[];
  ece: number | null;
  brier: { score: number; n: number } | null;
};
export type FileCalibration = { builds: number; median_precision: number | null; median_recall: number | null; mean_predicted: number | null; mean_touched: number | null };
export type FileScore = { task_code: string; attempt: number; question_version: string | null; predicted: string[]; touched: string[]; hits: number; precision: number | null; recall: number | null };
export type JudgmentCalibration = {
  sizes: { overall: SizeCalibration; by_version: { question_version: string | null; calibration: SizeCalibration }[] };
  files: { overall: FileCalibration; by_version: { question_version: string | null; calibration: FileCalibration }[]; builds: FileScore[] };
};
