// «Open the app»: a review app / preview environment of the project's `main` (the practice of Heroku Review
// Apps and GitLab Review Apps): the app DEMIURGO built runs in its own container with its own database,
// prepared the way the project's CI prepares it, and the person opens it on a local port.
//
// One preview per project. The Docker labels are the source of truth (a restart of the API finds a running
// preview again); the in-memory map only holds the progress and the failure of a start that is under way.
// Convention nuestra: ports 4100-4199 on 127.0.0.1, the database `p_<12 hex of the project id>` (the build
// sweep never drops it) and the seed scripts `seed` and `db:seed`.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DomainError } from '@demiurgo/domain';
import { type CiEnvironment, PLAYWRIGHT_CONFIGS, type StartFiles, environmentFromCi } from '../build/environment.ts';
import { hostPathOf, readWorktreeFile } from '../build/workspace.ts';
import { runGit } from '../github/client.ts';
import { projectsDir } from '../repo/repo.ts';
import { PNPM_STORE_DIR, PW_BROWSERS_DIR, environmentVariables, setupArguments } from '../runner/builder.ts';
import { type DockerExec, dockerExec, prepareEnvironment, projectSlug, teardownEnvironment } from '../runner/environment.ts';
import { NAME_PATTERN } from '../runner/runner.ts';
import type { Services } from '../services.ts';

export const PREVIEW_LABEL = 'demiurgo.preview=1';
export const PREVIEW_PORTS = { first: 4100, last: 4199 } as const;
const DEFAULT_APP_PORT = 3000;
const SEED_SCRIPTS = ['seed', 'db:seed'] as const;
const SEED_NOTE_MAX = 200;
const LIMITS = { cpus: 2, memoryMb: 2048, pids: 512 };

export type PreviewAccount = { role: string; email: string; password: string };
export type PreviewInfo = { url: string; port: number; started_at: string; commit: string; seed?: string; accounts?: PreviewAccount[] };

/**
 * The SEED_* variables the seed script reads (`process.env.SEED_OWNER_EMAIL`, `process.env['SEED_VET_PASSWORD']`), from the
 * files its package.json command names. A preview has no secrets of its own, so DEMIURGO gives them throwaway values.
 */
