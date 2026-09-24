// Lanzamiento de procesos de agente: la única pieza que llama a `spawn`. Los adaptadores
// reciben un `Lanzador` inyectable para que las pruebas no lancen binarios reales.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { join } from 'node:path';

export type LaunchCommand = {
  /** Ruta del ejecutable. Nunca se interpreta con una shell. */
  executable: string;
  args: readonly string[];
  cwd: string;
  /** Entorno completo del hijo (ya filtrado): no hereda nada más. */
  env: Readonly<Record<string, string>>;
  /** Texto que se escribe en stdin antes de cerrarlo. */
  input: string;
};

export type ProcessEnd = { code: number | null; signal: string | null; stdout: string; stderr: string };

export type LaunchedProcess = {
  readonly pid: number | undefined;
  /** Se resuelve al cerrarse el proceso y se rechaza si no se pudo lanzar (p. ej. `ENOENT`). */
  readonly end: Promise<ProcessEnd>;
  /** Mata el proceso y todo su árbol. Es idempotente. */
  terminate(): void;
};

export type Launcher = (command: LaunchCommand) => LaunchedProcess;

/** Busca una variable sin distinguir mayúsculas (en Windows `Path` y `PATH` son la misma). */
export function readVariable(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const target = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === target && value !== undefined) return value;
  }
  return undefined;
}

/** Error de lanzamiento por ejecutable inexistente. */
export function isExecutableNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function terminateTree(child: ChildProcessWithoutNullStreams, env: LaunchCommand['env']): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // `taskkill /T` mata también los procesos que haya lanzado la CLI. Ruta absoluta para no
    // depender del PATH del hijo.
    const root = readVariable(env, 'SystemRoot') ?? 'C:\\Windows';
    const killer = spawn(join(root, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('error', () => child.kill('SIGKILL'));
    return;
  }
  try {
    // El hijo se lanzó como líder de su propio grupo: se mata el grupo entero.
    process.kill(-pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/** Lanzador real sobre `child_process.spawn`, sin shell y con stdout y stderr completos. */
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
  // Si el proceso muere antes de leer stdin, la escritura falla con EPIPE: no es un error propio.
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
