// The questions of a version's thread in its readiness: each one named, and an answer DEMIURGO
// assumed blocks "Ready to build" until the person confirms it (everything is approved by a person).

import { describe, expect, it } from 'vitest';
import { type ReadinessInput, questionReason, readiness } from '../src/records.ts';

const ready: ReadinessInput = {
  code: 'FDR-CLU-001',
  type: 'fdr',
  version: { n: 1, state: 'approved' },
  current: 1,
  criteria: [
    {
      code: 'AC-CLU-001-01',
      verification: 'automatic',
      check: 'A test signs up.',
      statement: 'Given a member, then they sign up.',
    },
  ],
  basedOn: [{ code: 'DEC-CLU-001', version: 1, versionState: 'approved', current: 1, linkState: 'current' }],
  linksUnderReview: [],
  openQuestions: [],
  pendingProposals: 0,
};

describe('the questions of its thread in the readiness', () => {
  it('names each question in its reason, in words', () => {
    expect(questionReason('pending', 'Who pays for the trips?')).toBe(
      'A question of its thread is open: “Who pays for the trips?”',
    );
    expect(questionReason('postponed', 'Who pays?')).toBe('A question of its thread was left for later: “Who pays?”');
    expect(questionReason('inferred', 'Who pays?')).toBe('DEMIURGO assumed an answer you have not confirmed: “Who pays?”');
    const long = `${'word '.repeat(60)}end`;
    expect(questionReason('pending', long).length).toBeLessThan(200);
    expect(questionReason('pending', long)).toMatch(/…”$/);
  });

  it('blocks on pending, postponed and assumed answers, one reason each, and is ready without them', () => {
    expect(readiness(ready)).toMatchObject({ ready: true, reasons: [] });
    const r = readiness({
      ...ready,
      openQuestions: [
        { question: 'Who pays?', state: 'pending' },
        { question: 'Guests?', state: 'postponed' },
        { question: 'Refunds?', state: 'inferred' },
      ],
    });
    expect(r.ready).toBe(false);
    expect(r.reasons).toEqual([
      questionReason('pending', 'Who pays?'),
      questionReason('postponed', 'Guests?'),
      questionReason('inferred', 'Refunds?'),
    ]);
  });
});
