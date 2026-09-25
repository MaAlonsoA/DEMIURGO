import { describe, expect, it } from 'vitest';
import { addCheck } from '../../src/screens/new-version/form.ts';
import { blankRecord, recordMissing, toCreateCommand, withType } from '../../src/screens/new-record/form.ts';

describe('a record written by hand', () => {
  it("starts from its type's template, with no checks", () => {
    expect(blankRecord('adr').sections.map((s) => s.title)).toEqual(['Context', 'Options', 'Decision', 'Consequences']);
    expect(blankRecord('decision').sections.map((s) => s.title)).toEqual(['Context', 'Decision', 'Consequences']);
    expect(blankRecord('fdr').checks).toEqual([]);
  });

  it('keeps what was written in the sections both types share when the type changes', () => {
    const f = blankRecord('decision');
    const written = { ...f, sections: f.sections.map((s) => ({ ...s, content: `about ${s.title}` })) };
    const adr = withType(written, 'adr');
    expect(adr.type).toBe('adr');
    expect(adr.sections.map((s) => [s.title, s.content])).toEqual([
      ['Context', 'about Context'],
      ['Options', ''],
      ['Decision', 'about Decision'],
      ['Consequences', 'about Consequences'],
    ]);
  });

  it('says what is missing in words: title, area, every section and, for types that need them, a complete check', () => {
    expect(recordMissing(blankRecord('adr'))).toEqual([
      'Give it a title.',
      'Say which area it belongs to.',
      'Write the Context section.',
      'Write the Options section.',
      'Write the Decision section.',
      'Write the Consequences section.',
      'Add at least one check: a tech decision needs them.',
    ]);
    const decision = {
      ...blankRecord('decision'),
      title: 'Members only',
      domain: 'Club Life',
      sections: blankRecord('decision').sections.map((s) => ({ ...s, content: 'x' })),
    };
    expect(recordMissing(decision)).toEqual(['The area can only have lowercase letters and underscores, like club_life.']);
    expect(recordMissing({ ...decision, domain: 'club_life' })).toEqual([]);
    const withCheck = addCheck({ ...blankRecord('adr'), title: 't', domain: 'club' });
    expect(recordMissing(withCheck)).toContain('Give the new check a title, a statement and how it is checked.');
  });

  it('becomes record.create with its template sections and new checks', () => {
    const f = addCheck({
      ...blankRecord('adr'),
      title: ' Postgres for everything ',
      domain: 'platform',
      sections: blankRecord('adr').sections.map((s) => ({ ...s, content: `${s.title} text` })),
    });
    const filled = {
      ...f,
      checks: f.checks.map((c) => ({
        ...c,
        title: 'One base',
        statement: 'Only one database runs.',
        check: 'Count the databases.',
      })),
    };
    expect(toCreateCommand(filled)).toEqual({
      type: 'adr',
      domain: 'platform',
      title: 'Postgres for everything',
      sections: [
        { title: 'Context', content: 'Context text' },
        { title: 'Options', content: 'Options text' },
        { title: 'Decision', content: 'Decision text' },
        { title: 'Consequences', content: 'Consequences text' },
      ],
      criteria: [
        {
          carry: 'new',
          title: 'One base',
          statement: 'Only one database runs.',
          verification: 'automatic',
          check: 'Count the databases.',
        },
      ],
    });
  });
});
