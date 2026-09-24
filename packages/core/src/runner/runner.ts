// Isolated runner broker (job profile with no data, credentials, root or network).
//
// This is the ONLY module in DEMIURGO that invokes the docker CLI. It receives a closed
// JobSpec (jobspec.ts), sets all the security flags itself and launches the container
// with `spawn` and no shell. Nothing else should call docker: any isolated run goes
// through `runJob`.
//
// Container guarantees (docs/investigacion-stack-2026-09-24.md §6, invariant I9):
// no network (`--network none`), read-only rootfs, /tmp on a noexec tmpfs, no
// capabilities, `no-new-privileges`, user 1000:1000, CPU/memory/PID limits, no mounts
// or volumes, and no environment variables outside the allowed list. The docker process
// inherits only the minimal environment needed for the CLI to work.
//
// Known MVP limitation: with Docker Desktop all containers share the Linux VM, so T0
// and T1 share a kernel. This is documented in the runner's ADR.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { FailureKind } from '@demiurgo/domain';
import { type JobSpec, type JobSpecInput, validateJobSpec } from './jobspec.ts';
import { processEnv } from '../env.ts';

export type RunnerFailure = Extract<FailureKind, 'timeout' | 'infra' | 'cancelled'>;

/**
 * Result of a job. `state` is `ok` only if the container process exited with code 0. A
 * nonzero exit code from the job itself is `failure` with no `failureKind`: it's up to
 * the caller to interpret it. `failureKind` only appears when the failure is the
 * runner's own: timeout, cancellation or infrastructure (docker fails to start or
 * rejects the job).
 */
export type JobResult = {
  state: 'ok' | 'failure';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  failureKind?: RunnerFailure;
  container: string;
};

export type JobOptions = {
  /** Cancels the job: the container is killed and the result is `cancelled`. */
  signal?: AbortSignal;
  /** Container name; defaults to `demiurgo-run-<uuid>`. */
  containerName?: string;
  /** Docker executable. Only for infrastructure-failure tests. */
  dockerBinary?: string;
  /** Byte cap kept for stdout and stderr (defaults to 1 MiB each). */
  outputLimitBytes?: number;
};

/** Label used to mark every container the runner creates. */
export const RUNNER_LABEL = 'demiurgo.runner=1';
export const RUNNER_USER = '1000:1000';
export const TMPFS_RUNNER = '/tmp:rw,noexec,nosuid,size=64m';

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;
const DOCKER_COMMAND_MS = 15_000;
const STOP_RETRIES = 10;
const RETRY_PAUSE_MS = 1000;

/**
 * Host environment variables passed to the docker CLI: only what's needed to find the
 * executable, its configuration and the daemon on Windows and Linux. Never DEMIURGO_*,
 * DATABASE_URL, PG* or provider keys.
 */
export const DOCKER_CLI_ENV: readonly string[] = Object.freeze([
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'USERPROFILE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'TEMP',
  'TMP',
  'XDG_RUNTIME_DIR',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
]);

/** Minimal docker process environment derived from the host environment (pure function). */
export function dockerEnv(origin: Readonly<Record<string, string | undefined>> = processEnv()): Record<string, string> {
  // On Windows names are case-insensitive (Path, PATH): looked up case-insensitively.
  const byName = new Map<string, string>();
  for (const [key, value] of Object.entries(origin)) {
    if (value !== undefined) byName.set(key.toUpperCase(), value);
  }
  const environment: Record<string, string> = {};
  for (const name of DOCKER_CLI_ENV) {
    const value = byName.get(name.toUpperCase());
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

/**
 * `docker run` arguments for a JobSpec (pure function). Validates the spec again: the
 * security flags are fixed and no field in the spec can add mounts, network access,
 * privileges or change the user.
 */
export function dockerArguments(input: JobSpecInput, containerName: string): string[] {
  const spec: JobSpec = validateJobSpec(input);
  if (!NAME_PATTERN.test(containerName)) {
    throw new Error(`Invalid container name: ${JSON.stringify(containerName)}.`);
  }
  const { cpus, memoryMb, pids } = spec.limits;
  const args = [
    'run',
    '--rm',
    '--name',
    containerName,
    '--label',
    RUNNER_LABEL,
    '--pull',
    'never',
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    TMPFS_RUNNER,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    RUNNER_USER,
    '--pids-limit',
    String(pids),
    '--memory',
    `${memoryMb}m`,
    '--memory-swap',
    `${memoryMb}m`,
    '--cpus',
    String(cpus),
  ];
  if (spec.input !== undefined) args.push('-i');
  for (const [key, value] of Object.entries(spec.environment).sort(([a], [b]) => a.localeCompare(b))) {
    args.push('--env', `${key}=${value}`);
  }
  args.push(spec.image, ...spec.command);
  return args;
}

/** Accumulates a stream's output without exceeding the given cap. */
function collector(limit: number): { add(chunk: Buffer): void; text(): string } {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  return {
    add(chunk) {
      if (bytes >= limit) {
        truncated = true;
        return;
      }
      const part = chunk.length > limit - bytes ? chunk.subarray(0, limit - bytes) : chunk;
      if (part.length < chunk.length) truncated = true;
      chunks.push(part);
      bytes += part.length;
    },
    text() {
      const t = Buffer.concat(chunks).toString('utf8');
      return truncated ? `${t}\n[output truncated by the runner]` : t;
    },
  };
}

/** Runs an auxiliary docker command (kill, rm) with no shell and a maximum time. */
function runDockerCommand(binary: string, args: string[], environment: Record<string, string>): Promise<number | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, args, {
        shell: false,
        env: environment,
        stdio: 'ignore',
        windowsHide: true,
        timeout: DOCKER_COMMAND_MS,
      });
    } catch {
      resolve(null);
      return;
    }
    child.once('error', () => resolve(null));
    child.once('close', (code) => resolve(code));
  });
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** CLI errors that indicate the daemon isn't available. */
const DEAD_DAEMON_PATTERN = /error during connect|Cannot connect to the Docker daemon|docker daemon is not running/i;

