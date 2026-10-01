// Builder container: the ONE place where an agent may edit code. Like `runJob` it goes through
// the docker CLI with `spawn` and no shell, but with a different profile: network on the default
// bridge (the model API and package registries), the task's git worktree mounted read-write at
// /workspace and the CLI sign-in volume mounted READ-ONLY at /auth. No docker socket, no
// /projects, no git credentials, no environment outside a short allow list. DEMIURGO commits and
// pushes after the container exits. Called only when the person presses Build.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FailureKind } from '@demiurgo/domain';
import { z } from 'zod';
import {
  DEAD_DAEMON_PATTERN,
  NAME_PATTERN,
  RETRY_PAUSE_MS,
  STOP_RETRIES,
  collector,
  dockerEnv,
  pause,
  runDockerCommand,
} from './runner.ts';

export const BUILDER_LABEL = 'demiurgo.builder=1';
export const BUILDER_MAX_TIME_MS = 3_600_000;
const TRANSCRIPT_TAIL = 20_000;
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const REPORT_PATH = '.demiurgo/build-report.json';
export const PW_BROWSERS_DIR = '/ms-playwright';
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,99}$/;

export const buildReportSchema = z.object({
  summary: z.string(),
  tests: z.array(z.object({ name: z.string(), file: z.string(), criterion: z.string() })),
  notes: z.string(),
});
export type BuildReport = z.infer<typeof buildReportSchema>;

export type BuilderSpec = {
  /** Host path of the worktree (the docker daemon lives on the host). */
  worktreeHostPath: string;
  provider: 'claude' | 'codex';
  model: string;
  effort: string;
  /** The brief, sent on stdin. */
  prompt: string;
  maxTimeMs: number;
  limits: { cpus: number; memoryMb: number; pids: number };
};

export type BuilderResult = {
  state: 'ok' | 'failure';
  exitCode: number | null;
  durationMs: number;
  failureKind?: Extract<FailureKind, 'timeout' | 'infra' | 'cancelled'>;
  /** Last 20k characters of stdout (the CLI's event stream). */
  transcriptTail: string;
  /** Last 4k characters of stderr, to tell why a run failed (never stored raw: the orchestrator redacts it). */
  stderrTail?: string;
  report: BuildReport | null;
  container: string;
};

export type BuilderOptions = {
  signal?: AbortSignal;
  containerName?: string;
  dockerBinary?: string;
  /** Path of the worktree as this process sees it, to read the report (defaults to the host path). */
  worktreePath?: string;
  environment?: Readonly<Record<string, string | undefined>>;
};

const CLAUDE_TOOLS = 'Read,Edit,Write,Glob,Grep,Bash,WebSearch';

/** The CLI command inside the container (prompt on stdin). */
function cliCommand(spec: BuilderSpec): string[] {
  if (spec.provider === 'claude') {
    return [
      'claude', '-p',
      '--model', spec.model,
      '--output-format', 'stream-json',
      '--verbose',
      '--effort', spec.effort,
      '--permission-mode', 'acceptEdits',
      '--allowedTools', CLAUDE_TOOLS,
      '--disallowedTools', 'WebFetch',
      '--setting-sources', '',
    ];
  }
  return [
    'codex', 'exec', '--json',
    '-m', spec.model,
    '-c', 'sandbox_mode="workspace-write"',
    '-c', `model_reasoning_effort=${JSON.stringify(spec.effort)}`,
    '-c', 'web_search="live"',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '-',
  ];
}

/**
 * `docker run` arguments for a build (pure function). Fixed flags; the spec only supplies the
 * worktree, the provider, the model and effort, the limits and the timeout.
 */
