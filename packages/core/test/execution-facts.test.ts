// Integrated observability: the pure summary (calibration, Spearman, cost, rework, agents, CSV) and, on a real
// database, one fact per build attempt joined with sizes, criteria and usage.

import { human } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import {
  type ExecutionFact,
  executionFacts,
  factsToCsv,
  observabilitySummary,
  spearman,
  usageOf,
} from '../src/queries/execution-facts.ts';
import { useEnvironment } from './support/env.ts';

const usage = (total: number, cost: number | null = null) => ({
  input_tokens: total - 10,
  cached_input_tokens: null,
  output_tokens: 10,
  reasoning_tokens: null,
  total_tokens: total,
  cost_usd: cost,
  duration_ms: 1000,
  turns: 1,
});

const fact = (over: Partial<ExecutionFact>): ExecutionFact => ({
  request_id: 'r1',
  attempt: 1,
  request_attempts: 1,
  task_code: 'TSK-A-001',
  task_title: 'A task',
  feature_code: 'FDR-A-001',
  size_person: 'S',
  size_jev: 'S',
  jev_confidence: 0.8,
  criteria_count: 2,
  provider: 'codex',
  model: 'm',
  agent_version: 'v',
  outcome: 'merged',
  failure_kind: null,
  ended_stage: null,
  blocking_comments: 0,
  blocking_kinds: [],
  started_at: '2026-10-01T10:00:00.000Z',
  ended_at: '2026-10-01T10:30:00.000Z',
  attempt_minutes: 30,
  builder_minutes: 10,
  ci_minutes: 5,
  review_minutes: 3,
  wait_minutes: 12,
  lead_minutes: 30,
  builder_usage: usage(1000),
  reviewer_usage: usage(200),
  files_changed: 3,
  context_recall: 0.5,
  context_precision: 0.5,
  merged_at: '2026-10-01T10:30:00.000Z',
  main_conclusion: 'success',
  issues_later: 0,
  ...over,
});

describe('spearman', () => {
  it('is 1 for a monotone increase, -1 for a decrease, and handles ties with average ranks', () => {
    expect(spearman([1, 2, 3, 5, 8], [10, 20, 30, 50, 80])).toEqual({ rho: 1, n: 5 });
    expect(spearman([1, 2, 3, 5, 8], [80, 50, 30, 20, 10])).toEqual({ rho: -1, n: 5 });
    // x = 1,1,2,2 against y = 1,2,3,4: ranks x 1.5,1.5,3.5,3.5; rho = 0.894 (Pearson over ranks).
    expect(spearman([1, 1, 2, 2], [1, 2, 3, 4])?.rho).toBeCloseTo(0.894, 3);
  });
  it('is null with fewer than 3 pairs or when one side does not vary', () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([2, 2, 2], [1, 2, 3])).toBeNull();
  });
});

describe('usageOf', () => {
  it('reads tokens and declared cost, and is null without any number', () => {
    expect(usageOf({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 5, declaredCostUsd: 0.5 })).toMatchObject({ total_tokens: 120, cached_input_tokens: 5, cost_usd: 0.5 });
    expect(usageOf({ provenance: {} })).toBeNull();
    expect(usageOf(null)).toBeNull();
  });
});

