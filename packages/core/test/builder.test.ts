import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BuilderSpec, builderArguments } from '../src/runner/builder.ts';
import { branchName, commitAll, diffStat, hostPathOf, prepareWorktree, removeWorktree } from '../src/build/workspace.ts';

const spec: BuilderSpec = {
  worktreeHostPath: '/Users/x/Development/Demiurgo-projects/.worktrees/b1',
  provider: 'claude',
  model: 'opus',
  effort: 'high',
  prompt: 'brief',
  maxTimeMs: 1_800_000,
  limits: { cpus: 2, memoryMb: 4096, pids: 512 },
};

describe('builderArguments', () => {
  it('builds the fixed hardened profile with only two mounts', () => {
    const args = builderArguments(spec, 'demiurgo-build-1', {});
    expect(args.slice(0, 4)).toEqual(['run', '--rm', '-i', '--name']);
    expect(args).toContain('--read-only');
    expect(args.join(' ')).toContain('--cap-drop ALL --security-opt no-new-privileges --user 501:501');
    expect(args).not.toContain('--network');
    expect(args).not.toContain('--privileged');
    const mounts = args.filter((_, i) => args[i - 1] === '--mount');
    expect(mounts).toEqual([
      `type=bind,source=${spec.worktreeHostPath},target=/workspace`,
      'type=volume,source=demiurgo_cli-auth,target=/auth,readonly',
    ]);
    expect(args.join(' ')).not.toContain('docker.sock');
    expect(args).toContain('demiurgo/app:local');
    const envs = args.filter((_, i) => args[i - 1] === '--env');
    expect(envs).toEqual(['CI=1', 'CLAUDE_CONFIG_DIR=/home/demiurgo/.claude-auth', 'HOME=/home/demiurgo', 'LANG=C.UTF-8', 'TZ=UTC']);
    expect(args.slice(args.indexOf('builder') + 1)).toEqual([
      'claude', '-p', '--model', 'opus', '--output-format', 'stream-json', '--verbose', '--effort', 'high',
      '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Glob,Grep,Bash,WebSearch',
      '--disallowedTools', 'WebFetch', '--setting-sources', '',
    ]);
  });

  it('builds the codex command and honours the overrides', () => {
    const args = builderArguments({ ...spec, provider: 'codex', model: 'gpt-6-astra', effort: 'medium' }, 'n1', {
      DEMIURGO_UID: '1000',
      DEMIURGO_GID: '1001',
      DEMIURGO_BUILDER_IMAGE: 'img:x',
      DEMIURGO_CLI_AUTH_VOLUME: 'vol',
    });
    expect(args).toContain('1000:1001');
    expect(args).toContain('img:x');
    expect(args).toContain('type=volume,source=vol,target=/auth,readonly');
    const cli = args.slice(args.indexOf('builder') + 1);
    expect(cli.slice(0, 4)).toEqual(['codex', 'exec', '--json', '-m']);
    expect(cli).toContain('sandbox_mode="workspace-write"');
    expect(cli).toContain('web_search="live"');
    expect(cli.at(-1)).toBe('-');
    expect(args).toContain('CODEX_HOME=/home/demiurgo/.codex-auth');
  });

  it('rejects unsafe specs', () => {
    expect(() => builderArguments({ ...spec, maxTimeMs: 3_600_001 }, 'n', {})).toThrow();
    expect(() => builderArguments({ ...spec, worktreeHostPath: '/a:/b' }, 'n', {})).toThrow();
    expect(() => builderArguments({ ...spec, model: 'x; rm -rf /' }, 'n', {})).toThrow();
    expect(() => builderArguments(spec, 'bad name', {})).toThrow();
  });
});

