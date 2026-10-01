// GitHub rewind of a project restore: the refusal decision, and the push + pull request closing with
// GitHub mocked (a stubbed fetch) and a bare repo standing in for the remote.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newerPullRequests, rewindGithub, rewindRefusal } from '../src/dev/github-rewind.ts';
import type { GithubConfig } from '../src/github/client.ts';

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  process.env.GIT_CONFIG_GLOBAL = saved.GIT_CONFIG_GLOBAL;
  if (saved.GIT_CONFIG_GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL;
});

const snap = { owner: 'ana', repo: 'demo', main: 'a'.repeat(40) };
const cfg = (f?: typeof fetch): GithubConfig => ({ token: 'ghp_X', owner: 'ana', api: 'https://api.github.com', ...(f ? { fetch: f } : {}) });

describe('rewindRefusal', () => {
  it('allows a demiurgo-protected repo that matches the snapshot', () => {
    expect(rewindRefusal(snap, { owner: 'ana', repo: 'demo', protection: 'demiurgo' }, cfg())).toBeNull();
  });
  it('refuses GitHub branch protection, other repos, no data, no link and no config', () => {
    expect(rewindRefusal(snap, { owner: 'ana', repo: 'demo', protection: 'github' }, cfg())).toMatch(/branch protection/);
    expect(rewindRefusal(snap, { owner: 'ana', repo: 'other', protection: 'demiurgo' }, cfg())).toMatch(/not rewound/);
    expect(rewindRefusal(null, { owner: 'ana', repo: 'demo', protection: 'demiurgo' }, cfg())).toMatch(/no GitHub data/);
    expect(rewindRefusal(snap, null, cfg())).toMatch(/not linked/);
    expect(rewindRefusal(snap, { owner: 'ana', repo: 'demo', protection: 'demiurgo' }, null)).toMatch(/not configured/);
  });
});

describe('newerPullRequests', () => {
  it('keeps only the pull requests created after the snapshot', () => {
    const prs = [{ createdAt: '2026-10-01T10:00:00Z' }, { createdAt: '2026-10-01T08:00:00Z' }];
    expect(newerPullRequests(prs, '2026-10-01T09:00:00Z')).toEqual([prs[0]]);
  });
});

describe('rewindGithub', () => {
  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'dmg-rw-'));
    const dir = join(root, 'work');
    const bare = join(root, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    writeFileSync(join(dir, 'a'), '1');
    g('add', '.');
    g('commit', '-q', '-m', 'one');
    const first = g('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'a'), '2');
    g('commit', '-q', '-am', 'two');
    const config = join(root, 'gitconfig');
    writeFileSync(config, `[url "${bare}"]\n\tinsteadOf = https://github.com/ana/demo.git\n`);
    process.env.GIT_CONFIG_GLOBAL = config;
    g('push', '-q', 'https://github.com/ana/demo.git', 'main:refs/heads/main');
    return { dir, bare, first, g };
  }

  it('force-pushes main to the snapshot, closes newer pull requests and deletes their branches', async () => {
    const { dir, bare, first } = setup();
    const calls: { method: string; url: string; body?: string }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      calls.push({ method, url: String(url), body: init.body as string | undefined });
      if (method === 'GET')
        return new Response(
          JSON.stringify([
            { number: 7, created_at: '2026-10-01T12:00:00Z', head: { ref: 'task/x', repo: { full_name: 'ana/demo' } } },
            { number: 3, created_at: '2026-09-30T12:00:00Z', head: { ref: 'old', repo: { full_name: 'ana/demo' } } },
          ]),
          { status: 200 },
        );
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const out = await rewindGithub({ repoDir: dir, snap: { owner: 'ana', repo: 'demo', main: first }, since: '2026-10-01T09:00:00Z', label: 'before', cfg: cfg(f) });
    expect(out).toBe(`GitHub main reset to ${first.slice(0, 8)}; 1 pull request closed.`);
    expect(execFileSync('git', ['-C', bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim()).toBe(first);
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url.replace('https://api.github.com', '')}`);
    expect(writes).toEqual([
      'POST /repos/ana/demo/issues/7/comments',
      'PATCH /repos/ana/demo/pulls/7',
      'DELETE /repos/ana/demo/git/refs/heads/task/x',
    ]);
    expect(calls[1]?.body).toContain('restored to the snapshot “before”');
  });

  it('does not touch GitHub when the snapshot commit is unknown locally', async () => {
    const { dir } = setup();
    const f = vi.fn() as unknown as typeof fetch;
    const out = await rewindGithub({ repoDir: dir, snap, since: '2026-10-01T09:00:00Z', label: 'x', cfg: cfg(f) });
    expect(out).toMatch(/could not be reset/);
    expect(f).not.toHaveBeenCalled();
  });
});
