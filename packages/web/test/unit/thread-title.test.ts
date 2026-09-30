import { describe, expect, it } from 'vitest';
import { hasMoreThanTitle, threadTitle } from '../../src/lib/thread-title.ts';

describe('threadTitle', () => {
  it('takes the first sentence', () => {
    expect(threadTitle('Plan the meals. Then the shopping list.')).toBe('Plan the meals');
    expect(threadTitle('What should it do? Everything.')).toBe('What should it do?');
    expect(threadTitle('Ship it! Soon.')).toBe('Ship it!');
  });
  it('stops at a line break', () => {
    expect(threadTitle('First line\nSecond line. More')).toBe('First line');
  });
  it('does not split inside a version or a decimal', () => {
    expect(threadTitle('Move to v2.3 today')).toBe('Move to v2.3 today');
  });
  it('cuts at 80 characters on a word boundary with an ellipsis', () => {
    const long = `${'word '.repeat(40)}end`;
    const t = threadTitle(long);
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(81);
    expect(t).toBe(`${'word '.repeat(15)}word…`);
  });
  it('cuts a single huge word hard', () => {
    expect(threadTitle('x'.repeat(200))).toBe(`${'x'.repeat(80)}…`);
  });
  it('knows when the purpose is just its title', () => {
    expect(hasMoreThanTitle('Plan the meals.')).toBe(false);
    expect(hasMoreThanTitle('Plan the meals. Then more.')).toBe(true);
  });
});