describe('observabilitySummary', () => {
  const facts: ExecutionFact[] = [
    // T1 (S): one attempt, 30 min.
    fact({ request_id: 'r1', task_code: 'T1', lead_minutes: 30, size_jev: 'S', size_person: 'S' }),
    // T2 (M): changes requested then merged; lead 120.
    fact({ request_id: 'r2', attempt: 1, request_attempts: 2, task_code: 'T2', size_jev: 'M', size_person: 'L', outcome: 'changes_requested', lead_minutes: null, merged_at: null, blocking_comments: 2, blocking_kinds: ['test_gap', 'defect'] }),
    fact({ request_id: 'r2', attempt: 2, request_attempts: 2, task_code: 'T2', size_jev: 'M', size_person: 'L', lead_minutes: 120, builder_usage: usage(3000, 0.25), reviewer_usage: null }),
    // T3 (L): a failed attempt without usage, then merged; lead 300.
    fact({ request_id: 'r3', attempt: 1, request_attempts: 2, task_code: 'T3', feature_code: 'FDR-B-001', size_jev: 'L', size_person: 'L', outcome: 'failed', failure_kind: 'infra', ended_stage: 'builder', lead_minutes: null, merged_at: null, builder_usage: null, reviewer_usage: null }),
    fact({ request_id: 'r3', attempt: 2, request_attempts: 2, task_code: 'T3', feature_code: 'FDR-B-001', size_jev: 'L', size_person: 'L', lead_minutes: 300 }),
  ];
  const agentRuns = [
    { agent: 'pr_reviewer', provider: 'codex', model: 'm', state: 'completed', failure_kind: null, duration_ms: 10_000, usage: usage(500) },
    { agent: 'pr_reviewer', provider: 'codex', model: 'm', state: 'failed', failure_kind: 'timeout', duration_ms: 30_000, usage: null },
  ];
  const s = observabilitySummary(facts, agentRuns);

  it('calibrates by Jev and by person size over merged tasks, with a labelled correlation', () => {
    expect(s.tasks_merged).toBe(3);
    expect(s.attempts).toBe(5);
    const jev = s.calibration.by_jev;
    expect(jev.rows.map((r) => [r.size, r.tasks, r.median_lead_minutes, r.median_attempts])).toEqual([
      ['S', 1, 30, 1],
      ['M', 1, 120, 2],
      ['L', 1, 300, 2],
    ]);
    expect(jev.correlation).toEqual({ rho: 1, n: 3 });
    // The person called T2 an L: L has two tasks, medians 210 (120 and 300).
    const person = s.calibration.by_person.rows.find((r) => r.size === 'L');
    expect(person).toMatchObject({ tasks: 2, median_lead_minutes: 210 });
  });

  it('adds cost per task and per feature over every attempt, and counts attempts without usage', () => {
    const t3 = s.cost.per_task.find((r) => r.key === 'T3');
    expect(t3).toMatchObject({ attempts: 2, tokens: 1200, attempts_without_usage: 1 });
    const t2 = s.cost.per_task.find((r) => r.key === 'T2');
    expect(t2).toMatchObject({ tokens: 1200 + 3000, cost_usd: 0.25 });
    expect(s.cost.per_feature.find((r) => r.key === 'FDR-B-001')).toMatchObject({ tasks: 1 });
    expect(s.cost.attempts_without_usage).toBe(1);
  });

  it('counts the rework causes', () => {
    expect(s.rework.changes_requested_by_kind).toEqual([
      { cause: 'defect', count: 1 },
      { cause: 'test_gap', count: 1 },
    ]);
    expect(s.rework.changes_requested_attempts).toBe(1);
    expect(s.rework.failed_by_kind).toEqual([{ cause: 'infra', count: 1 }]);
  });

  it('summarises agents from ai_runs and the builder from the facts', () => {
    const reviewer = s.agents.find((a) => a.agent === 'pr_reviewer');
    expect(reviewer).toMatchObject({ runs: 2, failures: 1, tokens: 500 });
    expect(reviewer?.median_duration_seconds).toBe(15.5);
    const builder = s.agents.find((a) => a.agent === 'builder');
    expect(builder).toMatchObject({ runs: 5, failures: 1 });
  });

  it('is empty-safe', () => {
    const empty = observabilitySummary([]);
    expect(empty.calibration.by_jev.rows).toEqual([]);
    expect(empty.calibration.by_jev.correlation).toBeNull();
    expect(empty.agents).toEqual([]);
  });

  it('writes CSV with quoting and neutralises formulas', () => {
    const csv = factsToCsv([fact({ task_title: '=HYPERLINK("x"), "q"', blocking_kinds: ['a', 'b'] })]);
    const [header, line] = csv.split('\r\n');
    expect(header?.startsWith('request_id,attempt')).toBe(true);
    expect(line).toContain(`"'=HYPERLINK(""x""), ""q"""`);
    expect(line).toContain(',a|b,');
  });
});

