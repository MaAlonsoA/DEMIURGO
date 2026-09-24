import { TRANSITIONS } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import type { EventRow, RunListItem } from '../../src/api/types.ts';
import {
  RUN_STATES,
  askedBy,
  proposalsInWords,
  requestedBy,
  retriesOf,
  runDuration,
  runEvents,
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
