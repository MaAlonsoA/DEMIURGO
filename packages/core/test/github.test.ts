// GitHub client: mocked fetch, a temporary local git repo (with a bare remote standing in for GitHub's push).

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { human } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import {
  type GithubConfig,
  checkRunsFor,
  ensureProjectRepo,
  githubConfig,
  junitArtifactFor,
  postReview,
  unzipXml,
} from '../src/github/index.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const TOKEN = 'ghp_SECRETTOKEN123';

type Call = { method: string; url: string; body: any };

function mock(handler: (c: Call) => { status: number; json?: unknown; body?: Uint8Array | string }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const call = { method: init.method ?? 'GET', url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const r = handler(call);
    const payload = r.body ?? (r.json === undefined ? '' : JSON.stringify(r.json));
    return new Response(payload as string, { status: r.status });
  }) as unknown as typeof fetch;
  const cfg: GithubConfig = { token: TOKEN, owner: 'ana', api: 'https://api.github.com', fetch: f };
  return { calls, cfg };
}

function zipOf(entries: [string, string][]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameB = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(text));
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(text.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    const local = Buffer.concat([lh, nameB, data]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(text.length, 24);
    ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([ch, nameB]));
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('github', () => {
  it('reads its configuration from the environment', () => {
    expect(githubConfig({})).toBeNull();
    expect(githubConfig({ DEMIURGO_GITHUB_TOKEN: 't', DEMIURGO_GITHUB_OWNER: 'ana' })).toEqual({
      token: 't',
      owner: 'ana',
      api: 'https://api.github.com',
    });
  });

  it('creates a private repo, protects main and never leaks the token', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: human('ana'), data: { name: 'Gh' } });
    const root = mkdtempSync(join(tmpdir(), 'dmg-gh-'));
    const dir = join(root, 'gh-app');
    mkdirSync(dir);
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    writeFileSync(join(dir, 'README.md'), 'x');
    g('add', '.');
    g('commit', '-q', '-m', 'init');
    // The "GitHub" remote is a bare repo: url.insteadOf redirects the push without touching any config file.
    const bare = join(root, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    const saved = { ...process.env };
    process.env.DEMIURGO_PROJECTS_DIR = root;
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = `url.${bare}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_0 = 'https://github.com/ana/gh-app.git';
    await s.db.insertInto('project_repos').values({ project_id: projectId, dir: 'gh-app' }).execute();
    try {
      const { calls, cfg } = mock((c) => {
        if (c.method === 'GET' && c.url.endsWith('/repos/ana/gh-app')) return { status: 404, json: { message: 'Not Found' } };
        if (c.url.endsWith('/users/ana')) return { status: 200, json: { type: 'User' } };
        return { status: 200, json: {} };
      });
      const linked = await ensureProjectRepo(s.db, projectId, cfg);
      expect(linked).toEqual({ owner: 'ana', repo: 'gh-app', url: 'https://github.com/ana/gh-app', protection: 'github' });
      const create = calls.find((c) => c.method === 'POST');
      expect(create?.url).toBe('https://api.github.com/user/repos');
      expect(create?.body).toEqual({ name: 'gh-app', private: true, auto_init: false });
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        allow_auto_merge: true,
        delete_branch_on_merge: true,
        allow_squash_merge: true,
      });
      const protection = calls.find((c) => c.method === 'PUT');
      expect(protection?.url).toContain('/repos/ana/gh-app/branches/main/protection');
      expect(protection?.body.required_status_checks).toEqual({ strict: true, contexts: ['ci', 'demiurgo/review', 'demiurgo/design'] });
      expect(protection?.body.restrictions).toBeNull();
      expect(execFileSync('git', ['-C', bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim()).toBe(g('rev-parse', 'main').trim());
      expect(readFileSync(join(dir, '.git', 'config'), 'utf8')).toContain('url = https://github.com/ana/gh-app.git');
      expect(readFileSync(join(dir, '.git', 'config'), 'utf8')).not.toContain(TOKEN);
      // Idempotent: a second run finds the repo and links once.
      const again = mock((c) => ({ status: 200, json: c.method === 'GET' ? { type: 'User' } : {} }));
      await ensureProjectRepo(s.db, projectId, again.cfg);
      expect(again.calls.some((c) => c.method === 'POST')).toBe(false);
      const links = await s.db.selectFrom('project_github').selectAll().where('project_id', '=', projectId).execute();
      expect(links).toHaveLength(1);
      expect(links[0]?.protection).toBe('github');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      process.env.DEMIURGO_PROJECTS_DIR = saved.DEMIURGO_PROJECTS_DIR;
      if (saved.DEMIURGO_PROJECTS_DIR === undefined) delete process.env.DEMIURGO_PROJECTS_DIR;
    }
  });

  it('a private repo on GitHub Free (403 on auto-merge and protection) still sets up, and records that DEMIURGO enforces the merge rule', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: human('ana'), data: { name: 'Gh Free' } });
    const root = mkdtempSync(join(tmpdir(), 'dmg-gh-'));
    const dir = join(root, 'gh-free');
    mkdirSync(dir);
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    writeFileSync(join(dir, 'README.md'), 'x');
    g('add', '.');
    g('commit', '-q', '-m', 'init');
    const bare = join(root, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    const saved = { ...process.env };
    process.env.DEMIURGO_PROJECTS_DIR = root;
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = `url.${bare}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_0 = 'https://github.com/ana/gh-free.git';
    await s.db.insertInto('project_repos').values({ project_id: projectId, dir: 'gh-free' }).execute();
    try {
      const upgrade = { message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.' };
      const { calls, cfg } = mock((c) => {
        if (c.method === 'GET' && c.url.endsWith('/repos/ana/gh-free')) return { status: 200, json: {} };
        if (c.method === 'PATCH' && c.body?.allow_auto_merge) return { status: 403, json: upgrade };
        if (c.method === 'PUT') return { status: 403, json: upgrade };
        return { status: 200, json: {} };
      });
      const linked = await ensureProjectRepo(s.db, projectId, cfg);
      expect(linked.protection).toBe('demiurgo');
      expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ delete_branch_on_merge: true, allow_squash_merge: true });
      const link = await s.db.selectFrom('project_github').selectAll().where('project_id', '=', projectId).executeTakeFirstOrThrow();
      expect(link.protection).toBe('demiurgo');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      process.env.DEMIURGO_PROJECTS_DIR = saved.DEMIURGO_PROJECTS_DIR;
      if (saved.DEMIURGO_PROJECTS_DIR === undefined) delete process.env.DEMIURGO_PROJECTS_DIR;
    }
  });

  it('redacts the token from thrown errors', async () => {
    const { cfg } = mock(() => ({ status: 401, json: { message: `Bad credentials ${TOKEN}` } }));
    const err = (await checkRunsFor(cfg, 'ana', 'app', 'abc').then(
      () => null,
      (e: unknown) => e,
    )) as Error;
    expect(err.message).toContain('401');
    expect(err.message).not.toContain(TOKEN);
  });

  it('retries a review without inline comments when GitHub answers 422', async () => {
    let n = 0;
    const { calls, cfg } = mock(() => ({ status: n++ === 0 ? 422 : 200, json: {} }));
    await postReview(cfg, 'ana', 'app', 3, { body: 'ok', comments: [{ path: 'a.ts', line: 99, body: 'x' }] });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body.comments).toHaveLength(1);
    expect(calls[1]?.body).toEqual({ event: 'COMMENT', body: 'ok' });
  });

  it('extracts the JUnit XML from a deflated zip artifact', async () => {
    const zip = zipOf([
      ['a/junit-1.xml', '<testsuite name="one"/>'],
      ['readme.txt', 'ignored'],
      ['junit-2.xml', '<testsuite name="two"/>'],
    ]);
    expect(unzipXml(zip)).toBe('<testsuite name="one"/>\n<testsuite name="two"/>');
    const { cfg } = mock((c) => {
      if (c.url.includes('/actions/runs?')) return { status: 200, json: { workflow_runs: [{ id: 7 }] } };
      if (c.url.endsWith('/runs/7/artifacts')) return { status: 200, json: { artifacts: [{ id: 9, name: 'junit', expired: false }] } };
      return { status: 200, body: new Uint8Array(zip) };
    });
    expect(await junitArtifactFor(cfg, 'ana', 'app', 'sha')).toContain('name="two"');
    const none = mock(() => ({ status: 200, json: { workflow_runs: [] } }));
    expect(await junitArtifactFor(none.cfg, 'ana', 'app', 'sha')).toBeNull();
  });
});