/**
 * Runs a job in an ephemeral, hardened container. Throws `InvalidJobSpec` if the spec
 * doesn't satisfy the closed schema; any other problem is returned as a result.
 */
export async function runJob(input: JobSpecInput, options: JobOptions = {}): Promise<JobResult> {
  const spec = validateJobSpec(input);
  const name = options.containerName ?? `demiurgo-run-${randomUUID()}`;
  const args = dockerArguments(spec, name);
  const binary = options.dockerBinary ?? 'docker';
  const environment = dockerEnv();
  const limit = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT;
  const start = performance.now();

  if (options.signal?.aborted) {
    return {
      state: 'failure',
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      failureKind: 'cancelled',
      container: name,
    };
  }

  const output = collector(limit);
  const errors = collector(limit);
  let stopReason: 'timeout' | 'cancelled' | undefined;
  let startupError: Error | undefined;

  const code = await new Promise<number | null>((resolve) => {
    let finished = false;
    let child: ReturnType<typeof spawn>;

    const terminate = (c: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(c);
    };

    // Stops the container: `docker kill` and, if it doesn't exist yet or doesn't respond,
    // `docker rm -f` until the `docker run` process ends. As a last resort, kill the CLI.
    const stop = async (reason: 'timeout' | 'cancelled') => {
      if (stopReason !== undefined || finished) return;
      stopReason = reason;
      await runDockerCommand(binary, ['kill', name], environment);
      for (let i = 0; i < STOP_RETRIES; i++) {
        if (finished) break;
        await pause(RETRY_PAUSE_MS);
        if (!finished) await runDockerCommand(binary, ['rm', '-f', name], environment);
      }
      if (!finished) {
        child.kill('SIGKILL');
        terminate(null);
      }
    };
    const onAbort = () => void stop('cancelled');
    const timer = setTimeout(() => void stop('timeout'), spec.maxTimeMs);

    try {
      child = spawn(binary, args, {
        shell: false,
        env: environment,
        stdio: [spec.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      startupError = e instanceof Error ? e : new Error(String(e));
      terminate(null);
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (t: Buffer) => output.add(t));
    child.stderr?.on('data', (t: Buffer) => errors.add(t));
    child.on('error', (e) => {
      // Only a startup failure if the process never came to exist; if it's already running
      // (e.g. a failed `kill`), its `close` event decides the result.
      if (child.pid !== undefined) return;
      startupError = e;
      terminate(null);
    });
    child.once('close', (c) => terminate(c));
    if (spec.input !== undefined && child.stdin) {
      // If the container closes stdin before reading all of it, the EPIPE isn't a runner failure.
      child.stdin.on('error', () => {});
      child.stdin.end(spec.input);
    }
  });

  if (stopReason !== undefined || startupError !== undefined) {
    // Cleanup guarantee: the container must not outlive a stopped job.
    await runDockerCommand(binary, ['rm', '-f', name], environment);
  }

  const stderr = errors.text();
  const base = {
    exitCode: code,
    stdout: output.text(),
    stderr: startupError ? `${stderr}Could not launch docker: ${startupError.message}` : stderr,
    durationMs: Math.round(performance.now() - start),
    container: name,
  };
  if (stopReason !== undefined) return { state: 'failure', ...base, failureKind: stopReason };
  if (startupError !== undefined || code === null || code === 125 || (code !== 0 && DEAD_DAEMON_PATTERN.test(stderr))) {
    return { state: 'failure', ...base, failureKind: 'infra' };
  }
  return { state: code === 0 ? 'ok' : 'failure', ...base };
}
