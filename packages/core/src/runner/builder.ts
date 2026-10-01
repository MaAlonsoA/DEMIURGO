// Builder container: the ONE place where an agent may edit code. Like `runJob` it goes through
// the docker CLI with `spawn` and no shell, but with a different profile: network on the default
// bridge (the model API and package registries), the task's git worktree mounted read-write at
// /workspace, the main repo's .git mounted read-only (read-only git) and the CLI sign-in volume mounted READ-ONLY at /auth. No docker socket, no
// /projects, no git credentials, no environment outside a short allow list. DEMIURGO commits and
// pushes after the container exits. Called only when the person presses Build.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FailureKind } from '@demiurgo/domain';
import { z } from 'zod';
import { CLAUDE_TOKEN_VARIABLE, type LoginCheck, checkClaudeLogin, claudeOauthToken } from './claude-login.ts';
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
export const PNPM_STORE_DIR = '/pnpm-store';
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
  /**
   * The project's main repository, so read-only git works in /workspace (its `.git` file points
   * into the main repo's `.git`): that `.git` is mounted READ-ONLY at `containerPath`, the path the
   * worktree's `.git` file references. No push rights: no credentials, no write access.
   */
  gitDir?: { hostPath: string; containerPath: string };
  /** The brief, sent on stdin. */
  prompt: string;
  maxTimeMs: number;
  limits: { cpus: number; memoryMb: number; pids: number };
  /** The build network where the CI services run (see `prepareEnvironment`); without it, the default bridge. */
  network?: string;
  /** The project's pnpm store volume, mounted at /pnpm-store. */
  storeVolume?: string;
  /** Variables of the prepared environment (the CI's `DATABASE_URL`, ...). */
  env?: Record<string, string>;
  /**
   * The agent session of the task: `hostDir` is a per-task host folder mounted where the CLI keeps its sessions
   * (Claude `projects/`, Codex `sessions/`) so it survives the container. Claude needs the id up front
   * (`--session-id` when fresh, `--resume` when resumed); a fresh Codex session has none and reports it back.
   */
  session?: { mode: 'fresh' | 'resumed'; id?: string; hostDir: string };
};

export type BuilderResult = {
  state: 'ok' | 'failure';
  exitCode: number | null;
  durationMs: number;
  failureKind?: Extract<FailureKind, 'timeout' | 'infra' | 'cancelled'> | 'login';
  /** Last 20k characters of stdout (the CLI's event stream). */
  transcriptTail: string;
  /** Last 4k characters of stderr, to tell why a run failed (never stored raw: the orchestrator redacts it). */
  stderrTail?: string;
  report: BuildReport | null;
  container: string;
  /** The agent session this run used or started, when the spec asked for one. */
  sessionId?: string;
};

export type BuilderOptions = {
  signal?: AbortSignal;
  containerName?: string;
  dockerBinary?: string;
  /** Path of the worktree as this process sees it, to read the report (defaults to the host path). */
  worktreePath?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  /** Replaces the sign-in check that runs before a Claude builder starts (tests). */
  loginCheck?: (spec: BuilderSpec) => Promise<LoginCheck>;
};

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const FORBIDDEN_ENV = /^(LD_|DYLD_|NODE_OPTIONS$|PATH$|BASH_ENV$|ENV$|GIT_|CLAUDE|CODEX|ANTHROPIC|OPENAI)/;

/** Checks the prepared environment's variables: plain names and values, none that could change how the container starts. */
export function environmentVariables(env: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (!ENV_NAME.test(key) || FORBIDDEN_ENV.test(key)) throw new Error(`Invalid environment variable name: ${JSON.stringify(key)}.`);
    if (/[\0\n\r]/.test(value)) throw new Error(`Invalid value for ${key}.`);
    out[key] = value;
  }
  return out;
}

const storeArguments = (volume: string | undefined): string[] => {
  if (volume === undefined) return [];
  if (!NAME_PATTERN.test(volume)) throw new Error(`Invalid volume name: ${JSON.stringify(volume)}.`);
  return ['--mount', `type=volume,source=${volume},target=${PNPM_STORE_DIR}`];
};

function networkArguments(network: string | undefined): string[] {
  if (network === undefined) return [];
  if (!NAME_PATTERN.test(network)) throw new Error(`Invalid network name: ${JSON.stringify(network)}.`);
  return ['--network', network];
}

export type SetupSpec = {
  worktreeHostPath: string;
  /** The shell command to run in /workspace (a line of the project's CI). */
  command: string;
  network: string;
  /** The project's pnpm store volume. */
  storeVolume: string;
  env: Record<string, string>;
  limits: { cpus: number; memoryMb: number; pids: number };
};

/**
 * `docker run` arguments for a preparation command (install, migrate, browsers): the builder's hardened
 * profile and mounts (worktree and browsers volume, no sign-in, no .git) on the build network, with the
 * CI's variables. The project's pnpm store volume is mounted at /pnpm-store.
 */
