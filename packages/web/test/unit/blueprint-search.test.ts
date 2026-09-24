import { describe, expect, it } from 'vitest';
import type { ProductRow } from '../../src/api/types.ts';
import { highlight, searchTarget, snippet } from '../../src/screens/blueprint/search.ts';

const rows = [{ code: 'FDR-CAT-001' }, { code: 'DEC-EVE-001' }] as ProductRow[];

describe('where a result of the header search goes', () => {
  it('AC-INT-001-17 a record result opens its record at the version it comes from', () => {
    expect(searchTarget({ ref: 'FDR-CAT-001@2', type: 'fdr' }, rows)).toEqual({ code: 'FDR-CAT-001', v: 2 });
    expect(searchTarget({ ref: 'DEC-EVE-001@1', type: 'decision' }, undefined)).toEqual({ code: 'DEC-EVE-001', v: 1 });
    expect(searchTarget({ ref: 'ADR-ST1-004@3', type: 'adr' }, [])).toEqual({ code: 'ADR-ST1-004', v: 3 });
  });

  it('AC-INT-001-17 a check opens the Checks of the record that contains it; anything else has no page', () => {
    expect(searchTarget({ ref: 'AC-CAT-001-02@2', type: 'criterion' }, rows)).toEqual({
      code: 'FDR-CAT-001',
      v: 2,
      tab: 'checks',
    });
    // Without the product state (or the record in it), a check can't be placed.
    expect(searchTarget({ ref: 'AC-CAT-001-02@2', type: 'criterion' }, undefined)).toBeNull();
    expect(searchTarget({ ref: 'AC-SIG-001-01@1', type: 'criterion' }, rows)).toBeNull();
    expect(searchTarget({ ref: 'idea:42', type: 'idea' }, rows)).toBeNull();
    expect(searchTarget({ ref: 'FDR-CAT-001', type: 'fdr' }, rows)).toBeNull();
  });
});

describe('the words of a result that match', () => {
  it('AC-INT-001-17 marks each word that starts with a searched word, whatever its case and accents', () => {
    expect(highlight('Signing up is instant: sign in first.', 'sign')).toEqual([
      { text: 'Signing', match: true },
      { text: ' up is instant: ', match: false },
      { text: 'sign', match: true },
      { text: ' in first.', match: false },
    ]);
    expect(highlight('La intención del diseño', 'INTENCION diseno')).toEqual([
      { text: 'La ', match: false },
      { text: 'intención', match: true },
      { text: ' del ', match: false },
      { text: 'diseño', match: true },
    ]);
    // A plural or another ending of the same word matches, as in the full-text search.
    expect(highlight('Open activities, one activity, two places.', 'activity place')).toEqual([
      { text: 'Open ', match: false },
      { text: 'activities', match: true },
      { text: ', one ', match: false },
      { text: 'activity', match: true },
      { text: ', two ', match: false },
      { text: 'places', match: true },
      { text: '.', match: false },
    ]);
    // Inside a word is not a match; one-letter words are not searched.
    expect(highlight('It has a design', 'as a')).toEqual([{ text: 'It has a design', match: false }]);
    expect(highlight('Anything', '')).toEqual([{ text: 'Anything', match: false }]);
  });

  it('AC-INT-001-17 the excerpt is a window around the first match', () => {
    const body = `${'Lorem ipsum dolor sit amet. '.repeat(10)}Members join a waitlist when an activity is full.`;
    const s = snippet(body, 'waitlist', 80);
    expect(s.startsWith('…')).toBe(true);
    expect(s).toContain('waitlist');
    expect(s.length).toBeLessThanOrEqual(82);
    expect(snippet('Goal: members\nsee   every activity.', 'members', 80)).toBe('Goal: members see every activity.');
    expect(snippet('No match here at all, but a long text that goes on and on', 'zzz', 20)).toBe('No match here at all…');
  });
});
