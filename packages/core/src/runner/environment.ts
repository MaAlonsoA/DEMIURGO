// Prepares the environment of a build like the project's CI does, before the builder starts.
//
// Per project and long-lived: a docker network `demiurgo-env-<slug>`, one container per CI service
// (`--restart unless-stopped`, the CI's image and version, no host ports; created, started or recreated
// as needed) and a pnpm store volume, so each install only links cached packages.
//
// Per build and short-lived: an isolated database inside that server (`CREATE DATABASE b_<id>`: Isolated
// Test, Gerard Meszaros, xUnit Test Patterns; builds on different branches carry different migrations and
// test data), the install, migrate and browsers commands run in short-lived containers with the builder's
// hardened profile, and DATABASE_URL pointing at that database. The builder then joins the project
// network with the same variables. `teardownEnvironment` drops the build's database when the attempt ends.
// Like the rest of the runner it goes through the docker CLI with `spawn` and no shell.

import { spawn } from 'node:child_process';
import { type CiEnvironment, rewriteForNetwork } from '../build/environment.ts';
import { setupArguments } from './builder.ts';
import { NAME_PATTERN, collector, dockerEnv, pause } from './runner.ts';

const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;

export const ENVIRONMENT_LABEL = 'demiurgo.build-env=1';
export const ENVIRONMENT_KIND_LABEL = 'demiurgo.env-kind';
export const ENVIRONMENT_USER_LABEL = 'demiurgo.env-user';
/** The project's network, services and store carry its slug (the repository directory name, lowercased). */
export const projectSlug = (dirName: string): string => dirName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
export const projectNetworkName = (slug: string): string => `demiurgo-env-${slug}`;
export const serviceContainerName = (slug: string, service: string): string => `demiurgo-env-${slug}-${service}`;
export const pnpmStoreVolumeName = (slug: string): string => `demiurgo-env-${slug}-pnpm-store`;
/** Name of a build's database: `b_` plus the last 12 characters of the request id (the random part of a uuid). */
export const databaseName = (id: string): string => `b_${id.replace(/[^0-9a-f]/gi, '').toLowerCase().slice(-12).padStart(12, '0')}`;
const DATABASE_NAME = /^b_[0-9a-f]{12}$/;
/** A database a caller names itself (the preview's `p_…`): the build sweep leaves it alone. */
const OWN_DATABASE_NAME = /^[bp]_[0-9a-f]{12}$/;
const checkSlug = (slug: string): void => {
  if (!SLUG.test(slug)) throw new Error(`Invalid project slug: ${JSON.stringify(slug)}.`);
};

export type DockerResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };
export type DockerExec = (args: string[], options: { timeoutMs: number; signal?: AbortSignal }) => Promise<DockerResult>;

/** The docker CLI with no shell and a maximum time. */
export const dockerExec: DockerExec = (args, { timeoutMs, signal }) =>
  new Promise((resolve) => {
    const out = collector(256 * 1024);
    const err = collector(256 * 1024);
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('docker', args, { shell: false, env: dockerEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: e instanceof Error ? e.message : String(e), timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (t: Buffer) => out.add(t));
    child.stderr?.on('data', (t: Buffer) => err.add(t));
    const done = (code: number | null, extra = '') => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout: out.text(), stderr: err.text() + extra, timedOut });
    };
    child.once('error', (e) => done(null, e.message));
    child.once('close', (code) => done(code));
  });

export type EnvironmentLimits = { cpus: number; memoryMb: number; pids: number };

export type PrepareInput = {
  /** The project's slug (see `projectSlug`). */
  slug: string;
  /** The build request id: names the build's database and the setup containers. */
  id: string;
  ci: CiEnvironment;
  worktreeHostPath: string;
  /** A database name of the caller's own (`p_` + 12 hex), instead of the build's `b_…`: the sweep of build databases keeps it. */
  database?: string;
  /** Databases (`databaseName`) of the project's builds still open: the sweep keeps them and drops any other `b_*`. */
  keepDatabases?: string[];
  limits?: EnvironmentLimits;
  signal?: AbortSignal;
};

export type PrepareOptions = {
  exec?: DockerExec;
  environment?: Readonly<Record<string, string | undefined>>;
  readyTimeoutMs?: number;
  installTimeoutMs?: number;
  migrateTimeoutMs?: number;
  pullTimeoutMs?: number;
};

export type PreparedEnvironment = {
  /** The project's network: the builder joins it. */
  network: string;
  /** The pnpm store volume of the project: the builder mounts it. */
  storeVolume: string;
  /** The CI's variables with the services' addresses and the build's database. */
  env: Record<string, string>;
  services: { name: string; image: string; container: string; action: 'created' | 'started' | 'recreated' | 'running' }[];
  databases: string[];
  steps: { step: string; ms: number }[];
};

