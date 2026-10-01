import { describe, expect, it } from 'vitest';
import { promptExtras } from '../src/build/orchestrator.ts';

const feedback = { blocking: ['Rename the helper'], fixes: [], failing: [], failures: [], design: [], ownership: [], flaky: [], conflicts: [], progress: 'step 1 done', history: ['## Attempt 1', 'it failed'] };
const empty = { blocking: [], fixes: [], failing: [], failures: [], design: [], ownership: [], flaky: [], conflicts: [] };

describe('promptExtras', () => {
  it('fresh session: starts after the brief and leaves out the agent body and the brief', () => {
    const text = promptExtras('AGENT BODY', 'THE BRIEF', 2, feedback, null, ['# Code to extend', '- a.ts'], false, ['# Earlier builds', 'x']);
    expect(text).not.toContain('AGENT BODY');
    expect(text).not.toContain('THE BRIEF');
    expect(text.startsWith('# Code to extend')).toBe(true);
    expect(text.indexOf('# Earlier builds')).toBeGreaterThan(text.indexOf('# Code to extend'));
    expect(text.indexOf('# Feedback on the previous attempt')).toBeGreaterThan(text.indexOf('# Earlier builds'));
    expect(text).toContain('Rename the helper');
    expect(text).toContain('it failed');
  });

  it('fresh session, first attempt with nothing extra: empty', () => {
    expect(promptExtras('B', 'BRIEF', 1, empty, null, [], false, [])).toBe('');
  });

  it('resumed session: the whole prompt, with no brief', () => {
    const text = promptExtras('AGENT BODY', 'THE BRIEF', 3, feedback, null, [], true, ['# Earlier builds']);
    expect(text.startsWith('# Continue (attempt 3 on the same branch)')).toBe(true);
    expect(text).toContain('Rename the helper');
    expect(text).not.toContain('THE BRIEF');
    expect(text).not.toContain('# Earlier builds');
  });
});