export function setupArguments(spec: SetupSpec, containerName: string, environment: Readonly<Record<string, string | undefined>> = process.env): string[] {
  if (!NAME_PATTERN.test(containerName)) throw new Error(`Invalid container name: ${JSON.stringify(containerName)}.`);
  if (!spec.worktreeHostPath.startsWith('/') || /[:,\0\n]/.test(spec.worktreeHostPath)) {
    throw new Error(`Invalid worktree path: ${JSON.stringify(spec.worktreeHostPath)}.`);
  }
  if (!spec.command.trim() || spec.command.includes('\0')) throw new Error('Empty setup command.');
  const { cpus, memoryMb, pids } = spec.limits;
  if (!(cpus > 0) || !Number.isInteger(memoryMb) || memoryMb <= 0 || !Number.isInteger(pids) || pids <= 0) throw new Error('Invalid limits.');
  const uid = environment.DEMIURGO_UID?.trim() || '501';
  const gid = environment.DEMIURGO_GID?.trim() || uid;
  if (!/^\d+$/.test(uid) || !/^\d+$/.test(gid)) throw new Error('DEMIURGO_UID and DEMIURGO_GID must be numbers.');
  const image = environment.DEMIURGO_BUILDER_IMAGE?.trim() || 'demiurgo/app:local';
  const browsersVolume = environment.DEMIURGO_PW_BROWSERS_VOLUME?.trim() || 'demiurgo_pw-browsers';
  const home = '/home/demiurgo';
  const env: Record<string, string> = {
    ...environmentVariables(spec.env),
    CI: '1',
    HOME: home,
    PLAYWRIGHT_BROWSERS_PATH: PW_BROWSERS_DIR,
    npm_config_store_dir: PNPM_STORE_DIR,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    LANG: environment.LANG?.trim() || 'C.UTF-8',
    TZ: environment.TZ?.trim() || 'UTC',
  };
  const args = [
    'run', '--rm',
    '--name', containerName,
    '--label', BUILDER_LABEL,
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
    '--mount', `type=volume,source=${browsersVolume},target=${PW_BROWSERS_DIR}`,
    ...storeArguments(spec.storeVolume),
    '--workdir', '/workspace',
    ...networkArguments(spec.network),
  ];
  for (const [key, value] of Object.entries(env).sort(([a], [b]) => a.localeCompare(b))) args.push('--env', `${key}=${value}`);
  // The image's entrypoint changes to /app (DEMIURGO itself): the command runs in the worktree.
  args.push(image, 'sh', '-c', `set -eu; cd /workspace; ${spec.command}`);
  return args;
}