export type PrepareResult = ({ ok: true } & PreparedEnvironment) | { ok: false; reason: string; failedStep: string };

const SERVICE_LIMITS = { cpus: 1, memoryMb: 1024, pids: 512 };
const DEFAULT_LIMITS: EnvironmentLimits = { cpus: 2, memoryMb: 4096, pids: 512 };
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const PG_USER = /^[A-Za-z0-9_.-]{1,63}$/;
export const isPostgres = (image: string): boolean => /(^|\/)postgres(:|@|$)/.test(image);
const postgresUser = (env: Record<string, string>): string => (env.POSTGRES_USER && PG_USER.test(env.POSTGRES_USER) ? env.POSTGRES_USER : 'postgres');

const tail = (text: string, max = 600): string => {
  const t = text.trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
};

/** `docker run -d` arguments of a project service: restarts unless stopped, no host ports, resource limits, only the capabilities official database images start with. */
export function serviceArguments(slug: string, service: { name: string; image: string; env: Record<string, string> }): string[] {
  checkSlug(slug);
  const name = serviceContainerName(slug, service.name);
  if (!NAME_PATTERN.test(name)) throw new Error('Invalid service name.');
  const args = [
    'run', '-d',
    '--restart', 'unless-stopped',
    '--name', name,
    '--label', ENVIRONMENT_LABEL,
    ...(isPostgres(service.image) ? ['--label', `${ENVIRONMENT_KIND_LABEL}=postgres`, '--label', `${ENVIRONMENT_USER_LABEL}=${postgresUser(service.env)}`] : []),
    '--network', projectNetworkName(slug),
    '--network-alias', service.name,
    '--cap-drop', 'ALL',
    ...['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID'].flatMap((c) => ['--cap-add', c]),
    '--security-opt', 'no-new-privileges',
    '--pids-limit', String(SERVICE_LIMITS.pids),
    '--memory', `${SERVICE_LIMITS.memoryMb}m`,
    '--memory-swap', `${SERVICE_LIMITS.memoryMb}m`,
    '--cpus', String(SERVICE_LIMITS.cpus),
  ];
  for (const [key, value] of Object.entries(service.env).sort(([a], [b]) => a.localeCompare(b))) {
    if (!ENV_NAME.test(key) || /[\0\n\r]/.test(value)) throw new Error(`Invalid variable ${JSON.stringify(key)} for service ${service.name}.`);
    args.push('--env', `${key}=${value}`);
  }
  args.push(service.image);
  return args;
}

const psql = (container: string, user: string, sql: string): string[] => ['exec', container, 'psql', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql];

/** The project's running Postgres servers: container and user. */
async function postgresServers(slug: string, exec: DockerExec): Promise<{ container: string; user: string }[]> {
  const listed = await exec(
    ['ps', '--filter', `label=${ENVIRONMENT_KIND_LABEL}=postgres`, '--filter', `name=^demiurgo-env-${slug}-`, '--format', '{{.Names}} {{.Label "' + ENVIRONMENT_USER_LABEL + '"}}'],
    { timeoutMs: 15_000 },
  );
  return listed.stdout
    .split('\n')
    .map((line) => line.trim().split(' '))
    .filter(([name, user]) => name && user && NAME_PATTERN.test(name) && PG_USER.test(user))
    .map(([container, user]) => ({ container: container!, user: user! }));
}

/** Drops the build's database (idempotent, best effort). The project's containers, network and store stay. */
export async function teardownEnvironment(slug: string, id: string, exec: DockerExec = dockerExec, ownDatabase?: string): Promise<void> {
  checkSlug(slug);
  const database = ownDatabase ?? databaseName(id);
  if (!OWN_DATABASE_NAME.test(database)) throw new Error('Invalid database name.');
  for (const { container, user } of await postgresServers(slug, exec)) {
    await exec(psql(container, user, `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`), { timeoutMs: 30_000 });
  }
}

