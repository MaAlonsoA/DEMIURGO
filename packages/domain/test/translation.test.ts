import { describe, expect, it } from 'vitest';
import { proseFields, questionFields, readTranslation, translationSourceHash, versionFields } from '../src/translation.ts';

describe('reading translations', () => {
  it('takes the prose of a proposal and leaves codes, enums and references out', () => {
    expect(
      proseFields({
        type: 'design_record',
        record_type: 'fdr',
        title: 'Revoke agent tokens',
        sections: [{ title: 'Goal', content: 'The person can revoke a token.' }],
        criteria: [{ title: 'Revocation', statement: 'When…', verification: 'automatic', check: 'A test.' }],
      }),
    ).toEqual({
      title: 'Revoke agent tokens',
      'sections.0.title': 'Goal',
      'sections.0.content': 'The person can revoke a token.',
      'criteria.0.title': 'Revocation',
      'criteria.0.statement': 'When…',
      'criteria.0.check': 'A test.',
    });
  });

  it('a question carries its reason, conclusion and options; empty parts are left out', () => {
    expect(
      questionFields({
        question: 'Who uses it first?',
        reason: 'Defines scope.',
        conclusion: null,
        reasoning: null,
        options: [{ answer: 'Only me', implies: 'A single user.' }],
      }),
    ).toEqual({
      question: 'Who uses it first?',
      reason: 'Defines scope.',
      'options.0.answer': 'Only me',
      'options.0.implies': 'A single user.',
    });
  });

  it('a version keys its criteria by code', () => {
    const fields = versionFields({
      title: 'Agent panel',
      sections: [{ title: 'Goal', content: 'List agents.' }],
      criteria: [{ code: 'AC-CAN-003-01', title: 'Empty', statement: 'Shows no activity.', check_text: 'Visual.' }],
    });
    expect(fields['criteria.AC-CAN-003-01.statement']).toBe('Shows no activity.');
    expect(fields.title).toBe('Agent panel');
  });

  it('the source fingerprint changes with the text', () => {
    const a = translationSourceHash('message', { body: 'Hello' });
    expect(translationSourceHash('message', { body: 'Hello' })).toBe(a);
    expect(translationSourceHash('message', { body: 'Hello!' })).not.toBe(a);
    expect(translationSourceHash('exploration', { body: 'Hello' })).not.toBe(a);
  });

  it('accepts only a translation with exactly the keys sent', () => {
    const sent = { title: 'Goal', body: 'Text' };
    expect(
      readTranslation(sent, {
        fields: [
          { key: 'title', text: 'Objetivo' },
          { key: 'body', text: '' },
        ],
      }),
    ).toEqual({ ok: true, fields: { title: 'Objetivo', body: 'Text' } });
    expect(readTranslation(sent, { fields: [{ key: 'title', text: 'Objetivo' }] })).toMatchObject({ ok: false });
    expect(
      readTranslation(sent, {
        fields: [
          { key: 'title', text: 'a' },
          { key: 'body', text: 'b' },
          { key: 'other', text: 'c' },
        ],
      }),
    ).toMatchObject({ ok: false });
  });
});
