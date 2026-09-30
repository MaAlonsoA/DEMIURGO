// repository.connect: a person connects the project's private GitHub repository from DEMIURGO. GitHub
// is a mocked fetch and a bare repo stands in for the push; an agent gets 403 and touches nothing.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { externalAgent, human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');
const TOKEN = 'ghp_SECRETTOKEN456';
const saved = { ...process.env };

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  for (const k of ['DEMIURGO_PROJECTS_DIR', 'DEMIURGO_GITHUB_TOKEN', 'DEMIURGO_GITHUB_OWNER'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

/** A project with a local repo and a bare "GitHub" remote; GitHub's API answers from `calls`. */
async function setup(name: string, slug: string) {
  const s = environment().services;
  const { projectId } = await executeCommand(s, {
    command: 'project.create',
    actor: ana,
    data: { name },
  });
  const root = mkdtempSync(join(tmpdir(), 'dmg-rc-'));
  const dir = join(root, slug);
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
  process.env.DEMIURGO_PROJECTS_DIR = root;
  // The push goes to the bare repo through a global git config: the token travels in GIT_CONFIG_*
  // variables (gitAuthEnv), which would override an insteadOf set there.
  const globalConfig = join(root, 'gitconfig');
  writeFileSync(globalConfig, `[url "${bare}"]\n\tinsteadOf = https://github.com/ana/${slug}.git\n`);
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  await s.db.insertInto('project_repos').values({ project_id: projectId, dir: slug }).execute();
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url: String(url) });
    if (method === 'GET' && String(url).endsWith(`/repos/ana/${slug}`)) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ type: 'User' }), { status: 200 });
  });
  return { s, projectId, calls };
}

const connect = (s: ReturnType<typeof environment>['services'], projectId: string, actor = ana) =>
  executeCommand(s, {
    command: 'repository.connect',
    actor,
    projectId,
    entityId: projectId,
    data: {},
  });

describe('repository.connect', () => {
  it('creates the private repo, saves the link and leaves its event', async () => {
    process.env.DEMIURGO_GITHUB_TOKEN = TOKEN;
    process.env.DEMIURGO_GITHUB_OWNER = 'ana';
    const { s, projectId, calls } = await setup('Connect Me', 'connect-me');
    const r = await connect(s, projectId);
    expect(r.result).toMatchObject({
      owner: 'ana',
      repo: 'connect-me',
      url: 'https://github.com/ana/connect-me',
      protection: 'github',
      connected: true,
    });
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/user/repos'))).toBe(true);
    const links = await s.db.selectFrom('project_github').selectAll().where('project_id', '=', projectId).execute();
    expect(links).toHaveLength(1);
    const { rows } = await sql<{
      actor: string;
      after: Record<string, string>;
    }>`
      select actor, after from events where command = 'repository.connect' and project_id = ${projectId}::uuid`.execute(s.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe('human:ana');
    expect(rows[0]?.after).toMatchObject({
      owner: 'ana',
      repo: 'connect-me',
      url: 'https://github.com/ana/connect-me',
    });
    expect(JSON.stringify(rows)).not.toContain(TOKEN);
  });

  it('is idempotent: connecting again returns the same repo and calls GitHub no more', async () => {
    process.env.DEMIURGO_GITHUB_TOKEN = TOKEN;
    process.env.DEMIURGO_GITHUB_OWNER = 'ana';
    const { s, projectId, calls } = await setup('Twice', 'twice');
    await connect(s, projectId);
    const before = calls.length;
    const again = await connect(s, projectId);
    expect(again.result).toMatchObject({
      owner: 'ana',
      repo: 'twice',
      connected: false,
    });
    expect(calls).toHaveLength(before);
    const links = await s.db.selectFrom('project_github').selectAll().where('project_id', '=', projectId).execute();
    expect(links).toHaveLength(1);
  });

  it('is not for an agent: 403, no GitHub call and nothing saved', async () => {
    process.env.DEMIURGO_GITHUB_TOKEN = TOKEN;
    process.env.DEMIURGO_GITHUB_OWNER = 'ana';
    const { s, projectId, calls } = await setup('Agents Out', 'agents-out');
    await expect(connect(s, projectId, externalAgent('bot', 's1'))).rejects.toMatchObject({ type: 'forbidden' });
    expect(calls).toHaveLength(0);
    const links = await s.db.selectFrom('project_github').selectAll().where('project_id', '=', projectId).execute();
    expect(links).toHaveLength(0);
  });

  it('says how to configure GitHub when it is not, and saves nothing', async () => {
    delete process.env.DEMIURGO_GITHUB_TOKEN;
    delete process.env.DEMIURGO_GITHUB_OWNER;
    const { s, projectId, calls } = await setup('No Config', 'no-config');
    await expect(connect(s, projectId)).rejects.toMatchObject({
      type: 'conflict',
      message: 'GitHub is not configured on this DEMIURGO: set DEMIURGO_GITHUB_TOKEN and DEMIURGO_GITHUB_OWNER.',
    });
    expect(calls).toHaveLength(0);
    const { rows } =
      await sql`select 1 from events where command = 'repository.connect' and project_id = ${projectId}::uuid`.execute(s.db);
    expect(rows).toHaveLength(0);
  });
});
