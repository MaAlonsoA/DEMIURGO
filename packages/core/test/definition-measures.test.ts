import { describe, expect, it } from 'vitest';
import { pickedWithMeasures } from '../src/definition/principles.ts';

describe('a picked quality scenario keeps its measure', () => {
  it('adds what the option implies when it carries a number', () => {
    expect(
      pickedWithMeasures([{ answer: 'Fast confirmation matters most.', implies: 'A saved entry is confirmed in under 2 seconds for 95% of requests.' }]),
    ).toBe('Fast confirmation matters most: A saved entry is confirmed in under 2 seconds for 95% of requests.');
  });
  it('keeps only the answer when the explanation has no figures', () => {
    expect(pickedWithMeasures([{ answer: 'No automatic expiry', implies: 'Retention follows the owner.' }])).toBe('No automatic expiry');
  });
  it('does not repeat an answer that already says it', () => {
    const answer = 'Confirm in under 2 seconds';
    expect(pickedWithMeasures([{ answer, implies: 'under 2 seconds' }])).toBe(answer);
  });
});
