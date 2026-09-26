// The exploitation views of phase 5 (spec §10, §15.3) and their saved questions, over the business
// fixture (fixtures/build-business.ts): two threads, three runs on two engines, one accepted decision,
// one rejection, one retry with override, two questions raised and one answered.

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { ask } from '../src/ask.ts';
import { deriveAll } from '../src/derive.ts';
import { ingest } from '../src/ingest/ingest.ts';
import { parseLogs, parseTraces } from '../src/ingest/otlp.ts';
import { BIZ } from './fixtures/build-business.ts';
import { count, useEvidenceDatabase } from './support/db.ts';

const base = useEvidenceDatabase();
const I = BIZ.interactions;

type Row = Record<string, unknown>;
const query = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await base().pool.query<Row>(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []): Promise<Row> => {
  const rows = await query(sql, params);
  expect(rows).toHaveLength(1);
  return rows[0] ?? {};
};
/** The rows of a saved question as objects, to read them by column name. */
const asked = async (question: string, params: Record<string, string> = {}): Promise<Row[]> => {
  const { columns, rows } = await ask(base().pool, question, params);
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
};

beforeAll(async () => {
  const f = JSON.parse(await readFile(new URL('./fixtures/business.otlp.json', import.meta.url), 'utf8')) as {
    traces: unknown;
    logs: unknown;
  };
  // Spans first this time (ingest.test.ts does logs first): the views must not care.
  await ingest(base().pool, { spans: parseTraces(f.traces) }, 'collector');
  await ingest(base().pool, { logs: parseLogs(f.logs) }, 'collector');
});

describe('threads', () => {
  it('finds the thread of every run, the retry through the run it retries', async () => {
    const rows = await query('select run_id, thread_id from v_run_thread order by run_id');
    expect(rows).toEqual([
      { run_id: BIZ.run1, thread_id: BIZ.thread1 },
      { run_id: BIZ.run2, thread_id: BIZ.thread1 },
      { run_id: BIZ.run3, thread_id: BIZ.thread1 },
    ]);
  });

  it('assigns every interaction to its thread through messages, runs, questions, proposals and explorations', async () => {
    const rows = await query('select interaction_id, thread_id from v_interaction_thread order by started_at');
    expect(rows).toEqual([
      { interaction_id: I.post1, thread_id: BIZ.thread1 },
      { interaction_id: I.confirm, thread_id: BIZ.thread1 },
      { interaction_id: I.accept, thread_id: BIZ.thread1 },
      { interaction_id: I.post2, thread_id: BIZ.thread1 },
      { interaction_id: I.retry, thread_id: BIZ.thread1 },
      { interaction_id: I.reject, thread_id: BIZ.thread1 },
      { interaction_id: I.open2, thread_id: BIZ.thread2 },
      { interaction_id: I.post3, thread_id: BIZ.thread2 },
    ]);
  });

  it('knows the state of every question, who raised it and when it was answered', async () => {
    const rows = await query(
      'select question_id, thread_id, raised_by_run, raised_by_type, state, pending, answered_at is not null as answered from v_question_status order by raised_at',
    );
    expect(rows).toEqual([
      {
        question_id: BIZ.question1,
        thread_id: BIZ.thread1,
        raised_by_run: BIZ.run1,
        raised_by_type: 'agent_run',
        state: 'confirmed',
        pending: false,
        answered: true,
      },
      {
        question_id: BIZ.question2,
        thread_id: BIZ.thread1,
        raised_by_run: BIZ.run3,
        raised_by_type: 'agent_run',
        state: 'pending',
        pending: true,
        answered: false,
      },
    ]);
  });
});

describe('derived evaluations', () => {
  it('derives the four human evaluations at ingest, and derive finds nothing new', async () => {
    const rows = await query('select target_id, name, score, by_actor from evaluations order by at');
    expect(rows).toEqual([
      { target_id: BIZ.run1, name: 'human.inference_confirmed', score: 1, by_actor: 'human:ana' },
      { target_id: BIZ.run1, name: 'human.accepted', score: 1, by_actor: 'human:ana' },
      { target_id: BIZ.run2, name: 'human.retried_other_engine', score: 0, by_actor: 'human:ana' },
      { target_id: BIZ.run3, name: 'human.rejected', score: 0, by_actor: 'human:ana' },
    ]);
    const client = await base().pool.connect();
    try {
      expect(await deriveAll(client)).toBe(0);
    } finally {
      client.release();
    }
    expect(await count(base().pool, 'evaluations')).toBe(4);
  });
});