/** Drops the `b_*` databases of builds that are not open any more (leftovers of a restart). */
export async function sweepDatabases(slug: string, keep: string[], exec: DockerExec = dockerExec): Promise<string[]> {
  checkSlug(slug);
  const dropped: string[] = [];
  for (const { container, user } of await postgresServers(slug, exec)) {
    const listed = await exec(psql(container, user, "select datname from pg_database where datname like 'b\\_%'"), { timeoutMs: 15_000 });
    for (const name of listed.stdout.split('\n').map((x) => x.trim())) {
      if (!DATABASE_NAME.test(name) || keep.includes(name)) continue;
      const r = await exec(psql(container, user, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`), { timeoutMs: 30_000 });
      if (r.code === 0) dropped.push(name);
    }
  }
  return dropped;
}

/** Removes everything of a project's environment: services, network and pnpm store. For when a project goes away. */
export async function removeProjectEnvironment(slug: string, exec: DockerExec = dockerExec): Promise<void> {
  checkSlug(slug);
  const listed = await exec(['ps', '-aq', '--filter', `label=${ENVIRONMENT_LABEL}`, '--filter', `name=^demiurgo-env-${slug}-`], { timeoutMs: 15_000 });
  const ids = listed.stdout.split(/\s+/).filter((x) => /^[0-9a-f]{12,64}$/.test(x));
  if (ids.length > 0) await exec(['rm', '-f', '-v', ...ids], { timeoutMs: 30_000 });
  await exec(['network', 'rm', projectNetworkName(slug)], { timeoutMs: 15_000 });
  await exec(['volume', 'rm', pnpmStoreVolumeName(slug)], { timeoutMs: 15_000 });
}

/** `pnpm install` reads from the store first: only what is missing goes to the network. */
const preferOffline = (command: string): string =>
  /^pnpm\s+install\b/.test(command) && !command.includes('\n') && !command.includes('--prefer-offline') ? `${command} --prefer-offline` : command;

/**
 * Makes sure the project's network, services and store exist and are ready, creates the build's database
 * and runs install, browsers and migrate against it. On failure the build's database is dropped and the
 * reason says what failed.
 */
export async function prepareEnvironment(input: PrepareInput, options: PrepareOptions = {}): Promise<PrepareResult> {
  const exec = options.exec ?? dockerExec;
  const { slug, id, ci } = input;
  checkSlug(slug);
  const network = projectNetworkName(slug);
  const storeVolume = pnpmStoreVolumeName(slug);
  if (!NAME_PATTERN.test(network) || !NAME_PATTERN.test(storeVolume)) throw new Error(`Invalid project slug: ${JSON.stringify(slug)}.`);
  const readyMs = options.readyTimeoutMs ?? 60_000;
  const database = input.database ?? databaseName(id);
  if (!OWN_DATABASE_NAME.test(database)) throw new Error('Invalid database name.');
  const steps: { step: string; ms: number }[] = [];
  const started: PreparedEnvironment['services'] = [];
  const databases: string[] = [];
  const fail = async (failedStep: string, reason: string): Promise<PrepareResult> => {
    await teardownEnvironment(slug, id, exec, database);
    return { ok: false, reason, failedStep };
  };
  const timed = async <T>(step: string, work: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try {
      return await work();
    } finally {
      steps.push({ step, ms: Date.now() - t0 });
    }
  };
  const cancelled = () => input.signal?.aborted === true;
  if (cancelled()) return { ok: false, reason: 'The build was cancelled.', failedStep: 'network' };

  // The project's network.
  if ((await exec(['network', 'inspect', network], { timeoutMs: 15_000 })).code !== 0) {
    const created = await exec(['network', 'create', '--label', ENVIRONMENT_LABEL, network], { timeoutMs: 30_000, signal: input.signal });
    // A parallel build may have created it between the two calls.
    if (created.code !== 0 && (await exec(['network', 'inspect', network], { timeoutMs: 15_000 })).code !== 0) {
      return fail('network', `Could not create the project network: ${tail(created.stderr)}`);
    }
  }

  // The pnpm store: created once, owned by the builder's user.
  if ((await exec(['volume', 'inspect', storeVolume], { timeoutMs: 15_000 })).code !== 0) {
    const env = options.environment ?? process.env;
    const uid = env.DEMIURGO_UID?.trim() || '501';
    const gid = env.DEMIURGO_GID?.trim() || uid;
    const image = env.DEMIURGO_BUILDER_IMAGE?.trim() || 'demiurgo/app:local';
    if (!/^\d+$/.test(uid) || !/^\d+$/.test(gid)) throw new Error('DEMIURGO_UID and DEMIURGO_GID must be numbers.');
    const made = await exec(['volume', 'create', '--label', ENVIRONMENT_LABEL, storeVolume], { timeoutMs: 15_000 });
    const owned = made.code === 0
      ? await exec(['run', '--rm', '--pull', 'never', '--user', '0', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--mount', `type=volume,source=${storeVolume},target=/store`, image, 'chown', `${uid}:${gid}`, '/store'], { timeoutMs: 60_000 })
      : made;
    if (owned.code !== 0) return fail('store', `Could not prepare the pnpm store: ${tail(owned.stderr)}`);
  }

  // The project's services: ensure each exists with the CI's image, and is running.
  for (const service of ci.services) {
    const container = serviceContainerName(slug, service.name);
    let action: PreparedEnvironment['services'][number]['action'] = 'running';
    const state = await timed(`service ${service.name}`, async () => {
      const inspect = () => exec(['inspect', '-f', '{{.State.Running}} {{.Config.Image}}', container], { timeoutMs: 15_000 });
      let found = await inspect();
      if (found.code === 0 && found.stdout.trim().split(' ')[1] !== service.image) {
        await exec(['rm', '-f', '-v', container], { timeoutMs: 60_000 });
        found = { code: 1, stdout: '', stderr: '', timedOut: false };
        action = 'recreated';
      }
      if (found.code !== 0) {
        const run = await exec(serviceArguments(slug, service), { timeoutMs: options.pullTimeoutMs ?? 300_000, signal: input.signal });
        if (run.code !== 0) {
          // A parallel build may have created it first.
          if ((await inspect()).code === 0) return null;
          return `Could not start ${service.name} (${service.image}): ${tail(run.stderr)}`;
        }
        if (action !== 'recreated') action = 'created';
      } else if (found.stdout.trim().startsWith('false')) {
        const start = await exec(['start', container], { timeoutMs: 60_000 });
        if (start.code !== 0) return `Could not start ${service.name}: ${tail(start.stderr)}`;
        action = 'started';
      }
      return null;
    });
    if (state) return fail(`service ${service.name}`, state);
    started.push({ name: service.name, image: service.image, container, action });
  }

  // Ready.
  for (const service of ci.services) {
    const container = serviceContainerName(slug, service.name);
    const probe = isPostgres(service.image)
      ? ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', postgresUser(service.env)]
      : ['inspect', '-f', '{{.State.Running}}', container];
    const ready = await timed(`ready ${service.name}`, async () => {
      const deadline = Date.now() + readyMs;
      for (;;) {
        if (cancelled()) return 'cancelled';
        const r = await exec(probe, { timeoutMs: 10_000, signal: input.signal });
        if (r.code === 0 && (isPostgres(service.image) || r.stdout.trim() === 'true')) return 'ready';
        if (!isPostgres(service.image) && r.stdout.trim() === 'false') return 'exited';
        if (Date.now() >= deadline) return 'timeout';
        await pause(1000);
      }
    });
    if (ready === 'cancelled') return fail(`ready ${service.name}`, 'The build was cancelled.');
    if (ready !== 'ready') {
      const logs = await exec(['logs', '--tail', '20', container], { timeoutMs: 10_000 });
      const why = ready === 'exited' ? `${service.name} stopped` : `${service.name === 'postgres' ? 'Postgres' : service.name} did not become ready in ${Math.round(readyMs / 1000)} s`;
      return fail(`ready ${service.name}`, `${why}: ${tail(logs.stdout + logs.stderr, 400)}`);
    }
  }

  // The build's own database in each Postgres server, after sweeping what closed builds left behind.
  for (const service of ci.services.filter((x) => isPostgres(x.image))) {
    const container = serviceContainerName(slug, service.name);
    const user = postgresUser(service.env);
    await sweepDatabases(slug, [...(input.keepDatabases ?? []), database], exec);
    await exec(psql(container, user, `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`), { timeoutMs: 30_000 });
    const made = await timed(`database ${service.name}`, () => exec(psql(container, user, `CREATE DATABASE ${database}`), { timeoutMs: 30_000 }));
    if (made.code !== 0) return fail(`database ${service.name}`, `Could not create the database ${database} in ${service.name}: ${tail(made.stderr)}`);
    databases.push(database);
  }

  const env = rewriteForNetwork(ci.env, ci.services, database);
  const commands: [string, string | undefined, string, number][] = [
    ['install', ci.install ? preferOffline(ci.install) : undefined, 'Installing dependencies', options.installTimeoutMs ?? 900_000],
    ['browsers', ci.browsers, 'Installing browsers', options.installTimeoutMs ?? 900_000],
    ['migrate', ci.migrate, 'Applying migrations', options.migrateTimeoutMs ?? 300_000],
  ];
  for (const [step, command, label, timeoutMs] of commands) {
    if (!command) continue;
    const name = `demiurgo-setup-${id}-${step}`;
    const args = setupArguments({ worktreeHostPath: input.worktreeHostPath, command, network, storeVolume, env, limits: input.limits ?? DEFAULT_LIMITS }, name, options.environment);
    const ran = await timed(step, async () => {
      const r = await exec(args, { timeoutMs, signal: input.signal });
      if (r.timedOut || cancelled()) await exec(['rm', '-f', name], { timeoutMs: 15_000 });
      return r;
    });
    if (cancelled()) return fail(step, 'The build was cancelled.');
    if (ran.timedOut) return fail(step, `${label} failed: it did not finish in ${Math.round(timeoutMs / 60_000)} min.`);
    if (ran.code !== 0) return fail(step, `${label} failed (${command.split('\n')[0]}): ${tail(ran.stderr || ran.stdout)}`);
  }

  return { ok: true, network, storeVolume, env, services: started, databases, steps };
}