export function seedVariablesOf(command: string, sources: string[]): string[] {
  void command;
  const names = new Set<string>();
  for (const src of sources)
    for (const m of src.matchAll(/process\.env(?:\.(SEED_[A-Z0-9_]+)|\[\s*['"](SEED_[A-Z0-9_]+)['"]\s*\])/g)) names.add((m[1] ?? m[2]) as string);
  return [...names].toSorted();
}

/** Throwaway values for the seed variables, and the accounts they make (SEED_<ROLE>_EMAIL with SEED_<ROLE>_PASSWORD). */
export function seedValuesFor(names: string[], random: () => string = () => randomBytes(12).toString('base64url')): { env: Record<string, string>; accounts: PreviewAccount[] } {
  const env: Record<string, string> = {};
  for (const n of names) {
    const role = n.replace(/^SEED_/, '').replace(/_(EMAIL|PASSWORD|NAME|PHONE)$/, '').toLowerCase().replace(/_/g, '-') || 'user';
    if (n.endsWith('_EMAIL')) env[n] = `${role}@preview.test`;
    else if (n.endsWith('_PASSWORD')) env[n] = `Pv-${random()}-9a`;
    else if (n.endsWith('_NAME')) env[n] = `Preview ${role}`;
    else if (n.endsWith('_PHONE')) env[n] = '+34600000000';
    else env[n] = `preview-${role}`;
  }
  const accounts: PreviewAccount[] = [];
  for (const n of names.filter((x) => x.endsWith('_EMAIL'))) {
    const password = env[n.replace(/_EMAIL$/, '_PASSWORD')];
    if (password) accounts.push({ role: n.replace(/^SEED_/, '').replace(/_EMAIL$/, '').toLowerCase().replace(/_/g, ' '), email: env[n] as string, password });
  }
  return { env, accounts };
}

const accountsLabel = (accounts: PreviewAccount[]): string => Buffer.from(JSON.stringify(accounts)).toString('base64');
function accountsOf(label: string | undefined): PreviewAccount[] | undefined {
  if (!label) return undefined;
  try {
    const v = JSON.parse(Buffer.from(label, 'base64').toString('utf8')) as unknown;
    return Array.isArray(v) && v.length > 0 ? (v as PreviewAccount[]) : undefined;
  } catch {
    return undefined;
  }
}
export type PreviewStatus =
  | { state: 'stopped' }
  | { state: 'starting'; step: string }
  | ({ state: 'running' } & PreviewInfo)
  | { state: 'failed'; reason: string; log?: string };

// ------------------------------------------------------------------------------------------ pure parts

/** The first host port of the range that is not in use, or null when all are. */
export function pickPort(used: Iterable<number>, first: number = PREVIEW_PORTS.first, last: number = PREVIEW_PORTS.last): number | null {
  const taken = new Set(used);
  for (let p = first; p <= last; p++) if (!taken.has(p)) return p;
  return null;
}

/** The host ports `docker ps --format {{.Ports}}` shows published (`127.0.0.1:4100->3000/tcp, …`). */
export function publishedPorts(psPorts: string): number[] {
  return [...psPorts.matchAll(/:(\d{2,5})->/g)].map((m) => Number(m[1]));
}

const scriptsOf = (packageJson: string | null | undefined): Record<string, unknown> => {
  try {
    const pkg: unknown = packageJson ? JSON.parse(packageJson) : null;
    const scripts = typeof pkg === 'object' && pkg !== null ? (pkg as { scripts?: unknown }).scripts : undefined;
    return typeof scripts === 'object' && scripts !== null ? (scripts as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** The seed script of package.json (`seed`, then `db:seed`), or null. */
export function seedScriptOf(packageJson: string | null | undefined): string | null {
  const scripts = scriptsOf(packageJson);
  for (const name of SEED_SCRIPTS) if (typeof scripts[name] === 'string') return name;
  return null;
}

const managerOf = (ci: CiEnvironment): 'pnpm' | 'npm' | 'yarn' => (/^\s*(pnpm|npm|yarn)\b/.exec(ci.install ?? '')?.[1] as 'pnpm' | 'npm' | 'yarn' | undefined) ?? 'npm';

/** The command that runs a package.json script with the package manager the CI installs with. */
export const runScript = (manager: 'pnpm' | 'npm' | 'yarn', script: string): string => (manager === 'yarn' ? `yarn ${script}` : `${manager} run ${script}`);

/** The port the app listens on inside its container: the one of the start URL, else 3000. */
export function appPortOf(start: { url?: string } | undefined): number {
  const m = start?.url ? /^https?:\/\/[^/:]+:(\d{2,5})/.exec(start.url) : null;
  return m ? Number(m[1]) : DEFAULT_APP_PORT;
}

/**
 * The line that starts the app. A plain `start` script of package.json usually needs the build first: when
 * the start line is that script and a `build` script exists, the build runs before it. The Playwright
 * `webServer` command of the project is used as written (it is what CI itself starts).
 */
export function startLineOf(ci: CiEnvironment, packageJson: string | null): string | null {
  const start = ci.start?.command;
  if (!start) return null;
  const manager = managerOf(ci);
  const plainStart = start === (manager === 'yarn' ? 'yarn start' : `${manager} start`) || start === `${manager} run start`;
  return plainStart && typeof scriptsOf(packageJson).build === 'string' ? `${runScript(manager, 'build')} && ${start}` : start;
}

export type PreviewRunSpec = {
  name: string;
  worktreeHostPath: string;
  command: string;
  network: string;
  storeVolume: string;
  env: Record<string, string>;
  appPort: number;
  hostPort: number;
  labels: Record<string, string>;
  limits?: { cpus: number; memoryMb: number; pids: number };
};

const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

/** `docker run -d` arguments of the preview container: the builder's hardened profile, the app port published on 127.0.0.1 only. */
export function previewArguments(spec: PreviewRunSpec, environment: Readonly<Record<string, string | undefined>> = process.env): string[] {
  if (!NAME_PATTERN.test(spec.name) || !NAME_PATTERN.test(spec.network) || !NAME_PATTERN.test(spec.storeVolume)) throw new Error('Invalid preview name.');
  if (!spec.worktreeHostPath.startsWith('/') || /[:,\0\n]/.test(spec.worktreeHostPath)) throw new Error('Invalid worktree path.');
  if (!spec.command.trim() || spec.command.includes('\0')) throw new Error('Empty start command.');
  const uid = environment.DEMIURGO_UID?.trim() || '501';
  const gid = environment.DEMIURGO_GID?.trim() || uid;
  if (!/^\d+$/.test(uid) || !/^\d+$/.test(gid)) throw new Error('DEMIURGO_UID and DEMIURGO_GID must be numbers.');
  const image = environment.DEMIURGO_BUILDER_IMAGE?.trim() || 'demiurgo/app:local';
  const home = '/home/demiurgo';
  const { cpus, memoryMb, pids } = spec.limits ?? LIMITS;
  const env: Record<string, string> = {
    ...environmentVariables(spec.env),
    CI: '1',
    HOME: home,
    PORT: String(spec.appPort),
    HOST: '0.0.0.0',
    HOSTNAME: '0.0.0.0',
    PLAYWRIGHT_BROWSERS_PATH: PW_BROWSERS_DIR,
    npm_config_store_dir: PNPM_STORE_DIR,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    LANG: environment.LANG?.trim() || 'C.UTF-8',
    TZ: environment.TZ?.trim() || 'UTC',
  };
  const args = [
    'run', '-d',
    '--name', spec.name,
    '--label', PREVIEW_LABEL,
    ...Object.entries(spec.labels).flatMap(([k, v]) => ['--label', `${k}=${v}`]),
    '--pull', 'never',
    '--read-only',
    '--tmpfs', '/tmp:rw,exec,nosuid,size=2g',
    '--tmpfs', `${home}:rw,exec,nosuid,size=256m,uid=${uid},gid=${gid}`,
    '--cap-drop', 'ALL',
    '--ulimit', 'core=0',
    '--security-opt', 'no-new-privileges',
    '--user', `${uid}:${gid}`,
    '--pids-limit', String(pids),
    '--memory', `${memoryMb}m`,
    '--memory-swap', `${memoryMb}m`,
    '--cpus', String(cpus),
    '--mount', `type=bind,source=${spec.worktreeHostPath},target=/workspace`,
    '--mount', `type=volume,source=${spec.storeVolume},target=${PNPM_STORE_DIR}`,
    '--workdir', '/workspace',
    '--network', spec.network,
    '-p', `127.0.0.1:${spec.hostPort}:${spec.appPort}`,
  ];
  for (const [key, value] of Object.entries(env).sort(([a], [b]) => a.localeCompare(b))) args.push('--env', `${key}=${value}`);
  args.push(image, 'sh', '-c', `set -eu; cd /workspace; exec sh -c ${shellQuote(spec.command)}`);
  return args;
}

/** The preview's database: `p_` plus the last 12 hex characters of the project id. */
export const previewDatabase = (projectId: string): string => `p_${projectId.replace(/[^0-9a-f]/gi, '').toLowerCase().slice(-12).padStart(12, '0')}`;
export const previewContainerName = (projectId: string): string => `demiurgo-preview-${projectId.replace(/[^0-9a-f-]/gi, '').toLowerCase()}`;

const tail = (text: string, max = 1500): string => {
  const t = text.trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
};

/** A short, single-line seed note from what the seed script printed (its last line), or null when it printed nothing usable. */
export function seedNoteOf(output: string): string | null {
  const line = output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('>'))
    .at(-1);
  if (!line) return null;
  return line.length <= SEED_NOTE_MAX ? line : `${line.slice(0, SEED_NOTE_MAX)}…`;
}

// ------------------------------------------------------------------------------------------ state

class PreviewFailure extends Error {
  readonly log: string | undefined;
  constructor(message: string, log?: string) {
    super(message);
    this.log = log;
  }
}

type Progress = { step: string } | { failed: { reason: string; log?: string } };
const progress = new Map<string, Progress>();
const starting = new Set<string>();

async function repoOf(services: Services, projectId: string): Promise<{ repoDir: string; slug: string }> {
  const root = projectsDir();
  const repo = await services.db.selectFrom('project_repos').select('dir').where('project_id', '=', projectId).executeTakeFirst();
  if (!root || !repo) throw new DomainError('not_found', 'The project has no local repository yet.');
  const repoDir = join(root, repo.dir);
  return { repoDir, slug: projectSlug(basename(repoDir)) };
}

async function hasMergedMain(services: Services, projectId: string): Promise<boolean> {
  const row = await services.db.selectFrom('build_requests').select('id').where('project_id', '=', projectId).where('state', '=', 'done').executeTakeFirst();
  return row !== undefined;
}

async function startFilesOf(path: string): Promise<StartFiles> {
  let playwrightConfig: string | null = null;
  for (const name of PLAYWRIGHT_CONFIGS) {
    playwrightConfig = await readWorktreeFile(path, name);
    if (playwrightConfig !== null) break;
  }
  return { playwrightConfig, packageJson: await readWorktreeFile(path, 'package.json') };
}

async function found(projectId: string, exec: DockerExec) {
  const format = ['{{.Names}}', '{{.State}}', '{{.Label "demiurgo.preview-port"}}', '{{.Label "demiurgo.preview-commit"}}', '{{.Label "demiurgo.preview-started"}}', '{{.Label "demiurgo.preview-seed"}}', '{{.Label "demiurgo.preview-accounts"}}'].join('\t');
  const r = await exec(['ps', '-a', '--filter', `label=${PREVIEW_LABEL}`, '--filter', `label=demiurgo.preview-project=${projectId}`, '--format', format], { timeoutMs: 15_000 });
  const line = r.stdout.split('\n').find((l) => l.trim());
  if (!line) return null;
  const [name, state, port, commit, startedAt, seed, accounts] = line.split('\t');
  return { name: name as string, running: state === 'running', port: Number(port), commit: commit ?? '', startedAt: startedAt ?? '', seed: seed || undefined, accounts: accountsOf(accounts) };
}

/** Running, stopped or failed, from the in-memory progress and the labelled container. */
export async function previewStatus(projectId: string, exec: DockerExec = dockerExec): Promise<PreviewStatus> {
  const p = progress.get(projectId);
  if (p && 'step' in p) return { state: 'starting', step: p.step };
  const c = await found(projectId, exec);
  if (c?.running) {
    return { state: 'running', url: `http://127.0.0.1:${c.port}`, port: c.port, started_at: c.startedAt, commit: c.commit, ...(c.seed ? { seed: c.seed } : {}), ...(c.accounts ? { accounts: c.accounts } : {}) };
  }
  if (c) {
    const logs = await exec(['logs', '--tail', '40', c.name], { timeoutMs: 10_000 });
    return { state: 'failed', reason: 'The app stopped.', log: tail(logs.stdout + logs.stderr) };
  }
  if (p && 'failed' in p) return { state: 'failed', ...p.failed };
  return { state: 'stopped' };
}

async function removeContainer(projectId: string, exec: DockerExec): Promise<void> {
  const c = await found(projectId, exec);
  if (c) await exec(['rm', '-f', c.name], { timeoutMs: 30_000 });
}

/** Stops the preview: removes its container and drops its database. Idempotent. */
export async function stopPreview(services: Services, projectId: string, exec: DockerExec = dockerExec): Promise<void> {
  const { slug } = await repoOf(services, projectId);
  await removeContainer(projectId, exec);
  await teardownEnvironment(slug, projectId, exec, previewDatabase(projectId));
  progress.delete(projectId);
}

/** Starts the preview in the background (the person polls `previewStatus`). A second start while one is under way is refused. */
export async function beginPreview(services: Services, projectId: string): Promise<void> {
  if (starting.has(projectId)) throw new DomainError('conflict', 'The app is already starting.');
  await repoOf(services, projectId);
  if (!(await hasMergedMain(services, projectId))) throw new DomainError('conflict', 'Nothing has been merged into main yet: there is no app to open.');
  starting.add(projectId);
  progress.set(projectId, { step: 'Starting' });
  void startPreview(services, projectId)
    .then(() => progress.delete(projectId))
    .catch((e: unknown) => {
      const reason = e instanceof Error ? e.message : String(e);
      progress.set(projectId, { failed: { reason, ...(e instanceof PreviewFailure && e.log ? { log: e.log } : {}) } });
    })
    .finally(() => starting.delete(projectId));
}

/** Checks out `origin/main`, prepares the environment like CI and runs the app. Restarts an existing preview on the newest main. */
export async function startPreview(services: Services, projectId: string, exec: DockerExec = dockerExec): Promise<PreviewInfo> {
  const { repoDir, slug } = await repoOf(services, projectId);
  const root = projectsDir() as string;
  const step = (text: string) => progress.set(projectId, { step: text });
  const database = previewDatabase(projectId);

  step('Checking out main');
  await removeContainer(projectId, exec);
  const origin = await runGit(repoDir, ['remote']).then((x) => x.split('\n').includes('origin'), () => false);
  if (origin) await runGit(repoDir, ['fetch', 'origin', 'main'], { network: true });
  const base = origin ? 'origin/main' : 'main';
  const path = join(root, '.previews', projectId);
  await mkdir(join(root, '.previews'), { recursive: true });
  if (existsSync(path)) {
    await runGit(path, ['checkout', '--force', '--detach', base]);
    await runGit(path, ['clean', '-fd', '--exclude=node_modules']);
  } else {
    await runGit(repoDir, ['worktree', 'prune']);
    await runGit(repoDir, ['worktree', 'add', '--detach', path, base]);
  }
  const commit = (await runGit(path, ['rev-parse', 'HEAD'])).trim();

  const ciText = await readWorktreeFile(path, '.github/workflows/ci.yml');
  const files = await startFilesOf(path);
  const ci = ciText === null ? null : environmentFromCi(ciText, files);
  if (!ci) throw new PreviewFailure(ciText === null ? 'The project has no CI workflow: DEMIURGO does not know how to prepare its environment.' : 'The CI workflow has no `ci` job DEMIURGO understands.');
  const command = startLineOf(ci, files.packageJson ?? null);
  if (!command) throw new PreviewFailure('The project does not say how to start the app (no Playwright webServer, no start or dev script).');

  step('Preparing the database and installing dependencies');
  const prepared = await prepareEnvironment({ slug, id: projectId, database, ci, worktreeHostPath: hostPathOf(path), keepDatabases: [] });
  if (!prepared.ok) throw new PreviewFailure(`${prepared.reason} (step: ${prepared.failedStep})`);

  let seed: string | undefined;
  let accounts: PreviewAccount[] = [];
  const seedScript = seedScriptOf(files.packageJson);
  if (seedScript) {
    step('Seeding the database');
    const seedCommand = runScript(managerOf(ci), seedScript);
    // The files the seed command names, to learn which SEED_* variables it reads and give them throwaway values.
    const scriptLine = String(scriptsOf(files.packageJson)[seedScript] ?? '');
    const sources: string[] = [];
    for (const f of scriptLine.match(/[\w./-]+\.(?:ts|mts|js|mjs|cjs)\b/g) ?? []) {
      const src = await readWorktreeFile(path, f.replace(/^\.\//, ''));
      if (src) sources.push(src);
    }
    const values = seedValuesFor(seedVariablesOf(scriptLine, sources));
    accounts = values.accounts;
    const args = setupArguments({ worktreeHostPath: hostPathOf(path), command: seedCommand, network: prepared.network, storeVolume: prepared.storeVolume, env: { ...prepared.env, ...values.env }, limits: LIMITS }, `demiurgo-setup-preview-${projectId}-seed`);
    const r = await exec(args, { timeoutMs: 300_000 });
    if (r.code !== 0) {
      await teardownEnvironment(slug, projectId, exec, database);
      throw new PreviewFailure(`The seed script failed (${seedCommand}).`, tail(r.stderr || r.stdout));
    }
    seed = seedNoteOf(r.stdout) ?? undefined;
  }

  step('Starting the app');
  const appPort = appPortOf(ci.start);
  const used = new Set(publishedPorts((await exec(['ps', '--format', '{{.Ports}}'], { timeoutMs: 15_000 })).stdout));
  const startedAt = new Date().toISOString();
  const name = previewContainerName(projectId);
  let hostPort: number | null = null;
  for (let tries = 0; tries < 20; tries++) {
    hostPort = pickPort(used);
    if (hostPort === null) break;
    await exec(['rm', '-f', name], { timeoutMs: 30_000 });
    const run = await exec(
      previewArguments({
        name,
        worktreeHostPath: hostPathOf(path),
        command,
        network: prepared.network,
        storeVolume: prepared.storeVolume,
        env: prepared.env,
        appPort,
        hostPort,
        labels: {
          'demiurgo.preview-project': projectId,
          'demiurgo.preview-port': String(hostPort),
          'demiurgo.preview-commit': commit,
          'demiurgo.preview-started': startedAt,
          ...(seed ? { 'demiurgo.preview-seed': seed.replace(/[\n\r\0]/g, ' ') } : {}),
          ...(accounts.length > 0 ? { 'demiurgo.preview-accounts': accountsLabel(accounts) } : {}),
        },
      }),
      { timeoutMs: 60_000 },
    );
    if (run.code === 0) break;
    if (!/port is already allocated|address already in use|ports are not available/i.test(run.stderr)) {
      await teardownEnvironment(slug, projectId, exec, database);
      throw new PreviewFailure('Could not start the app container.', tail(run.stderr));
    }
    used.add(hostPort);
    hostPort = null;
  }
  if (hostPort === null) {
    await teardownEnvironment(slug, projectId, exec, database);
    throw new PreviewFailure(`No free port between ${PREVIEW_PORTS.first} and ${PREVIEW_PORTS.last}.`);
  }

  // A crash at start (a missing variable, a port in use) shows within seconds.
  await new Promise((r) => setTimeout(r, 4000));
  const state = await found(projectId, exec);
  if (!state?.running) {
    const logs = await exec(['logs', '--tail', '40', name], { timeoutMs: 10_000 });
    await removeContainer(projectId, exec);
    await teardownEnvironment(slug, projectId, exec, database);
    throw new PreviewFailure('The app stopped right after starting.', tail(logs.stdout + logs.stderr));
  }
  return { url: `http://127.0.0.1:${hostPort}`, port: hostPort, started_at: startedAt, commit, ...(seed ? { seed } : {}), ...(accounts.length > 0 ? { accounts } : {}) };
}
