import { describe, expect, it } from 'vitest';
import type { Criterion, RecordVersion } from '../../src/api/types.ts';
import { canReview, reviewBanner, reviewMinutes, reviewParts, reviewStep } from '../../src/screens/record/review.ts';

function criterion(n: number, verification: 'automatic' | 'manual'): Criterion {
  return {
    id: `c${n}`,
    code: `AC-CAT-001-0${n}`,
    title: `Check ${n}`,
    statement: 'When a member opens Activities, then they see only upcoming activities.',
    verification,
    check: 'An end-to-end test opens Activities.',
    carry: 'new',
  };
}

const sections = (...titles: string[]) => titles.map((title) => ({ title, content: `${title} of the feature, in a few words.` }));

function version(extra: Partial<RecordVersion> = {}): Pick<RecordVersion, 'sections' | 'criteria' | 'inferred_questions'> {
  return {
    sections: sections('Goal', 'Scope', 'Out of scope', 'Behavior'),
    criteria: [criterion(1, 'automatic'), criterion(2, 'automatic'), criterion(3, 'manual')],
    inferred_questions: [],
    ...extra,
  };
}

describe('the guided review of a feature', () => {
  it('AC-INT-001-05 walks five parts: context, what it is for, how it works, the checks and what DEMIURGO assumed', () => {
    const parts = reviewParts('fdr', version());
    expect(parts.map((p) => [p.n, p.key, p.name])).toEqual([
      [1, 'context', 'Context'],
      [2, 'what', "What it's for"],
      [3, 'how', 'How it works'],
      [4, 'checks', 'Checks'],
      [5, 'assumed', 'What DEMIURGO assumed'],
    ]);
    expect(parts[1]?.sections).toEqual([0, 1, 2]);
    expect(parts[2]?.sections).toEqual([3]);
    expect(parts[3]?.question).toBe('Would these 3 checks prove it works?');
    expect(parts[3]?.hint).toBe('2 are automatic. 1 is yours to try, once it is built.');
    expect(parts[4]?.question).toBe('Nothing assumed');
    expect(parts[4]?.quiet).toBe(true);
  });

  it('puts a section it does not know with the part before it, and a tech decision reads as why and what it decides', () => {
    const odd = reviewParts('fdr', version({ sections: sections('Goal', 'Personas', 'Behavior', 'Notes') }));
    expect(odd[1]?.sections).toEqual([0, 1]);
    expect(odd[2]?.sections).toEqual([2, 3]);
    const adr = reviewParts('adr', version({ sections: sections('Context', 'Options', 'Decision', 'Consequences') }));
    expect(adr.map((p) => p.name)).toEqual(['Context', "Why it's needed", 'What it decides', 'Checks', 'What DEMIURGO assumed']);
    expect(adr[1]?.sections).toEqual([0, 1]);
    expect(adr[2]?.sections).toEqual([2, 3]);
  });

  it('asks about the answers DEMIURGO assumed when there are some', () => {
    const parts = reviewParts(
      'fdr',
      version({ inferred_questions: [{ id: 'q', question: 'How many guests?', conclusion: 'Two.' }] }),
    );
    expect(parts[4]?.question).toBe('DEMIURGO assumed 1 answer. Is it right?');
    expect(parts[4]?.quiet).toBe(false);
  });

  it('says the step it is in, and at the end what confirming does', () => {
    const parts = reviewParts('fdr', version());
    expect(reviewStep(parts, 2, 'Activity catalog')).toMatchObject({ label: "Part 2 of 5 · What it's for", final: false });
    expect(reviewStep(parts, 6, 'Activity catalog')).toEqual({
      label: 'All 5 parts reviewed',
      question: 'Confirm Activity catalog?',
      hint: 'It becomes the current version. It is Ready to build if nothing else blocks it.',
      final: true,
    });
  });

  it('is offered on a draft feature or tech decision that the person can approve, never on an older draft', () => {
    expect(canReview('fdr', 'draft', true, false)).toBe(true);
    expect(canReview('adr', 'draft', true, false)).toBe(true);
    expect(canReview('decision', 'draft', true, false)).toBe(false);
    expect(canReview('fdr', 'approved', true, false)).toBe(false);
    expect(canReview('fdr', 'draft', false, false)).toBe(false);
    expect(canReview('fdr', 'draft', true, true)).toBe(false);
  });

  it('tells in the banner how many checks and about how long it takes', () => {
    expect(reviewBanner(version())).toEqual({
      title: 'Review it: context, details and 3 checks',
      detail: '5 short parts · about 2 minutes. Nothing is final until you confirm.',
    });
    expect(reviewBanner(version({ criteria: [criterion(1, 'manual')] })).title).toBe('Review it: context, details and 1 check');
    expect(reviewBanner(version({ criteria: [] })).title).toBe('Review it: context and details');
    const long = version({ sections: [{ title: 'Goal', content: 'word '.repeat(900) }] });
    expect(reviewMinutes(long)).toBe(6);
  });
});
