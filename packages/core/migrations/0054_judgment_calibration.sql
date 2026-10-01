-- Calibration of Jev's judgments (observability: «judgment outcomes and the calibration loop»).
-- A size opinion also keeps the expected score and the probability of each level (XS..XL), and every opinion
-- the version of the question that produced it: a short sha256 of the question text plus its levels, computed
-- in code (classifier/question-version.ts). Nullable: older opinions do not have them.
alter table task_size_opinions
  add column score double precision,
  add column distribution jsonb,
  add column question_version text;
alter table task_code_opinions
  add column question_version text;
