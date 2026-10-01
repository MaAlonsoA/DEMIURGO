import { describe, expect, it } from 'vitest';
import { criterionState, featureDone } from '../src/delivery.ts';

describe('release verification', () => {
  it('a release criterion waits for the deployed check, like a manual one waits for a person', () => {
    expect(criterionState({ verification: 'release', evidence: null, tasks: ['merged'] })).toBe('check_at_release');
    expect(criterionState({ verification: 'manual', evidence: null, tasks: ['merged'] })).toBe('check_by_hand');
  });

  it('evidence wins over the kind, and an open PR shows as in_pr', () => {
    expect(criterionState({ verification: 'release', evidence: { result: 'pass' }, tasks: ['merged'] })).toBe('verified');
    expect(criterionState({ verification: 'release', evidence: { result: 'fail' }, tasks: ['merged'] })).toBe('failing');
    expect(criterionState({ verification: 'release', evidence: null, tasks: ['in_pr'] })).toBe('in_pr');
  });

  it('a feature is not done while a release criterion has no evidence', () => {
    const r = featureDone({
      criteria: [{ code: 'AC-1', state: 'check_at_release' }],
      tasks: [{ code: 'TSK-1', state: 'merged' }],
    });
    expect(r.done).toBe(false);
    expect(r.missing).toEqual(['AC-1 is not verified yet']);
  });
});