describe('v_decision_effort', () => {
  it('costs the accepted decision with what its thread spent until the acceptance', async () => {
    const row = await one('select * from v_decision_effort');
    expect(row).toMatchObject({
      accepted_interaction_id: I.accept,
      project_id: BIZ.project,
      thread_id: BIZ.thread1,
      proposal_id: BIZ.proposal1,
      batch_id: BIZ.batch1,
      run_id: BIZ.run1,
      accepted_by: 'human:ana',
      edited: false,
      interactions: '3',
      person_interventions: '3',
      questions_raised: '1',
      questions_answered: '1',
      questions_pending: '0',
      runs: '1',
      provider_calls: '1',
      tokens_uncached_input: '9000',
      tokens_cache_read: '0',
      tokens_cache_write: '1000',
      tokens_output: '400',
      tokens_reasoning: null,
      declared_cost_usd: 0.042,
    });
    expect(row.first_interaction_at).toBeInstanceOf(Date);
    expect(Number(row.time_to_accept_ms)).toBeGreaterThan(0);
    // Later runs, questions and the rejection are not part of this decision.
    expect(row.accepted_at).toBeInstanceOf(Date);
    expect((row.first_interaction_at as Date).getTime()).toBeLessThan((row.accepted_at as Date).getTime());
  });
});

describe('v_engine_reliability', () => {
  it('counts per engine the calls, failures by kind, retries, lost sessions and human verdicts', async () => {
    const rows = await query('select * from v_engine_reliability order by provider');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      provider: 'claude',
      requested_model: 'claude-sonnet-4-5',
      effort: 'medium',
      agent: 'explorer',
      agent_version: 'v3',
      calls: '2',
      runs: '2',
      failed_calls: '1',
      failures: { timeout: 1 },
      fallback_calls: '0',
      failed_runs: '1',
      retry_runs: '0',
      retried_runs: '1',
      sessions_resumed: '1',
      sessions_lost: '1',
      sessions_partial: '0',
      accepted_unedited: '1',
      accepted_edited: '0',
      rejected: '0',
      retried_same_engine: '0',
      retried_other_engine: '1',
      inferences_confirmed: '1',
      inferences_corrected: '0',
    });
    expect(rows[1]).toMatchObject({
      provider: 'codex',
      requested_model: 'gpt-5-codex',
      effort: 'high',
      calls: '1',
      runs: '1',
      failed_calls: '0',
      failures: {},
      failed_runs: '0',
      retry_runs: '1',
      retried_runs: '0',
      sessions_lost: '0',
      accepted_unedited: '0',
      rejected: '1',
      retried_other_engine: '0',
    });
  });
});

describe('v_engine_acceptance', () => {
  it('relates the human verdicts of each engine to its output tokens', async () => {
    const rows = await query('select * from v_engine_acceptance order by provider');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      provider: 'claude',
      runs: '2',
      calls: '2',
      tokens_input: '11000',
      tokens_output: '400',
      declared_cost_usd: 0.084,
      proposals: '1',
      accepted: '1',
      accepted_edited: '0',
      rejected: '0',
      unedited_acceptance_rate: 1,
    });
    expect(Number(rows[0]?.accepted_per_1k_output)).toBeCloseTo(2.5, 6);
    expect(Number(rows[0]?.rejected_per_1k_output)).toBe(0);
    expect(rows[1]).toMatchObject({
      provider: 'codex',
      runs: '1',
      tokens_input: '5000',
      tokens_output: '600',
      declared_cost_usd: null,
      proposals: '1',
      accepted: '0',
      rejected: '1',
      unedited_acceptance_rate: 0,
    });
    expect(Number(rows[1]?.rejected_per_1k_output)).toBeCloseTo(1000 / 600, 6);
  });
});