describe('executionFacts', () => {
  const environment = useEnvironment();
  const ana = human('ana');

  it('gives one fact per attempt joined with size, criteria, usage, files and issues', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Facts' } });
    const thread = (await executeCommand(s, { command: 'exploration.open', actor: ana, projectId, data: { purpose: 'Facts' } })).entityId;
    const made = await executeCommand(s, {
      command: 'record.create',
      actor: ana,
      projectId,
      data: {
        type: 'fdr',
        domain: 'facts',
        title: 'Facts feature',
        sections: [
          { title: 'Goal', content: 'A goal.' },
          { title: 'Scope', content: 'Scope.' },
          { title: 'Out of scope', content: 'Nothing.' },
          { title: 'Behavior', content: '1. It works.' },
        ],
        criteria: [{ carry: 'new', title: 'One', statement: 'Given a, when b, then c.', verification: 'automatic', check: 'A test.' }],
        origin: { type: 'exploration', id: thread },
      },
    });
    // Any record and version do as the «task»: the facts only read its code, title, size and covers.
    const recordId = made.entityId;
    const versionId = (made.result as { versionId: string }).versionId;
    await s.db.insertInto('task_sizes').values({ project_id: projectId, record_id: recordId, size: 'M', set_by: 'human:ana' }).execute();
    await s.db.insertInto('task_covers').values({ project_id: projectId, record_id: recordId, codes: ['AC-X-001-01', 'AC-X-001-02'], set_by: 'human:ana' }).execute();
    const request = await s.db
      .insertInto('build_requests')
      .values({ project_id: projectId, task_id: recordId, task_version_id: versionId, feature_version_id: versionId, brief: 'b', requested_by: 'human:ana' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const t0 = Date.UTC(2026, 9, 1, 10, 0, 0);
    const row = (attempt: number, stage: string, outcome: string, min: number, detail: unknown = {}) => ({
      project_id: projectId,
      build_request_id: request.id,
      attempt,
      stage,
      outcome,
      detail: JSON.stringify(detail),
      // The column types an insert as generated; an explicit instant is what a test needs.
      created_at: new Date(t0 + min * 60_000).toISOString() as never,
    });
    await s.db
      .insertInto('build_steps')
      .values([
        row(1, 'repo', 'started', 0, { started_by: 'human:ana' }),
        row(1, 'builder', 'started', 1),
        row(1, 'builder', 'failed', 6, { model: 'm1', provider: 'codex', exit_code: 1, failure_kind: 'infra', error: 'boom' }),
        row(2, 'repo', 'started', 10),
        row(2, 'builder', 'started', 11),
        row(2, 'builder', 'ok', 21, {
          model: 'm1',
          provider: 'codex',
          code_to_extend: { files: ['src/a.ts', 'src/b.ts'] },
          usage: { inputTokens: 900, outputTokens: 100, cachedInputTokens: 0, reasoningTokens: 0, declaredCostUsd: null, durationMs: 600000, turns: 1 },
        }),
        row(2, 'commit', 'ok', 22, { sha: 'abc', files: ['src/a.ts', 'src/c.ts'] }),
        row(2, 'merge', 'ok', 30),
      ])
      .execute();
    const merged = new Date(t0 + 30 * 60_000);
    await s.db.updateTable('build_requests').set({ state: 'done', done_at: merged }).where('id', '=', request.id).execute().catch(() => undefined);
    await s.db
      .insertInto('issues')
      .values({ project_id: projectId, code: 'ISS-T-001', kind: 'bug', title: 'Later', body: 'b', task_id: recordId, opened_by: 'human:ana', opened_at: new Date(t0 + 60 * 60_000).toISOString() as never })
      .execute()
      .catch(() => undefined);

    const { facts } = await executionFacts(s.db, projectId, new Date(t0 + 120 * 60_000));
    expect(facts).toHaveLength(2);
    const [second, first] = facts as [ExecutionFact, ExecutionFact];
    expect(first).toMatchObject({ attempt: 1, outcome: 'failed', failure_kind: 'infra', size_person: 'M', criteria_count: 2, provider: 'codex', model: 'm1' });
    expect(second).toMatchObject({ attempt: 2, request_attempts: 2, outcome: 'merged', lead_minutes: 30, files_changed: 2 });
    expect(second.builder_usage).toMatchObject({ total_tokens: 1000, cost_usd: null });
    expect(second.builder_minutes).toBe(10);
    // The builder was given a.ts and b.ts and the commit touched a.ts and c.ts: one hit.
    expect(second.context_recall).toBe(0.5);
    expect(second.context_precision).toBe(0.5);
    expect(first.builder_usage).toBeNull();
  });
});
