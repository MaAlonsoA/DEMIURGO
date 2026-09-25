import { TRANSITIONS } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import type { EventRow, RunListItem } from '../../src/api/types.ts';
import { activityLine, countsByState, emptyFilterWords } from '../../src/screens/activity/summary.ts';
import { phasesOf } from '../../src/screens/run/phases.ts';
import {
  RUN_STATES,
  askedBy,
  attemptsOf,
  nextStep,
  proposalsInWords,
  requestedBy,
  retriesOf,
  runDuration,
  runEvents,
  runTitle,
} from '../../src/screens/run/runs.ts';
import { ACTION_WORDS, STATE_WORDS, failureWord } from '../../src/words.ts';

const at = (s: number) => new Date(Date.UTC(2026, 8, 24, 10, 0, s)).toISOString();

function event(id: string, entity_id: string, command: string, cause: unknown = { correlation: 'c' }): EventRow {
  return {
    id,
    project_id: 'p',
    seq: id,
    at: at(Number(id)),
    actor: 'system:engine@1',
    command,
    entity_type: command.split('.')[0] ?? '',
    entity_id,
    entity_version: null,
    state_before: null,
    state_after: null,
    before: null,
    after: null,
    cause,
  };
}

describe('the pages of runs', () => {
  it('AC-INT-001-10 the filter of Activity offers every state of a run, each with its word and mark', () => {
    const states = Object.keys((TRANSITIONS.entities as Record<string, { states: Record<string, string> }>).ai_run?.states ?? {});
    expect([...RUN_STATES].sort()).toEqual(states.sort());
    for (const s of RUN_STATES) expect(STATE_WORDS.ai_run?.[s]?.word).toBeTruthy();
    expect(ACTION_WORDS.exploration_chat).toBe('Conversation');
    expect(ACTION_WORDS.design_proposal).toBe('Draft');
  });

  it('AC-INT-001-10 a run page gathers its own events, those it caused and its context pack', () => {
    const events = [
      event('1', 'pack-1', 'context_pack.build'),
      event('2', 'run-1', 'run.request'),
      event('3', 'run-2', 'run.request'),
      event('4', 'message-1', 'message.post', { correlation: 'c', run: 'run-1' }),
      event('5', 'message-2', 'message.post', { correlation: 'c', run: 'run-2' }),
      event('6', 'run-1', 'run.complete'),
    ];
    expect(runEvents(events, { id: 'run-1', context_pack_id: 'pack-1' }).map((e) => e.id)).toEqual(['1', '2', '4', '6']);
    expect(runEvents(events, { id: 'run-2', context_pack_id: null }).map((e) => e.id)).toEqual(['3', '5']);
  });

  it('AC-INT-001-10 lists the retries of a run, oldest first', () => {
    const r = (id: string, retry_of: string | null, s: number) => ({ id, retry_of, created_at: at(s) }) as RunListItem;
    expect(retriesOf('a', [r('c', 'a', 20), r('a', null, 0), r('b', 'a', 10), r('d', 'b', 30)]).map((x) => x.id)).toEqual([
      'b',
      'c',
    ]);
  });

  it('AC-INT-001-10 the duration counts from the start, or from the request while it is queued', () => {
    expect(runDuration({ state: 'completed', created_at: at(0), started_at: at(2), finished_at: at(65) })).toBe('1:03');
    expect(runDuration({ state: 'queued', created_at: at(0), started_at: null, finished_at: null }, Date.parse(at(9)))).toBe(
      '0:09',
    );
    expect(runDuration({ state: 'running', created_at: at(0), started_at: at(1), finished_at: null }, Date.parse(at(43)))).toBe(
      '0:42',
    );
  });

  it('AC-INT-001-10 an interrupted run says DEMIURGO restarted, and an invalid output that nothing was changed', () => {
    expect(failureWord('infra', 'interrupted')).toBe('DEMIURGO restarted while it was running. Nothing was changed.');
    expect(failureWord('invalid_output', 'failed')).toContain('Nothing was changed.');
    expect(failureWord('agent_error', 'failed')).not.toMatch(/^Error/);
  });

  it('AC-INT-001-10 says who asked for a run: you, an agent by its name, or automatically', () => {
    expect(askedBy('human:ana')).toBe('You');
    expect(askedBy('agent:claude-code:t1')).toBe('Agent · claude-code');
    expect(askedBy('system:conversation@1')).toBe('Automatic');
    expect(requestedBy('human:ana')).toBe('Requested by you');
    expect(requestedBy('system:conversation@1')).toBe('Requested automatically');
  });

  it('AC-INT-001-10 says what a run proposed in words', () => {
    expect(proposalsInWords(['decision'])).toBe('1 decision');
    expect(proposalsInWords(['fdr', 'fdr', 'exploration'])).toBe('2 features and 1 thread');
    expect(proposalsInWords(['decision', 'fdr', 'other'])).toBe('1 decision, 1 feature and 1 proposal');
  });
});

type Facts = Parameters<typeof phasesOf>[0];

const facts = (over: Partial<Facts>): Facts => ({
  state: 'completed',
  failure_kind: null,
  created_at: at(0),
  started_at: at(1),
  finished_at: at(30),
  context_pack_id: 'pack',
  ...over,
});

