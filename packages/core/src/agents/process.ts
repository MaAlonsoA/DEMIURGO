// Launching agent processes: the only piece that calls `spawn`. Adapters
// receive an injectable `Launcher` so tests don't launch real binaries.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { join } from 'node:path';

export type LaunchCommand = {
  /** Path to the executable. Never interpreted through a shell. */
  executable: string;
  args: readonly string[];
  cwd: string;
  /** Full environment of the child (already filtered): it inherits nothing else. */
  env: Readonly<Record<string, string>>;
  /** Text written to stdin before closing it. */
  input: string;
};

export type ProcessEnd = { code: number | null; signal: string | null; stdout: string; stderr: string };

export type LaunchedProcess = {
  readonly pid: number | undefined;
  /** Resolves when the process closes, and rejects if it couldn't be launched (e.g. `ENOENT`). */
  readonly end: Promise<ProcessEnd>;
  /** Kills the process and its whole tree. Idempotent. */
  terminate(): void;
};

export type Launcher = (command: LaunchCommand) => LaunchedProcess;

/** Looks up a variable case-insensitively (on Windows `Path` and `PATH` are the same). */
export function readVariable(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const target = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === target && value !== undefined) return value;
  }
  return undefined;
}

/** Launch error for a missing executable. */
export function isExecutableNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function terminateTree(child: ChildProcessWithoutNullStreams, env: LaunchCommand['env']): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // `taskkill /T` also kills any processes the CLI launched. Absolute path so it doesn't
    // depend on the child's PATH.
    const root = readVariable(env, 'SystemRoot') ?? 'C:\\Windows';
    const killer = spawn(join(root, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('error', () => child.kill('SIGKILL'));
    return;
  }
  try {
    // The child was launched as the leader of its own group: kill the whole group.
    process.kill(-pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/** Real launcher over `child_process.spawn`, without a shell and with full stdout and stderr. */
export const nodeLauncher: Launcher = (command) => {
  const child = spawn(command.executable, [...command.args], {
    cwd: command.cwd,
    env: { ...command.env },
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
  // If the process dies before reading stdin, the write fails with EPIPE: not an error of our own.
  child.stdin.on('error', () => undefined);
  const end = new Promise<ProcessEnd>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) =>
      resolve({
        code,
        signal,
        stdout: Buffer.concat(output).toString('utf8'),
        stderr: Buffer.concat(errors).toString('utf8'),
      }),
    );
  });
  child.stdin.end(command.input, 'utf8');
  let finished = false;
  return {
    pid: child.pid,
    end,
    terminate() {
      if (finished) return;
      finished = true;
      terminateTree(child, command.env);
    },
  };
};
