import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM template without types
import { affectedCriteria, selectEndToEnd } from '../templates/ci/select-e2e.mjs';

describe('CI paved road: select-e2e.mjs', () => {
  it('keeps valid codes, drops invalid ones and repeats', () => {
    expect(affectedCriteria('AC-ESQ-001-01 bad AC-ESQ-001-01\nTSK-X-1-2 AC-A-1')).toEqual(['AC-ESQ-001-01', 'TSK-X-1-2']);
  });

  it('push to main runs the whole suite', () => {
    expect(selectEndToEnd({ event: 'push', changedFiles: [], trailerValues: 'AC-A-1-1' }).args).toEqual([]);
  });

  it('a pull request with a trailer greps the codes as whole words', () => {
    const { args } = selectEndToEnd({ event: 'pull_request', changedFiles: ['src/a.ts'], trailerValues: 'AC-A-1-1 AC-B-2-3' });
    expect(args).toHaveLength(2);
    expect(args[1]).toBe('--pass-with-no-tests');
    const re = new RegExp(args[0].replace('--grep=', ''));
    expect(re.test('[chromium] › e2e/a.spec.ts › AC-A-1-1 does x')).toBe(true);
    expect(re.test('AC-B-2-3 y')).toBe(true);
    expect(re.test('AC-A-1-10 y')).toBe(false);
    expect(re.test('AC-C-1-1 y')).toBe(false);
    expect(args[0]).not.toMatch(/\s/);
  });

  it('without a trailer, only specs and docs changed runs the changed specs', () => {
    const r = selectEndToEnd({ event: 'pull_request', changedFiles: ['e2e/a.spec.ts', 'docs/x.md', 'src/b.test.ts'], trailerValues: '' });
    expect(r.args).toEqual(['--only-changed=origin/main', '--pass-with-no-tests']);
  });

  it('without a trailer, application code changed runs the whole suite', () => {
    expect(selectEndToEnd({ event: 'pull_request', changedFiles: ['e2e/a.spec.ts', 'src/app.ts'], trailerValues: '' }).args).toEqual([]);
    expect(selectEndToEnd({ event: 'pull_request', changedFiles: [], trailerValues: '' }).args).toEqual([]);
  });
});
