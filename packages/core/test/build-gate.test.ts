import { describe, expect, it } from 'vitest';
import { type GateCi, type GateReview, decideGate } from '../src/build/gate.ts';

describe('decideGate', () => {
  const cases: [GateCi, GateReview, string][] = [
    ['pending', 'pending', 'wait'],
    ['green', 'pending', 'wait'],
    ['red', 'pending', 'wait'],
    ['pending', 'approved', 'wait'],
    ['pending', 'rejected', 'reject_review'],
    ['pending', 'failed', 'review_failed'],
    ['green', 'approved', 'pass'],
    ['red', 'approved', 'reject_ci'],
    ['green', 'rejected', 'reject_review'],
    ['red', 'rejected', 'reject_review'],
    ['red', 'failed', 'review_failed'],
  ];
  for (const [ci, review, want] of cases) it(`ci ${ci} + review ${review} -> ${want}`, () => expect(decideGate({ ci, review })).toBe(want));
});
