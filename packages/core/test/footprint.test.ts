// H99/H100: the footprint of a merged pull request and the «Existing code to reuse» lines of a brief.

import { describe, expect, it } from 'vitest';
import { type FootprintApi, isReusableFile, pullRequestFootprint } from '../src/build/footprint.ts';
import { reuseLines } from '../src/build/queue.ts';
import type { GithubConfig } from '../src/github/client.ts';
import { pullRequestFiles } from '../src/github/client.ts';

const cfg: GithubConfig = { token: 't', owner: 'acme', api: 'https://api.github.com' };

describe('footprint', () => {
  it('H99 keeps the merge commit and the files of the pull request', async () => {
    const api: FootprintApi = {
      pullRequest: async () => ({ mergeCommitSha: 'abc1234' }),
      pullRequestFiles: async () => [{ path: 'migrations/0003_create_cardio_sessions.sql', additions: 12, deletions: 0, status: 'added' }],
    };
    expect(await pullRequestFootprint(api, cfg, { owner: 'acme', repo: 'meals' }, 20)).toEqual({
      merge_commit: 'abc1234',
      files: [{ path: 'migrations/0003_create_cardio_sessions.sql', additions: 12, deletions: 0, status: 'added' }],
    });
    const none: FootprintApi = { ...api, pullRequest: async () => ({ mergeCommitSha: null }) };
    expect((await pullRequestFootprint(none, cfg, { owner: 'acme', repo: 'meals' }, 20)).merge_commit).toBeNull();
  });

  it('H99 pages the files of a pull request and caps them at 300', async () => {
    const fetched: string[] = [];
    const page = (n: number) => Array.from({ length: 100 }, (_, i) => ({ filename: `f${n}-${i}.ts`, additions: 1, deletions: 0, status: 'added' }));
    const f = (async (url: string) => {
      fetched.push(url);
      return new Response(JSON.stringify(page(fetched.length)), { status: 200 });
    }) as unknown as typeof fetch;
    const files = await pullRequestFiles({ ...cfg, fetch: f }, 'acme', 'meals', 20);
    expect(files).toHaveLength(300);
    expect(fetched).toHaveLength(3);
    expect(fetched[0]).toContain('/pulls/20/files?per_page=100&page=1');
  });

  it('H99 leaves lockfiles, snapshots and generated files out', () => {
    for (const p of ['pnpm-lock.yaml', 'a/b.snap', 'x/__snapshots__/y.txt', 'src/generated/tables.ts']) expect(isReusableFile(p)).toBe(false);
    expect(isReusableFile('src/routes/cardio.ts')).toBe(true);
  });
});

describe('brief: existing code to reuse', () => {
  const file = (path: string, additions = 1) => ({ path, additions, deletions: 0, status: 'added' });
  const fp = (code: string, files: ReturnType<typeof file>[]) => ({ code, title: `Title ${code}`, merge_commit: null, files });

  it('H100 lists dependency files first, most touched first, and caps at 15', () => {
    const dep = fp('TSK-A-001', [file('dep/small.ts', 2), file('dep/big.ts', 50), file('pnpm-lock.yaml', 999)]);
    const same = fp('TSK-A-002', Array.from({ length: 20 }, (_, i) => file(`same/f${String(i).padStart(2, '0')}.ts`, 5)));
    const lines = reuseLines([same, dep], new Map([['TSK-A-001', 0], ['TSK-A-002', 1]]));
    expect(lines).toHaveLength(15);
    expect(lines.slice(0, 2)).toEqual(['- dep/big.ts (TSK-A-001: Title TSK-A-001)', '- dep/small.ts (TSK-A-001: Title TSK-A-001)']);
    expect(lines.some((l) => l.includes('pnpm-lock'))).toBe(false);
    expect(lines[2]).toBe('- same/f00.ts (TSK-A-002: Title TSK-A-002)');
  });

  it('H100 is empty when nothing merged is related', () => {
    expect(reuseLines([], new Map([['TSK-A-001', 0]]))).toEqual([]);
    expect(reuseLines([fp('TSK-Z-009', [file('z.ts')])], new Map([['TSK-A-001', 0]]))).toEqual([]);
  });
});
