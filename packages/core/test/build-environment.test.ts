import { describe, expect, it } from 'vitest';
import { environmentFromCi, rewriteForNetwork } from '../src/build/environment.ts';
import { type DockerExec, databaseName, prepareEnvironment, projectSlug, removeProjectEnvironment, serviceArguments, sweepDatabases, teardownEnvironment } from '../src/runner/environment.ts';

const CI = `
name: CI
on: [push]
jobs:
  ci:
    name: ci
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_DB: comidas_test
          POSTGRES_HOST_AUTH_METHOD: trust
        ports:
          - 5432:5432
    env:
      DATABASE_URL: postgres://postgres@localhost:5432/comidas_test
      APP_TIME_ZONE: UTC
      NEXT_TELEMETRY_DISABLED: "1"
      TOKEN: \${{ secrets.TOKEN }}
    steps:
      - uses: actions/checkout@v5
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Typecheck
        run: pnpm typecheck
      - name: Migrate
        id: migrate
        run: pnpm db:migrate
      - name: Install browser
        run: pnpm exec playwright install --with-deps --only-shell chromium
      - name: Tests
        run: pnpm test:unit
`;

describe('environmentFromCi', () => {
  it('reads services, variables and the install, migrate and browsers commands of the ci job', () => {
    const env = environmentFromCi(CI);
    expect(env).toEqual({
      services: [{ name: 'postgres', image: 'postgres:17', env: { POSTGRES_DB: 'comidas_test', POSTGRES_HOST_AUTH_METHOD: 'trust' }, port: 5432, hostPort: 5432 }],
      env: { DATABASE_URL: 'postgres://postgres@localhost:5432/comidas_test', APP_TIME_ZONE: 'UTC', NEXT_TELEMETRY_DISABLED: '1' },
      install: 'pnpm install --frozen-lockfile',
      migrate: 'pnpm db:migrate',
      browsers: 'pnpm exec playwright install --only-shell chromium',
    });
  });

  it('keeps only the browser install line of a step that branches on a GitHub cache hit', () => {
    const yaml = "jobs:\n  ci:\n    steps:\n      - name: Browser\n        env:\n          BROWSER_CACHED: x\n        run: |\n          if [ \"$BROWSER_CACHED\" = \"true\" ]; then\n            pnpm exec playwright install-deps chromium\n          else\n            pnpm exec playwright install --with-deps --only-shell chromium\n          fi\n";
    expect(environmentFromCi(yaml)?.browsers).toBe('pnpm exec playwright install --only-shell chromium');
  });

  it('finds the job by its name and accepts a workflow with no services', () => {
    const env = environmentFromCi('jobs:\n  build:\n    name: ci\n    steps:\n      - run: npm ci\n');
    expect(env).toEqual({ services: [], env: {}, install: 'npm ci' });
  });

  it('gives null for anything it does not understand', () => {
    expect(environmentFromCi('not: [valid')).toBeNull();
    expect(environmentFromCi('hello')).toBeNull();
    expect(environmentFromCi('jobs:\n  lint:\n    steps: []\n')).toBeNull();
    expect(environmentFromCi('jobs:\n  ci:\n    services:\n      db:\n        image: "x; rm -rf /"\n')).toBeNull();
  });

  it('points the variables at the service inside the build network', () => {
    const [service] = environmentFromCi(CI)?.services ?? [];
    expect(rewriteForNetwork({ DATABASE_URL: 'postgres://postgres@localhost:5432/db', OTHER: 'http://localhost:3000', HOST: '127.0.0.1:5432' }, [service!])).toEqual({
      DATABASE_URL: 'postgres://postgres@postgres:5432/db',
      OTHER: 'http://localhost:3000',
      HOST: 'postgres:5432',
    });
  });

  it('gives the build its own database in the URLs that point at Postgres', () => {
    const [service] = environmentFromCi(CI)?.services ?? [];
    expect(rewriteForNetwork({ DATABASE_URL: 'postgres://postgres@localhost:5432/comidas_test?sslmode=disable', OTHER: 'http://localhost:3000/x' }, [service!], 'b_0123456789ab')).toEqual({
      DATABASE_URL: 'postgres://postgres@postgres:5432/b_0123456789ab?sslmode=disable',
      OTHER: 'http://localhost:3000/x',
    });
  });
});

