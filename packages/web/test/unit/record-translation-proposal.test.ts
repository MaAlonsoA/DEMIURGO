import { describe, expect, it } from 'vitest';
import { APPROVABLE_TYPES, proposalTitle } from '../../src/screens/batch/model.ts';
import { acceptEffects, kindWord, proposalLine } from '../../src/screens/batch/proposal.ts';

const p = {
  type: 'record_translation',
  payload: {
    record: { code: 'FDR-CAN-003', version: 2 },
    title: 'Revoke agent tokens',
    sections: [{ title: 'Goal', content: 'The person can revoke a token at any time.' }],
    criteria: [],
  },
};

describe('the English version of an older record in the inbox', () => {
  it('reads as an English version of the record it translates, and can be approved when accepted', () => {
    expect(kindWord(p.type)).toBe('English version');
    expect(proposalTitle(p)).toBe('Revoke agent tokens');
    expect(proposalLine(p)).toBe('The person can revoke a token at any time.');
    expect(APPROVABLE_TYPES.has('record_translation')).toBe(true);
    expect(acceptEffects(p, true)).toEqual([
      'DEMIURGO records the English version of FDR-CAN-003 v2 as a new version.',
      'You approve it: it becomes the current version.',
    ]);
  });
});
