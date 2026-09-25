import { describe, expect, it } from 'vitest';
import type { Question, Readiness } from '../../src/api/types.ts';
import { questionGroups, readinessCitation, shortAnswer } from '../../src/screens/blueprint/questions.ts';
import { tabOf, tabSearch } from '../../src/screens/blueprint/tabs.ts';

function q(id: string, state: string, minute: number, over: Partial<Question> = {}): Question {
  return {
    id,
    exploration_id: 't',
    question: `Question ${id}?`,
    reason: null,
    impact: null,
    conclusion: state === 'inferred' || state === 'confirmed' ? `Answer ${id}` : null,
    reasoning: null,
    state,
    state_reason: null,
    raised_by: 'human:ana',
    created_at: `2026-09-24T10:${String(minute).padStart(2, '0')}:00Z`,
    epistemic_status: 'pending',
    ...over,
  };
}

describe('the questions of a record', () => {
  it('AC-INT-001-09 puts the open ones first (pending, then assumed) and keeps the rest apart by what happened to them', () => {
    const groups = questionGroups([
      q('a', 'inferred', 1),
      q('b', 'pending', 3),
      q('c', 'confirmed', 2),
      q('d', 'postponed', 4),
      q('e', 'pending', 0),
      q('f', 'discarded', 5),
      q('g', 'confirmed', 6),
    ]);
    expect(groups.open.map((x) => x.id)).toEqual(['e', 'b', 'a']);
    expect(groups.answered.map((x) => x.id)).toEqual(['c', 'g']);
    expect(groups.notNow.map((x) => x.id)).toEqual(['d']);
    expect(groups.doesNotApply.map((x) => x.id)).toEqual(['f']);
    expect(questionGroups([]).open).toEqual([]);
  });

  it('AC-INT-001-09 the button of an assumed answer says it short, cut at a word', () => {
    expect(shortAnswer('Organizers set a limit.')).toBe('Organizers set a limit');
    expect(shortAnswer('  Members   and organizers first ')).toBe('Members and organizers first');
    const long = shortAnswer("Let's go with members and organizers first, then guests once the pilot is over.");
    expect(long).toBe("Let's go with members and organizers first,…");
    expect(long.length).toBeLessThanOrEqual(46);
  });

  it('AC-INT-001-08 says whether the readiness of the version cites the question, with the reason as the server gives it', () => {
    const readiness: Readiness = {
      ready: false,
      reasons: [
        'Version 1 is not approved.',
        'A question of its thread is open: “Question b?”',
        'DEMIURGO assumed an answer you have not confirmed: “Question a?”',
      ],
      warnings: [],
    };
    expect(readinessCitation(q('b', 'pending', 0), readiness)).toEqual({
      cited: true,
      text: 'Yes. It waits on this question of its thread.',
      reason: 'A question of its thread is open: “Question b?”',
    });
    expect(readinessCitation(q('a', 'inferred', 0), readiness)).toEqual({
      cited: true,
      text: 'Yes. It waits until you confirm the answer DEMIURGO assumed.',
      reason: 'DEMIURGO assumed an answer you have not confirmed: “Question a?”',
    });
    expect(readinessCitation(q('z', 'inferred', 0), readiness)).toEqual({
      cited: false,
      text: "Its readiness doesn't cite it.",
      reason: null,
    });
    expect(
      readinessCitation(q('b', 'pending', 0), { ready: false, reasons: ['Version 1 is not approved.'], warnings: [] }),
    ).toMatchObject({ cited: false });
    // A decision has no readiness.
    expect(readinessCitation(q('b', 'pending', 0), null)).toBeNull();
  });
});

describe('the sections of a record', () => {
  it('AC-INT-001-04 the tab lives in ?tab= and keeps the version shown', () => {
    expect(tabOf('questions')).toBe('questions');
    expect(tabOf('checks')).toBe('checks');
    expect(tabOf('history')).toBe('history');
    expect(tabOf('overview')).toBe('overview');
    expect(tabOf(undefined)).toBe('overview');
    expect(tabOf('nonsense')).toBe('overview');
    expect(tabSearch(2, 'questions')).toEqual({ v: 2, tab: 'questions' });
    expect(tabSearch(undefined, 'history')).toEqual({ tab: 'history' });
    expect(tabSearch(3, 'overview')).toEqual({ v: 3 });
    expect(tabSearch(undefined, 'overview')).toEqual({});
  });
});

describe('questions still in the reserve', () => {
  it('are not listed: only the questions shown in the thread, as Needs you does', () => {
    const groups = questionGroups([
      q('a', 'pending', 1, { shown_at: '2026-09-24T10:01:00Z' }),
      q('b', 'pending', 2, { shown_at: null }),
      q('c', 'pending', 3),
    ]);
    expect(groups.open.map((x) => x.id)).toEqual(['a', 'c']);
  });
});