describe('worktree helpers', () => {
  let root: string;
  let repo: string;
  const saved = { dir: process.env.DEMIURGO_PROJECTS_DIR, host: process.env.DEMIURGO_PROJECTS_HOST_DIR };
  const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dmg-builder-'));
    repo = join(root, 'proj');
    mkdirSync(repo);
    sh(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'README.md'), 'hi\n');
    sh(repo, 'add', '-A');
    sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
    process.env.DEMIURGO_PROJECTS_DIR = root;
    process.env.DEMIURGO_PROJECTS_HOST_DIR = '/host/projects';
  });
  afterEach(() => {
    process.env.DEMIURGO_PROJECTS_DIR = saved.dir;
    process.env.DEMIURGO_PROJECTS_HOST_DIR = saved.host;
    if (saved.dir === undefined) delete process.env.DEMIURGO_PROJECTS_DIR;
    if (saved.host === undefined) delete process.env.DEMIURGO_PROJECTS_HOST_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  it('names the branch from the task code and the build id', () => {
    expect(branchName('TSK-ABC-001', 'abcdef123456')).toBe('task/tsk-abc-001-ef123456');
  });

  it('prepares a worktree, reports the diff, commits and removes it', async () => {
    const wt = await prepareWorktree({ repoDir: repo, taskCode: 'TSK-A-1', buildId: '0123456789abcdef' });
    expect(wt.branch).toBe('task/tsk-a-1-89abcdef');
    expect(wt.path).toBe(join(root, '.worktrees', '0123456789abcdef'));
    expect(sh(wt.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(wt.branch);
    expect(await commitAll(wt.path, 'nothing')).toBeNull();
    writeFileSync(join(wt.path, 'a.txt'), 'x\n');
    expect(await diffStat(wt.path)).toContain('a.txt');
    const sha = await commitAll(wt.path, 'add a');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(sh(wt.path, 'log', '-1', '--format=%an <%ae>')).toBe('DEMIURGO builder <builder@demiurgo.local>');
    await removeWorktree(repo, wt.path);
    expect(existsSync(wt.path)).toBe(false);
    expect(sh(repo, 'branch', '--list', wt.branch)).toContain(wt.branch);
  });

  it('branches from origin/main when an origin exists', async () => {
    const origin = join(root, 'origin.git');
    execFileSync('git', ['clone', '-q', '--bare', repo, origin]);
    sh(repo, 'remote', 'add', 'origin', origin);
    const wt = await prepareWorktree({ repoDir: repo, taskCode: 'TSK-B-2', buildId: 'ffffffff0000' });
    expect(sh(wt.path, 'rev-parse', 'HEAD')).toBe(sh(repo, 'rev-parse', 'origin/main'));
  });

  it('a second attempt on the same branch integrates origin/main first (code merged meanwhile)', async () => {
    const origin = join(root, 'origin.git');
    execFileSync('git', ['clone', '-q', '--bare', repo, origin]);
    sh(repo, 'remote', 'add', 'origin', origin);
    const first = await prepareWorktree({ repoDir: repo, taskCode: 'TSK-C-3', buildId: 'aaaaaaaa1111' });
    writeFileSync(join(first.path, 'mine.txt'), 'x\n');
    await commitAll(first.path, 'mine');
    sh(first.path, 'push', '-q', 'origin', first.branch);
    await removeWorktree(repo, first.path);
    // Another task merges into main meanwhile.
    const other = join(root, 'other');
    execFileSync('git', ['clone', '-q', origin, other]);
    writeFileSync(join(other, 'theirs.txt'), 'y\n');
    sh(other, 'add', '-A');
    sh(other, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'theirs');
    sh(other, 'push', '-q', 'origin', 'main');

    const again = await prepareWorktree({ repoDir: repo, taskCode: 'TSK-C-3', buildId: 'aaaaaaaa1111', existingBranch: first.branch });
    expect(existsSync(join(again.path, 'theirs.txt'))).toBe(true);
    expect(existsSync(join(again.path, 'mine.txt'))).toBe(true);
  });

  it('maps container paths to host paths', () => {
    expect(hostPathOf(join(root, '.worktrees', 'b1'))).toBe('/host/projects/.worktrees/b1');
    expect(() => hostPathOf('/elsewhere')).toThrow();
  });
});
