import { describe, expect, it } from 'vitest';
import type { Link, RecordVersion } from '../../src/api/types.ts';
import { addCheck, carriedLinks, initialForm, missing, toCommand, versionDirty } from '../../src/screens/new-version/form.ts';
import { statementWarnings } from '../../src/screens/new-version/verifiability.ts';

const base = {
  id: 'v1',
  n: 1,
  state: 'approved',
  title: 'Activity catalog',
  sections: [
    { title: 'Goal', content: 'Members see every activity.' },
    { title: 'Scope', content: 'The list.' },
  ],
  criteria: [
    {
      id: 'c1',
      code: 'AC-CAT-001-01',
      title: 'Upcoming',
      statement: 'When…, then…',
      verification: 'automatic',
      check: 'E2E',
      carry: 'new',
    },
    {
      id: 'c2',
      code: 'AC-CAT-001-02',
      title: 'Places',
      statement: 'When…, then…',
      verification: 'manual',
      check: 'You',
      carry: 'new',
    },
    {
      id: 'c3',
      code: 'AC-CAT-001-03',
      title: 'At once',
      statement: 'When…, then…',
      verification: 'automatic',
      check: 'E2E',
      carry: 'new',
    },
  ],
} as unknown as RecordVersion;

const link = (id: string, to: string, state = 'current') => ({ id, type: 'based_on', to_id: to, state }) as unknown as Link;

describe('the new version form', () => {
  it('AC-INT-001-06 cannot be saved without a note or a choice for every check, and says what is missing', () => {
    let form = initialForm(base);
    expect(missing(form)).toEqual(['Say what changed.', 'Choose Keep, Change or Drop for 3 checks.']);
    form = { ...form, note: 'Past activities get their own tab.' };
    form = { ...form, checks: form.checks.map((c, i) => (i < 2 ? { ...c, choice: 'keep' as const } : c)) };
    expect(missing(form)).toEqual(['Choose Keep, Change or Drop for 1 check.']);
    form = {
      ...form,
      checks: form.checks.map((c) => ({
        ...c,
        choice: c.choice ?? ('change' as const),
        statement: c.choice ? c.statement : ' ',
      })),
    };
    expect(missing(form)).toEqual(['Give AC-CAT-001-03 a title, a statement and how it is checked.']);
    form = addCheck({ ...form, checks: form.checks.map((c) => ({ ...c, statement: 'When x, then y.' })) });
    expect(missing(form)).toEqual(['Give the new check a title, a statement and how it is checked.']);
    form = {
      ...form,
      sections: [
        { title: 'Goal', content: '' },
        { title: 'Scope', content: 'x' },
      ],
    };
    expect(missing(form)).toContain('Write the Goal section.');
  });

  it('AC-INT-001-06 the saved data carries each choice: kept, modified, dropped and new, with the links as they were', () => {
    let form = initialForm(base);
    form = addCheck({ ...form, note: ' Past activities. ' });
    form = {
      ...form,
      checks: form.checks.map((c) => {
        if (c.code === 'AC-CAT-001-01') return { ...c, choice: 'keep' as const };
        if (c.code === 'AC-CAT-001-02')
          return { ...c, choice: 'change' as const, statement: 'When a member opens it, then it shows the places left.' };
        if (c.code === 'AC-CAT-001-03') return { ...c, choice: 'drop' as const };
        return {
          ...c,
          title: 'Past',
          statement: 'When a member opens Past, then they see finished ones.',
          check: 'E2E',
          verification: 'manual' as const,
        };
      }),
    };
    expect(missing(form)).toEqual([]);
    const data = toCommand('r1', form, [{ type: 'based_on', target: { code: 'DEC-EVE-001', version: 1 } }]);
    expect(data).toEqual({
      record_id: 'r1',
      title: 'Activity catalog',
      sections: base.sections,
      change_note: 'Past activities.',
      criteria: [
        { carry: 'kept', code: 'AC-CAT-001-01' },
        {
          carry: 'modified',
          derived_from: 'AC-CAT-001-02',
          title: 'Places',
          statement: 'When a member opens it, then it shows the places left.',
          verification: 'manual',
          check: 'You',
        },
        {
          carry: 'new',
          title: 'Past',
          statement: 'When a member opens Past, then they see finished ones.',
          verification: 'manual',
          check: 'E2E',
        },
      ],
      discarded: ['AC-CAT-001-03'],
      links: [{ type: 'based_on', target: { code: 'DEC-EVE-001', version: 1 } }],
    });
  });

  it('AC-INT-001-06 carries the links of the base whose target is known, and never an obsolete one', () => {
    const index = new Map([
      ['d1', { code: 'DEC-EVE-001', n: 1, title: 'Guests', type: 'decision' }],
      ['d2', { code: 'DEC-EVE-002', n: 3, title: 'Places', type: 'decision' }],
    ]);
    const { carried, unknown } = carriedLinks([link('a', 'd1'), link('b', 'd2', 'obsolete'), link('c', 'x')], index);
    expect(carried).toEqual([{ type: 'based_on', target: { code: 'DEC-EVE-001', version: 1 } }]);
    expect(unknown.map((l) => l.id)).toEqual(['c']);
  });

  it('AC-INT-001-07 a statement with a vague term gets the same verifiability warning as the server gives', () => {
    expect(statementWarnings('The catalog is fast.')).toEqual([
      "the statement doesn't describe an observable result (Given…, when…, then…).",
      '"fast" is vague; state a measure or a checkable result.',
    ]);
    expect(statementWarnings('When a member opens Activities, then they see the upcoming ones.')).toEqual([]);
    expect(statementWarnings('  ')).toEqual([]);
  });
});

describe('leaving the new version form', () => {
  it('asks first only when something was written or chosen: a note, a title, a section, a choice or a new check', () => {
    const form = initialForm(base);
    expect(versionDirty(form, base)).toBe(false);
    expect(versionDirty({ ...form, note: 'Why.' }, base)).toBe(true);
    expect(versionDirty({ ...form, title: `${base.title}!` }, base)).toBe(true);
    expect(versionDirty({ ...form, checks: form.checks.map((c, i) => (i === 0 ? { ...c, choice: 'keep' } : c)) }, base)).toBe(
      true,
    );
    expect(versionDirty(addCheck(form), base)).toBe(true);
  });
});