type Call = { args: string[] };
type Reply = Partial<{ code: number; stdout: string; stderr: string; timedOut: boolean }>;
/** A docker whose project environment already exists (network, store, postgres:17 running); `handle` overrides replies. */
function fakeDocker(handle: (args: string[]) => Reply | undefined = () => undefined) {
  const calls: Call[] = [];
  const exec: DockerExec = async (args) => {
    calls.push({ args });
    const custom = handle(args);
    if (custom) return { code: 0, stdout: '', stderr: '', timedOut: false, ...custom };
    const reply: Reply = args[0] === 'inspect' && args[1] === '-f' && args[2]?.includes('Config.Image') ? { stdout: 'true postgres:17\n' } : {};
    return { code: 0, stdout: '', stderr: '', timedOut: false, ...reply };
  };
  return { calls, exec, has: (...part: string[]) => calls.some((c) => part.every((p) => c.args.includes(p))), count: (...part: string[]) => calls.filter((c) => part.every((p) => c.args.includes(p))).length };
}

const ci = environmentFromCi(CI)!;
const input = { slug: 'comidas-ea877aa1', id: '0190a1b2-c3d4-7e5f-8a6b-0123456789ab', ci, worktreeHostPath: '/Users/x/wt' };
const options = (exec: DockerExec) => ({ exec, environment: {}, readyTimeoutMs: 50 });
const DB = 'b_0123456789ab';