describe('v_interventions', () => {
  it('splits the commands of each interaction by actor and counts the open questions of its thread', async () => {
    const rows = await query(
      `select interaction_id, thread_id, actor_type, root_command, commands, person_commands, agent_commands, system_commands,
         failed_commands, questions_raised, questions_answered, proposals_accepted, proposals_rejected, questions_open
       from v_interventions order by started_at`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.interaction_id as string, r]));
    expect(rows.map((r) => r.interaction_id)).toEqual([
      I.post1,
      I.confirm,
      I.accept,
      I.post2,
      I.retry,
      I.reject,
      I.open2,
      I.post3,
    ]);
    expect(by[I.post1]).toMatchObject({
      thread_id: BIZ.thread1,
      actor_type: 'human',
      root_command: 'message.post',
      commands: '7',
      person_commands: '1',
      agent_commands: '5',
      system_commands: '1',
      failed_commands: '0',
      questions_raised: '1',
      questions_answered: '0',
      questions_open: '1',
    });
    expect(by[I.confirm]).toMatchObject({ person_commands: '1', questions_answered: '1', questions_open: '0' });
    expect(by[I.accept]).toMatchObject({ person_commands: '1', proposals_accepted: '1', proposals_rejected: '0' });
    expect(by[I.post2]).toMatchObject({ commands: '3', person_commands: '1', system_commands: '2', questions_open: '0' });
    expect(by[I.retry]).toMatchObject({
      root_command: 'run.retry',
      commands: '4',
      person_commands: '1',
      agent_commands: '3',
      questions_raised: '1',
      questions_open: '1',
    });
    expect(by[I.reject]).toMatchObject({ proposals_rejected: '1', questions_open: '1' });
    expect(by[I.open2]).toMatchObject({ thread_id: BIZ.thread2, commands: '1', questions_open: '0' });
    expect(by[I.post3]).toMatchObject({ thread_id: BIZ.thread2, commands: '1', person_commands: '1' });
  });
});

describe('v_interaction_summary', () => {
  it('keeps its columns and adds the context and apply phases, the actor type and the thread', async () => {
    const rows = await query('select * from v_interaction_summary order by started_at');
    expect(rows).toHaveLength(8);
    const first = rows[0] ?? {};
    expect(first).toMatchObject({
      interaction_id: I.post1,
      actor_type: 'human',
      thread_id: BIZ.thread1,
      commands: '7',
      runs: '1',
      provider_calls: '1',
      errors: '0',
      tokens_input: '10000',
      tokens_output: '400',
    });
    expect(Number(first.prepare_ms)).toBeGreaterThanOrEqual(0);
    expect(Number(first.apply_ms)).toBeGreaterThanOrEqual(0);
    expect(Number(first.provider_ms)).toBeGreaterThanOrEqual(0);
    expect(Number(first.total_ms)).toBeGreaterThanOrEqual(Number(first.provider_ms));
    // The failed call and its run.fail step count as errors of the second post.
    expect(rows[3]).toMatchObject({ interaction_id: I.post2, errors: '2', provider_calls: '1' });
    expect(rows[6]).toMatchObject({ interaction_id: I.open2, thread_id: BIZ.thread2, runs: '0' });
  });
});