export function builderArguments(spec: BuilderSpec, containerName: string, environment: Readonly<Record<string, string | undefined>> = process.env): string[] {
  if (!NAME_PATTERN.test(containerName)) throw new Error(`Invalid container name: ${JSON.stringify(containerName)}.`);
  if (!spec.worktreeHostPath.startsWith('/') || /[:,\0\n]/.test(spec.worktreeHostPath)) {
    throw new Error(`Invalid worktree path: ${JSON.stringify(spec.worktreeHostPath)}.`);
  }
  if (spec.provider !== 'claude' && spec.provider !== 'codex') throw new Error('The builder runs on claude or codex.');
  if (!SAFE_VALUE.test(spec.model)) throw new Error(`Invalid model: ${JSON.stringify(spec.model)}.`);
  if (!SAFE_VALUE.test(spec.effort)) throw new Error(`Invalid effort: ${JSON.stringify(spec.effort)}.`);
  if (!Number.isInteger(spec.maxTimeMs) || spec.maxTimeMs <= 0 || spec.maxTimeMs > BUILDER_MAX_TIME_MS) {
    throw new Error(`maxTimeMs must be between 1 and ${BUILDER_MAX_TIME_MS}.`);
  }
  const { cpus, memoryMb, pids } = spec.limits;
  if (!(cpus > 0) || !Number.isInteger(memoryMb) || memoryMb <= 0 || !Number.isInteger(pids) || pids <= 0) {
    throw new Error('Invalid limits.');
  }
  const uid = environment.DEMIURGO_UID?.trim() || '501';
  const gid = environment.DEMIURGO_GID?.trim() || uid;
  if (!/^\d+$/.test(uid) || !/^\d+$/.test(gid)) throw new Error('DEMIURGO_UID and DEMIURGO_GID must be numbers.');
  const image = environment.DEMIURGO_BUILDER_IMAGE?.trim() || 'demiurgo/app:local';
  const volume = environment.DEMIURGO_CLI_AUTH_VOLUME?.trim() || 'demiurgo_cli-auth';
  const browsersVolume = environment.DEMIURGO_PW_BROWSERS_VOLUME?.trim() || 'demiurgo_pw-browsers';
  const dir = spec.provider === 'claude' ? 'claude' : 'codex';
  const home = '/home/demiurgo';
  const config = `${home}/.${dir}-auth`;
  const stateVariable = spec.provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
  // Copies the sign-in (read-only volume) to a writable place, then runs the CLI in /workspace.
  const script = `set -eu; mkdir -p "${config}"; cp -R /auth/${dir}/. "${config}"/; cd /workspace; exec "$@"`;
  const env: Record<string, string> = {
    CI: '1',
    HOME: home,
    // Playwright browsers live in a named volume, outside the worktree: they download once per version.
    PLAYWRIGHT_BROWSERS_PATH: PW_BROWSERS_DIR,
    LANG: environment.LANG?.trim() || 'C.UTF-8',
    TZ: environment.TZ?.trim() || 'UTC',
    [stateVariable]: config,
  };
  const args = [
    'run', '--rm', '-i',
    '--name', containerName,
    '--label', BUILDER_LABEL,
    '--pull', 'never',
    '--read-only',
    '--tmpfs', '/tmp:rw,exec,nosuid,size=512m',
    '--tmpfs', `${home}:rw,exec,nosuid,size=256m,uid=${uid},gid=${gid}`,
    '--cap-drop', 'ALL',
    // No core dumps: a crashing browser left a 301 MB `core` in the worktree that GitHub refused.
    '--ulimit', 'core=0',
    '--security-opt', 'no-new-privileges',
    '--user', `${uid}:${gid}`,
    '--pids-limit', String(pids),
    '--memory', `${memoryMb}m`,
    '--memory-swap', `${memoryMb}m`,
    '--cpus', String(cpus),
    '--mount', `type=bind,source=${spec.worktreeHostPath},target=/workspace`,
    '--mount', `type=volume,source=${volume},target=/auth,readonly`,
    '--mount', `type=volume,source=${browsersVolume},target=${PW_BROWSERS_DIR}`,
    '--workdir', '/workspace',
  ];
  for (const [key, value] of Object.entries(env).sort(([a], [b]) => a.localeCompare(b))) args.push('--env', `${key}=${value}`);
  args.push(image, 'sh', '-c', script, 'builder', ...cliCommand(spec));
  return args;
}

async function readReport(worktree: string): Promise<BuildReport | null> {
  try {
    const parsed = buildReportSchema.safeParse(JSON.parse(await readFile(join(worktree, REPORT_PATH), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Runs the builder container to its end (or timeout or cancellation) and reads its report. */
export async function runBuilder(spec: BuilderSpec, options: BuilderOptions = {}): Promise<BuilderResult> {
  const name = options.containerName ?? `demiurgo-build-${randomUUID()}`;
  const args = builderArguments(spec, name, options.environment);
  const binary = options.dockerBinary ?? 'docker';
  const environment = dockerEnv();
  const worktree = options.worktreePath ?? spec.worktreeHostPath;
  const start = performance.now();
  const empty = { transcriptTail: '', report: null, container: name };

  if (options.signal?.aborted) return { state: 'failure', exitCode: null, durationMs: 0, failureKind: 'cancelled', ...empty };

  const output = collector(OUTPUT_LIMIT);
  const errors = collector(64 * 1024);
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
      child = spawn(binary, args, { shell: false, env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      startupError = e instanceof Error ? e : new Error(String(e));
      terminate(null);
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (t: Buffer) => output.add(t));
    child.stderr?.on('data', (t: Buffer) => errors.add(t));
    child.on('error', (e) => {
      if (child.pid !== undefined) return;
      startupError = e;
      terminate(null);
    });
    child.once('close', (c) => terminate(c));
    child.stdin?.on('error', () => {});
    child.stdin?.end(spec.prompt);
  });

  if (stopReason !== undefined || startupError !== undefined) await runDockerCommand(binary, ['rm', '-f', name], environment);

  const stderr = errors.text();
  const stdout = output.text();
  const base = {
    exitCode: code,
    durationMs: Math.round(performance.now() - start),
    transcriptTail: stdout.slice(-TRANSCRIPT_TAIL),
    stderrTail: stderr.slice(-4000),
    report: await readReport(worktree),
    container: name,
  };
  if (stopReason !== undefined) return { state: 'failure', ...base, failureKind: stopReason };
  if (startupError !== undefined || code === null || code === 125 || (code !== 0 && DEAD_DAEMON_PATTERN.test(stderr))) {
    return { state: 'failure', ...base, failureKind: 'infra' };
  }
  return { state: code === 0 ? 'ok' : 'failure', ...base };
}
