// pm-7: the symbol ground truth of the merge footprint (definitions each changed existing file touched).

import { describe, expect, it } from 'vitest';
import { definitionsTouched, type FootprintApi, pullRequestFootprint } from '../src/build/footprint.ts';
import type { GithubConfig } from '../src/github/client.ts';

const cfg: GithubConfig = { token: 't', owner: 'acme', api: 'https://api.github.com' };

const patch = [
  '@@ -1,6 +1,7 @@',
  " import { a } from './a';",
  "+import { b } from './b';",
  ' ',
  ' export function alpha(x: number) {',
  '-  return x;',
  '+  return x + 1;',
  ' }',
  '@@ -40,5 +41,6 @@ export async function gamma(input: string) {',
  '   const y = input.trim();',
  '+  log(y);',
  '   return y;',
  ' }',
  '@@ -60,3 +62,8 @@ export const delta = 1;',
  ' ',
  '+export const Epsilon = () => null;',
  '+',
].join('\n');

describe('definitionsTouched', () => {
  it('maps changed lines to the definition of the hunk header or of a column-0 declaration, not to imports', () => {
    expect(definitionsTouched(patch)).toEqual(['alpha', 'gamma', 'Epsilon']);
  });

  it('maps lines to given definition ranges (additions by line, deletions by their position)', () => {
    const defs = [
      { name: 'alpha', start: 4, end: 7 },
      { name: 'gamma', start: 41, end: 50 },
    ];
    expect(definitionsTouched(patch, defs)).toEqual(['alpha', 'gamma']);
  });

  it('is empty for an empty diff', () => {
    expect(definitionsTouched('')).toEqual([]);
  });

  it('is recorded by the footprint only for modified code files that have a patch', async () => {
    const api: FootprintApi = {
      pullRequest: async () => ({ mergeCommitSha: 'abc' }),
      pullRequestFiles: async () => [
        { path: 'src/a.ts', additions: 2, deletions: 1, status: 'modified', patch },
        { path: 'src/new.ts', additions: 3, deletions: 0, status: 'added', patch },
        { path: 'README.md', additions: 1, deletions: 0, status: 'modified', patch },
      ],
    };
    const fp = await pullRequestFootprint(api, cfg, { owner: 'acme', repo: 'meals' }, 1);
    expect(fp.symbols).toEqual({ 'src/a.ts': ['alpha', 'gamma', 'Epsilon'] });
    expect(fp.files[0]).toEqual({ path: 'src/a.ts', additions: 2, deletions: 1, status: 'modified' });
  });
});