const CLAUDE_TOOLS = 'Read,Edit,Write,Glob,Grep,Bash,WebSearch';
const SESSIONS_MOUNT = '/agent-sessions';
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/;
/** The thread id Codex announces in its first event. */
const THREAD_STARTED = /"type"\s*:\s*"thread\.started"[^\n]*?"thread_id"\s*:\s*"([A-Za-z0-9_-]{8,100})"/;

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
      ...(spec.session?.mode === 'resumed' && spec.session.id ? ['--resume', spec.session.id] : []),
      ...(spec.session?.mode === 'fresh' && spec.session.id ? ['--session-id', spec.session.id] : []),
    ];
  }
  if (spec.session?.mode === 'resumed' && spec.session.id) {
    // `exec resume` has no -C: it runs in the container's working directory (/workspace).
    return [
      'codex', 'exec', 'resume', '--json',
      '-m', spec.model,
      '--dangerously-bypass-approvals-and-sandbox',
      '-c', `model_reasoning_effort=${JSON.stringify(spec.effort)}`,
      '-c', 'web_search="live"',
      '--skip-git-repo-check',
      '--ignore-user-config',
      spec.session.id,
      '-',
    ];
  }
  return [
    'codex', 'exec', '--json',
    '-m', spec.model,
    // The hardened container is the sandbox: Codex's own (bubblewrap) cannot create namespaces in it, so
    // every command and file write failed and the agent gave up. Codex documents this flag for
    // "environments that are externally sandboxed" (`codex exec --help`).
    '--dangerously-bypass-approvals-and-sandbox',
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
  if (spec.gitDir) {
    const { hostPath, containerPath } = spec.gitDir;
    for (const p of [hostPath, containerPath]) {
      if (!p.startsWith('/') || /[:,\0\n]/.test(p)) throw new Error(`Invalid git directory path: ${JSON.stringify(p)}.`);
    }
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
  // With the long-lived token (Claude only) no credentials are copied: the token travels as an environment
  // variable and only the non-secret `.claude.json` is copied. Without it the sign-in is copied from the read-only
  // volume to a writable place, WITHOUT lock files (a stale `.oauth_refresh.lock` makes Claude say another process
  // is refreshing). Builders never refresh the shared session: see `checkClaudeLogin`.
  const token = spec.provider === 'claude' ? claudeOauthToken(environment) : undefined;
  const copy = token
    ? `if [ -f /auth/${dir}/.claude.json ]; then cp /auth/${dir}/.claude.json "${config}"/; fi`
    : `cd /auth/${dir}; tar -cf - --exclude='*.lock' . | tar -xf - -C "${config}"`;
  if (spec.session) {
    if (!spec.session.hostDir.startsWith('/') || /[:,\0\n]/.test(spec.session.hostDir)) throw new Error(`Invalid session path: ${JSON.stringify(spec.session.hostDir)}.`);
    if (spec.session.id !== undefined && !SESSION_ID.test(spec.session.id)) throw new Error('Invalid session id.');
    if (spec.session.mode === 'resumed' && !spec.session.id) throw new Error('A resumed session needs its id.');
  }
  // The session folder is mounted outside the config dir and linked into it: a bind mount inside the config dir
  // would make Docker create that dir as root, and the CLI could not write its config there.
  const sessionLink = spec.session ? `; rm -rf "${config}/${spec.provider === 'claude' ? 'projects' : 'sessions'}"; ln -s ${SESSIONS_MOUNT} "${config}/${spec.provider === 'claude' ? 'projects' : 'sessions'}"` : '';
  const script = `set -eu; mkdir -p "${config}"; ${copy}${sessionLink}; cd /workspace; exec "$@"`;
  const extra = environmentVariables(spec.env);
  const env: Record<string, string> = {
    ...extra,
    CI: '1',
    ...(spec.storeVolume ? { npm_config_store_dir: PNPM_STORE_DIR } : {}),
    // Read-only git (status, diff, log) must not try to refresh the index in the read-only mount.
    GIT_OPTIONAL_LOCKS: '0',
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
    ...(spec.gitDir ? ['--mount', `type=bind,source=${spec.gitDir.hostPath},target=${spec.gitDir.containerPath},readonly`] : []),
    '--mount', `type=volume,source=${volume},target=/auth,readonly`,
    ...(spec.session ? ['--mount', `type=bind,source=${spec.session.hostDir},target=${SESSIONS_MOUNT}`] : []),
    '--mount', `type=volume,source=${browsersVolume},target=${PW_BROWSERS_DIR}`,
    ...storeArguments(spec.storeVolume),
    '--workdir', '/workspace',
    ...networkArguments(spec.network),
  ];
  for (const [key, value] of Object.entries(env).sort(([a], [b]) => a.localeCompare(b))) args.push('--env', `${key}=${value}`);
  // Name only: docker takes the value from its own environment (see `runBuilder`), so it is not in the arguments.
  if (token) args.push('--env', CLAUDE_TOKEN_VARIABLE);
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
  const token = spec.provider === 'claude' ? claudeOauthToken(options.environment ?? process.env) : undefined;
  const environment = { ...dockerEnv(), ...(token ? { [CLAUDE_TOKEN_VARIABLE]: token } : {}) };
  const worktree = options.worktreePath ?? spec.worktreeHostPath;
  const start = performance.now();
  const empty = { transcriptTail: '', report: null, container: name };

  if (options.signal?.aborted) return { state: 'failure', exitCode: null, durationMs: 0, failureKind: 'cancelled', ...empty };

  // The stored sign-in must outlive the build (or the long-lived token be set): a builder never refreshes it.
  if (spec.provider === 'claude') {
    const login = await (options.loginCheck ?? ((sp) => checkClaudeLogin({ env: options.environment ?? process.env, maxTimeMs: sp.maxTimeMs })))(spec);
    if (!login.ok) return { state: 'failure', exitCode: null, durationMs: 0, failureKind: 'login', stderrTail: login.message, ...empty };
  }

  const output = collector(OUTPUT_LIMIT);
  const errors = collector(64 * 1024);
  let stopReason: 'timeout' | 'cancelled' | undefined;
  let startupError: Error | undefined;
  // A fresh Codex session announces its id in the first events: keep only the head of the stream to find it.
  let threadId: string | undefined;
  let head = '';

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
    child.stdout?.on('data', (t: Buffer) => {
      output.add(t);
      if (spec.provider === 'codex' && spec.session?.mode === 'fresh' && threadId === undefined && head.length < 65_536) {
        head += t.toString('utf8');
        threadId = THREAD_STARTED.exec(head)?.[1];
      }
    });
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
  const sessionId = spec.session ? (spec.provider === 'codex' && spec.session.mode === 'fresh' ? threadId : spec.session.id) : undefined;
  const base = {
    exitCode: code,
    durationMs: Math.round(performance.now() - start),
    transcriptTail: stdout.slice(-TRANSCRIPT_TAIL),
    stderrTail: stderr.slice(-4000),
    report: await readReport(worktree),
    container: name,
    ...(sessionId ? { sessionId } : {}),
  };
  if (stopReason !== undefined) return { state: 'failure', ...base, failureKind: stopReason };
  if (startupError !== undefined || code === null || code === 125 || (code !== 0 && DEAD_DAEMON_PATTERN.test(stderr))) {
    return { state: 'failure', ...base, failureKind: 'infra' };
  }
  return { state: code === 0 ? 'ok' : 'failure', ...base };
}