describe('saved questions', () => {
  it('decision-effort lists the decision of the project and nothing for another', async () => {
    const rows = await asked('decision-effort', { project: BIZ.project });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      thread_id: BIZ.thread1,
      proposal_id: BIZ.proposal1,
      interventions: '3',
      questions: '1',
      answered: '1',
      pending: '0',
      runs: '1',
      output: '400',
      cost_usd: '0.0420',
    });
    expect(await asked('decision-effort', { project: 'all' })).toHaveLength(1);
    expect(await asked('decision-effort', { project: '0199b000-0000-7000-8000-00000000aa99' })).toHaveLength(0);
    await expect(asked('decision-effort')).rejects.toThrow('--project');
  });

  it('engine-reliability shows both engines with their failures and verdicts', async () => {
    const rows = await asked('engine-reliability');
    expect(rows.map((r) => [r.provider, r.calls, r.failed_calls, r.failures, r.lost, r.accepted, r.rejected, r.retried])).toEqual(
      [
        ['claude', '2', '1', { timeout: 1 }, '1', '1', '0', '1'],
        ['codex', '1', '0', {}, '0', '0', '1', '0'],
      ],
    );
  });

  it('engine-acceptance ranks the engines by accepted proposals per 1 000 output tokens', async () => {
    const rows = await asked('engine-acceptance');
    expect(rows.map((r) => [r.provider, r.output, r.accepted, r.rejected, r.accepted_per_1k, r.rejected_per_1k])).toEqual([
      ['claude', '400', '1', '0', '2.500', '0.000'],
      ['codex', '600', '0', '1', '0.000', '1.667'],
    ]);
  });

  it('interaction-time gives one row per interaction with its phases, filtered by project and date', async () => {
    const rows = await asked('interaction-time', { project: BIZ.project, since: 'all' });
    expect(rows).toHaveLength(8);
    const post1 = rows.find((r) => r.interaction_id === I.post1);
    expect(post1).toMatchObject({ thread_id: BIZ.thread1, commands: '7', runs: '1', calls: '1', input: '10000', output: '400' });
    expect(Number(post1?.total_ms)).toBeGreaterThanOrEqual(0);
    expect(Number(post1?.model_ms)).toBeGreaterThanOrEqual(0);
    expect(await asked('interaction-time', { project: 'all', since: '2000-01-01' })).toHaveLength(8);
    expect(await asked('interaction-time', { project: 'all', since: '2999-01-01' })).toHaveLength(0);
  });

  it('tokens-by-engine sums the calls of each engine since a date', async () => {
    const rows = await asked('tokens-by-engine', { since: 'all' });
    expect(rows.map((r) => [r.provider, r.calls, r.failed, r.uncached, r.cache_write, r.output, r.reasoning])).toEqual([
      ['claude', '2', '1', '10000', '1000', '400', null],
      ['codex', '1', '0', '5000', null, '600', '120'],
    ]);
    expect(await asked('tokens-by-engine', { since: '2999-01-01' })).toHaveLength(0);
  });

  it('cache-by-provider gives each provider its cache ratio and its resumed sessions since a date', async () => {
    const rows = await asked('cache-by-provider', { since: 'all' });
    expect(rows.map((r) => [r.provider, r.calls, r.runs])).toEqual([
      ['claude', '2', '2'],
      ['codex', '1', '1'],
    ]);
    const claude = rows[0] ?? {};
    expect(Number(claude.resumed)).toBe(Number(claude.reused) + Number(claude.partial) + Number(claude.lost));
    expect(await asked('cache-by-provider', { since: '2999-01-01' })).toHaveLength(0);
  });

  it('context-budget runs per builder and section, filtered by project', async () => {
    const rows = await asked('context-budget', { project: 'all' });
    for (const r of rows) expect(Number(r.packs)).toBeGreaterThan(0);
    expect(await asked('context-budget', { project: '0199b000-0000-7000-8000-00000000aa99' })).toHaveLength(0);
    await expect(asked('context-budget')).rejects.toThrow('--project');
  });

  it('interventions summarizes each thread: interactions, commands, questions and decisions', async () => {
    const rows = await asked('interventions', { project: BIZ.project });
    const by = Object.fromEntries(rows.map((r) => [r.thread_id as string, r]));
    expect(Object.keys(by).sort()).toEqual([BIZ.thread1, BIZ.thread2].sort());
    expect(by[BIZ.thread1]).toMatchObject({
      interactions: '6',
      person_interactions: '6',
      other_interactions: '0',
      person_commands: '6',
      agent_commands: '8',
      system_commands: '3',
      failed_commands: '0',
      questions: '2',
      answered: '1',
      pending_now: '1',
      accepted: '1',
      rejected: '1',
    });
    expect(by[BIZ.thread2]).toMatchObject({ interactions: '2', person_commands: '2', questions: '0', pending_now: '0' });
  });
});