describe('prepareEnvironment', () => {
  it('names the build database after the last 12 characters of the request id', () => {
    expect(databaseName(input.id)).toBe(DB);
    expect(projectSlug('Comidas y Entrenos-EA877AA1')).toBe('comidas-y-entrenos-ea877aa1');
  });

  it('reuses the running project server, creates the build database and runs install, browsers and migrate against it', async () => {
    const docker = fakeDocker();
    const result = await prepareEnvironment(input, options(docker.exec));
    expect(result).toMatchObject({
      ok: true,
      network: 'demiurgo-env-comidas-ea877aa1',
      storeVolume: 'demiurgo-env-comidas-ea877aa1-pnpm-store',
      env: { DATABASE_URL: `postgres://postgres@postgres:5432/${DB}` },
      databases: [DB],
      services: [{ name: 'postgres', container: 'demiurgo-env-comidas-ea877aa1-postgres', action: 'running' }],
    });
    expect(docker.calls.some((c) => c.args[0] === 'run' && c.args.includes('-d'))).toBe(false);
    expect(docker.has('network', 'create')).toBe(false);
    expect(docker.has('exec', 'demiurgo-env-comidas-ea877aa1-postgres', 'pg_isready')).toBe(true);
    expect(docker.calls.some((c) => c.args.at(-1) === `CREATE DATABASE ${DB}`)).toBe(true);
    const setups = docker.calls.map((c) => c.args).filter((a) => a[0] === 'run');
    expect(setups.map((a) => a.at(-1))).toEqual(['set -eu; cd /workspace; pnpm install --frozen-lockfile --prefer-offline', 'set -eu; cd /workspace; pnpm exec playwright install --only-shell chromium', 'set -eu; cd /workspace; pnpm db:migrate']);
    for (const a of setups) {
      expect(a.join(' ')).toContain('--network demiurgo-env-comidas-ea877aa1');
      expect(a).toContain('type=volume,source=demiurgo-env-comidas-ea877aa1-pnpm-store,target=/pnpm-store');
      expect(a).toContain('--read-only');
      expect(a).toContain(`DATABASE_URL=postgres://postgres@postgres:5432/${DB}`);
    }
  });

  it('creates the network, the store, the server and the database when none exist, and starts a stopped server', async () => {
    const fresh = fakeDocker((a) => (['network', 'volume'].includes(a[0]!) && a[1] === 'inspect') || (a[0] === 'inspect' && a[1] === '-f' && a[2]?.includes('Config.Image')) ? { code: 1 } : undefined);
    expect(await prepareEnvironment(input, options(fresh.exec))).toMatchObject({ ok: true, services: [{ action: 'created' }] });
    expect(fresh.has('network', 'create', 'demiurgo-env-comidas-ea877aa1')).toBe(true);
    expect(fresh.has('volume', 'create')).toBe(true);
    const run = fresh.calls.map((c) => c.args).find((a) => a[0] === 'run' && a.includes('-d'))!;
    expect(run.join(' ')).toContain('--restart unless-stopped --name demiurgo-env-comidas-ea877aa1-postgres');
    expect(run).toContain('postgres:17');
    expect(run).not.toContain('--publish');
    expect(run).not.toContain('-p');
    expect(run).not.toContain('--rm');

    const stopped = fakeDocker((a) => (a[0] === 'inspect' && a[2]?.includes('Config.Image') ? { stdout: 'false postgres:17' } : undefined));
    expect(await prepareEnvironment(input, options(stopped.exec))).toMatchObject({ ok: true, services: [{ action: 'started' }] });
    expect(stopped.has('start', 'demiurgo-env-comidas-ea877aa1-postgres')).toBe(true);
  });

  it('recreates the server when the CI image or version changed', async () => {
    const docker = fakeDocker((a) => (a[0] === 'inspect' && a[2]?.includes('Config.Image') ? { stdout: 'true postgres:16' } : undefined));
    expect(await prepareEnvironment(input, options(docker.exec))).toMatchObject({ ok: true, services: [{ action: 'recreated' }] });
    expect(docker.has('rm', '-f', '-v', 'demiurgo-env-comidas-ea877aa1-postgres')).toBe(true);
    expect(docker.calls.some((c) => c.args[0] === 'run' && c.args.includes('postgres:17') && c.args.includes('-d'))).toBe(true);
  });

  it('fails with the reason when the database does not become ready, and drops the build database', async () => {
    const docker = fakeDocker((a) => (a.includes('pg_isready') ? { code: 2 } : a[0] === 'logs' ? { stdout: 'FATAL: boom' } : undefined));
    const result = await prepareEnvironment(input, options(docker.exec));
    expect(result).toMatchObject({ ok: false, failedStep: 'ready postgres' });
    expect((result as { reason: string }).reason).toMatch(/^Postgres did not become ready in \d+ s: FATAL: boom/);
    expect(docker.calls.some((c) => c.args[0] === 'run')).toBe(false);
  });

  it('fails with the install output, drops the build database and never runs the later commands', async () => {
    const docker = fakeDocker((a) => (a[0] === 'run' ? { code: 1, stderr: 'ERR_PNPM_OUTDATED_LOCKFILE' } : a[0] === 'ps' ? { stdout: 'demiurgo-env-comidas-ea877aa1-postgres postgres\n' } : undefined));
    const result = await prepareEnvironment(input, options(docker.exec));
    expect(result).toMatchObject({ ok: false, failedStep: 'install' });
    expect((result as { reason: string }).reason).toBe('Installing dependencies failed (pnpm install --frozen-lockfile --prefer-offline): ERR_PNPM_OUTDATED_LOCKFILE');
    expect(docker.calls.filter((c) => c.args[0] === 'run')).toHaveLength(1);
    expect(docker.calls.at(-1)!.args.at(-1)).toBe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  });

  it('teardown drops only the build database, keeping the project containers, network and store', async () => {
    const docker = fakeDocker((a) => (a[0] === 'ps' ? { stdout: 'demiurgo-env-comidas-ea877aa1-postgres postgres\n' } : undefined));
    await teardownEnvironment('comidas-ea877aa1', input.id, docker.exec);
    expect(docker.calls.map((c) => c.args[0])).toEqual(['ps', 'exec']);
    expect(docker.calls[1]!.args).toEqual(['exec', 'demiurgo-env-comidas-ea877aa1-postgres', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]);
  });

  it('the sweep drops the b_ databases of builds that are not open, and nothing else', async () => {
    const docker = fakeDocker((a) =>
      a[0] === 'ps' ? { stdout: 'demiurgo-env-comidas-ea877aa1-postgres postgres\n' } : a.at(-1)?.startsWith('select datname') ? { stdout: 'b_aaaaaaaaaaaa\nb_bbbbbbbbbbbb\nb_notahexname\n' } : undefined,
    );
    expect(await sweepDatabases('comidas-ea877aa1', ['b_aaaaaaaaaaaa'], docker.exec)).toEqual(['b_bbbbbbbbbbbb']);
  });

  it('removing a project environment removes its services, network and store', async () => {
    const docker = fakeDocker((a) => (a[0] === 'ps' ? { stdout: 'abcdef123456\n' } : undefined));
    await removeProjectEnvironment('comidas-ea877aa1', docker.exec);
    expect(docker.calls.map((c) => c.args.slice(0, 2).join(' '))).toEqual(['ps -aq', 'rm -f', 'network rm', 'volume rm']);
  });

  it('rejects names that could escape the docker arguments', () => {
    expect(() => serviceArguments('comidas', { name: 'db', image: 'postgres:17', env: { 'A B': '1' } })).toThrow();
    expect(() => serviceArguments('../x', { name: 'db', image: 'postgres:17', env: {} })).toThrow();
  });
});
