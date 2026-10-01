import { describe, expect, it } from 'vitest';
import { dedupeDefinitionChanges } from '../src/definition/compose.ts';

const change = (section: string, content: string, quotes: string[]) => ({
  type: 'definition_change' as const,
  section,
  content,
  reason: 'r',
  quotes,
});

describe('one definition_change per section in a turn', () => {
  it('keeps the last text of a section with the quotes of all, and leaves the rest', () => {
    const out = dedupeDefinitionChanges([
      change('What the first version does', 'A', ['q1']),
      { type: 'exploration' as const },
      change('Out of scope', 'X', ['q9']),
      change('What the first version does', 'B', ['q2', 'q1']),
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: 'exploration' });
    expect(out[1]).toMatchObject({ section: 'Out of scope', content: 'X' });
    expect(out[2]).toMatchObject({ section: 'What the first version does', content: 'B', quotes: ['q1', 'q2'] });
  });
});
