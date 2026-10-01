import { describe, expect, it } from 'vitest';
import { asBullets, hasLine, listItems, toggleLine } from '../../src/lib/list-answer.ts';

describe('a suggestion of a list question is added to the answer, not replacing it', () => {
  it('adds a line after what the person typed', () => {
    expect(toggleLine('My own idea', 'Suggested A')).toBe('My own idea\nSuggested A');
    expect(toggleLine('', 'Suggested A')).toBe('Suggested A');
    expect(toggleLine('A\n', 'B')).toBe('A\nB');
  });
  it('takes the line off when it is already there, keeping the rest', () => {
    expect(toggleLine('Mine\nSuggested A\nSuggested B', 'Suggested A')).toBe('Mine\nSuggested B');
    expect(toggleLine('Suggested A', 'Suggested A')).toBe('');
  });
  it('knows which suggestions are in the box', () => {
    expect(hasLine('Mine\n Suggested A ', 'Suggested A')).toBe(true);
    expect(hasLine('Suggested A and more', 'Suggested A')).toBe(false);
  });
});

describe('a list answer keeps its items apart', () => {
  it('reads one item per line or joined with « · »', () => {
    expect(listItems('A\n\n- B\nC · D')).toEqual(['A', 'B', 'C', 'D']);
  });
  it('shows several items as bullets and one item as written', () => {
    expect(asBullets('I know how many books I read\nI see the count each month')).toBe(
      '- I know how many books I read\n- I see the count each month',
    );
    expect(asBullets('One sentence.')).toBe('One sentence.');
  });
});
