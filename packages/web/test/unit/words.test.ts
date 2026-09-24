import { CAPABILITIES, TRANSITIONS } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { COMMAND_WORDS, MARKS, STATE_WORDS, failureWord, whoOf } from '../../src/words.ts';

const entities = TRANSITIONS.entities as Record<string, { states: Record<string, string> }>;

describe('the UI dictionary', () => {
  it('AC-INT-001-04 every state of the entities the UI shows has its word and its mark', () => {
    const missing: string[] = [];
    for (const [entity, words] of Object.entries(STATE_WORDS)) {
      const def = entities[entity];
      if (!def) {
        missing.push(`${entity}: not in the tables`);
        continue;
      }
      for (const state of Object.keys(def.states)) {
        const w = words[state];
        if (!w?.word || !(w.mark in MARKS)) missing.push(`${entity}.${state}`);
      }
      for (const state of Object.keys(words)) if (!(state in def.states)) missing.push(`${entity}.${state}: unknown state`);
    }
    expect(missing).toEqual([]);
  });

  it('AC-INT-001-04 nothing proposed or pending carries the Confirmed mark', () => {
    for (const [entity, state] of [
      ['record_version', 'draft'],
      ['question', 'inferred'],
      ['question', 'pending'],
      ['proposal', 'pending'],
      ['batch', 'pending'],
      ['classification', 'pending_review'],
      ['taxonomy', 'draft'],
    ] as const) {
      expect(STATE_WORDS[entity]?.[state]?.mark, `${entity}.${state}`).not.toBe('confirmed');
    }
    expect(STATE_WORDS.question?.inferred).toEqual({ word: 'Assumed', mark: 'assumed' });
  });

  it('AC-INT-001-11 every command a person can run from the UI has its word', () => {
    const commands = CAPABILITIES.commands as Record<string, { allowed: readonly string[]; entity: string }>;
    const shown = Object.keys(STATE_WORDS);
    const withoutWord = Object.entries(commands)
      .filter(([, c]) => c.allowed.includes('human') && shown.includes(c.entity))
      .map(([name]) => name)
      .filter((name) => !COMMAND_WORDS[name]);
    expect(withoutWord).toEqual([]);
  });

  it('AC-INT-001-04 who did it comes from the actor: You, DEMIURGO with its model, Agent with its name, Automatic', () => {
    expect(whoOf('human:ana').kind).toBe('you');
    expect(whoOf('agent:run:0198', 'haiku')).toMatchObject({ kind: 'demiurgo', detail: 'haiku' });
    expect(whoOf('agent:claude-code:0198')).toMatchObject({ kind: 'agent', name: 'claude-code' });
    expect(whoOf('system:importer@1')).toMatchObject({ kind: 'automatic', detail: 'importer@1' });
  });

  it('AC-INT-001-10 every failure kind of a run has product words, and none says a bare "Error"', () => {
    for (const kind of ['infra', 'timeout', 'invalid_output', 'agent_error', 'cancelled', 'stale_knowledge']) {
      expect(failureWord(kind)).not.toMatch(/^Error\b/);
      expect(failureWord(kind).length).toBeGreaterThan(10);
    }
    expect(failureWord('infra', 'interrupted')).toBe('DEMIURGO restarted while it was running. Nothing was changed.');
    expect(failureWord('invalid_output')).toMatch(/Nothing was changed\./);
  });
});