const states = (f: Facts, extra?: Parameters<typeof phasesOf>[1]) => phasesOf(f, extra).map((p) => `${p.key}:${p.state}`);

describe('the phases of a run', () => {
  it('AC-INT-001-10 a completed run went through every phase, each with the time it began', () => {
    const phases = phasesOf(facts({}), { contextAt: at(0) });
    expect(phases.map((p) => p.state)).toEqual(['done', 'done', 'done', 'done']);
    expect(phases.map((p) => p.at)).toEqual([at(0), at(0), at(1), at(30)]);
  });

  it('AC-INT-001-10 a queued run waits for the model, a working one is in it', () => {
    expect(states(facts({ state: 'queued', started_at: null, finished_at: null }))).toEqual([
      'requested:done',
      'context:done',
      'model:pending',
      'result:pending',
    ]);
    expect(states(facts({ state: 'running', finished_at: null }))).toEqual([
      'requested:done',
      'context:done',
      'model:current',
      'result:pending',
    ]);
  });

  it('AC-INT-001-10 marks where a run stopped: the model for an agent error, the result for an output that did not match', () => {
    expect(states(facts({ state: 'failed', failure_kind: 'agent_error' }))).toEqual([
      'requested:done',
      'context:done',
      'model:stopped',
      'result:pending',
    ]);
    expect(states(facts({ state: 'failed', failure_kind: 'timeout' }), { answered: true })[2]).toBe('model:stopped');
    expect(states(facts({ state: 'failed', failure_kind: 'invalid_output' }))).toEqual([
      'requested:done',
      'context:done',
      'model:done',
      'result:stopped',
    ]);
    // Interrupted or cancelled: after the engine answered, it stopped while applying; before, in the model.
    expect(states(facts({ state: 'interrupted', failure_kind: 'infra' }), { answered: true })[3]).toBe('result:stopped');
    expect(states(facts({ state: 'interrupted', failure_kind: 'infra' }))[2]).toBe('model:stopped');
    expect(states(facts({ state: 'cancelled', failure_kind: 'cancelled', started_at: null }))).toEqual([
      'requested:done',
      'context:done',
      'model:stopped',
      'result:pending',
    ]);
  });

  it('AC-INT-001-10 without a context pack, the context phase is where it is or where it stopped', () => {
    expect(states(facts({ state: 'queued', context_pack_id: null, started_at: null, finished_at: null }))[1]).toBe(
      'context:current',
    );
    expect(states(facts({ state: 'failed', failure_kind: 'infra', context_pack_id: null, started_at: null }))[1]).toBe(
      'context:stopped',
    );
  });
});

describe('the attempts and the next step of a run', () => {
  it('AC-INT-001-10 lists every attempt of the same work, oldest first, from any of them', () => {
    const r = (id: string, retry_of: string | null, s: number) => ({ id, retry_of, created_at: at(s) });
    const runs = [r('c', 'b', 30), r('x', null, 5), r('a', null, 0), r('b', 'a', 10), r('d', 'a', 20)];
    expect(attemptsOf('c', runs).map((x) => x.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(attemptsOf('a', runs).map((x) => x.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(attemptsOf('x', runs).map((x) => x.id)).toEqual(['x']);
    expect(attemptsOf('missing', runs)).toEqual([]);
  });

  it('AC-INT-001-10 an interrupted run suggests a plain retry, an invalid output another engine', () => {
    expect(nextStep({ state: 'interrupted', failure_kind: 'infra' })).toMatch(/wasn't the content/);
    expect(nextStep({ state: 'failed', failure_kind: 'invalid_output' })).toMatch(/another engine/);
    expect(nextStep({ state: 'cancelled', failure_kind: 'cancelled' })).toMatch(/same context/);
    expect(nextStep({ state: 'completed', failure_kind: null })).toBeNull();
    expect(runTitle('design_proposal', ACTION_WORDS)).toBe('Draft a feature');
    expect(runTitle('exploration_chat', ACTION_WORDS)).toBe('Conversation');
  });
});

const run = (over: Partial<RunListItem>): RunListItem =>
  ({
    id: 'r',
    state: 'completed',
    retry_of: null,
    created_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    ...over,
  }) as RunListItem;

describe('the Activity page', () => {
  it('AC-INT-001-10 the header counts the runs, what works and what failed without a retry', () => {
    const now = Date.now();
    expect(activityLine([], now)).toBe('What DEMIURGO did and is doing, run by run.');
    const runs = [
      run({ id: 'a', state: 'running' }),
      run({ id: 'b', state: 'failed' }),
      run({ id: 'c', state: 'failed' }),
      run({ id: 'd', state: 'completed', retry_of: 'c' }),
    ];
    expect(activityLine(runs, now)).toBe('4 runs of DEMIURGO · 1 working · 1 failed (not retried)');
    expect(activityLine([run({})], now)).toBe('1 run of DEMIURGO');
  });

  it('AC-INT-001-10 the filter counts every state from the whole list, and says when a state has none', () => {
    const counts = countsByState([run({ state: 'failed' }), run({ state: 'failed' }), run({ state: 'queued' })]);
    expect(counts).toEqual({ queued: 1, running: 0, completed: 0, failed: 2, cancelled: 0, interrupted: 0 });
    expect(emptyFilterWords('Cancelled')).toBe('No cancelled runs.');
  });
});
