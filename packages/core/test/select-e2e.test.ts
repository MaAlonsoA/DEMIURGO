import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM template without types
import { affectedCriteria, isDocsOnly, selectEndToEnd } from '../templates/ci/select-e2e.mjs';

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

  describe('lane', () => {
    const pr = (changedFiles: string[], trailerValues = '') => selectEndToEnd({ event: 'pull_request', changedFiles, trailerValues });

    it('docs-only changes are the light lane, even with a trailer', () => {
      expect(pr(['docs/a.md', 'README.md', 'design/x.yaml', '.demiurgo/build-report.json', 'src/notes.mdx']).lane).toBe('light');
      expect(pr(['docs/a.md'], 'AC-A-1-1').lane).toBe('light');
    });

    it('a test file, even under docs/, is never light', () => {
      expect(isDocsOnly('docs/a.md')).toBe(true);
      expect(isDocsOnly('docs/example.spec.ts')).toBe(false);
      expect(isDocsOnly('e2e/a.spec.ts')).toBe(false);
      expect(pr(['docs/a.md', 'e2e/a.spec.ts']).lane).toBe('selected');
    });

    it('application code is full, or selected with a trailer', () => {
      expect(pr(['docs/a.md', 'src/app.ts']).lane).toBe('full');
      expect(pr(['src/app.ts'], 'AC-A-1-1').lane).toBe('selected');
      expect(pr([]).lane).toBe('full');
    });

    it('push to main is always full', () => {
      expect(selectEndToEnd({ event: 'push', changedFiles: ['docs/a.md'], trailerValues: '' }).lane).toBe('full');
    });
  });
});
