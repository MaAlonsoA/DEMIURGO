import { describe, expect, it } from 'vitest';
import { stageQuestionReference, withReferenceOption } from '../src/stages.ts';

const opt = (answer: string, recommended = false) => ({ answer, implies: 'x', exclusive: false, recommended });

describe('stage question reference answers', () => {
  it('quality usability and data have a reference that matches its own answer', () => {
    for (const key of ['usability', 'data']) {
      const ref = stageQuestionReference('quality', key);
      expect(ref, key).toBeDefined();
      expect(new RegExp(ref!.mentions, 'i').test(`${ref!.answer} ${ref!.implies}`)).toBe(true);
      expect(ref!.source.length).toBeGreaterThan(0);
    }
  });

  const ref = stageQuestionReference('quality', 'usability')!;

  it('appends the reference when no option mentions it', () => {
    const r = withReferenceOption([opt('Anyone'), opt('Experts')], ref);
    expect(r.added).toBe(true);
    expect(r.options).toHaveLength(3);
    expect(r.options[2]?.answer).toContain('WCAG 2.2');
    expect(r.options[2]?.implies).toContain('Source:');
  });

  it('leaves the options alone when one mentions it', () => {
    const options = [opt('Anyone'), opt('Follow wcag AA')];
    const r = withReferenceOption(options, ref);
    expect(r.added).toBe(false);
    expect(r.options).toBe(options);
  });

  it('replaces the last non-recommended option when there are already 4', () => {
    const r = withReferenceOption([opt('a'), opt('b'), opt('c'), opt('d', true)], ref);
    expect(r.added).toBe(true);
    expect(r.options).toHaveLength(4);
    expect(r.options[3]?.answer).toBe('d');
    expect(r.options[2]?.answer).toContain('WCAG');
  });
});
