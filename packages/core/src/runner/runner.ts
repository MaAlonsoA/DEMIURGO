// Broker del runner aislado (perfil de trabajo sin datos, credenciales, root ni red).
//
// Este módulo es el ÚNICO de DEMIURGO que invoca la CLI de docker. Recibe un JobSpec
// cerrado (jobspec.ts), fija él mismo todos los flags de seguridad y lanza el contenedor
// con `spawn` sin shell. Nadie más debe llamar a docker: cualquier ejecución aislada pasa
// por `ejecutarTrabajo`.
//
// Garantías del contenedor (docs/investigacion-stack-2026-09-24.md §6, invariante I9):
// sin red (`--network none`), rootfs de solo lectura, /tmp en tmpfs noexec, sin
// capacidades, `no-new-privileges`, usuario 1000:1000, límites de CPU, memoria y PIDs,
// sin montajes ni volúmenes y sin variables de entorno fuera de la lista permitida.
// El proceso docker hereda solo el entorno mínimo para que la CLI funcione.
//
// Limitación conocida del MVP: con Docker Desktop todos los contenedores comparten la VM
// Linux, así que T0 y T1 comparten kernel. Queda documentado en el ADR del runner.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { FailureKind } from '@demiurgo/domain';
import { type JobSpec, type JobSpecInput, validateJobSpec } from './jobspec.ts';
import { processEnv } from '../env.ts';

export type RunnerFailure = Extract<FailureKind, 'timeout' | 'infra' | 'cancelled'>;

/**
 * Resultado de un trabajo. `estado` es `ok` solo si el proceso del contenedor terminó con
 * código 0. Un código distinto de 0 del propio trabajo es `fallo` sin `failureKind`: lo
 * interpreta quien lo encargó. `failureKind` solo aparece cuando el fallo es del runner:
 * tiempo agotado, cancelación o infraestructura (docker no arranca o rechaza el trabajo).
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
  /** Cancela el trabajo: se mata el contenedor y el resultado es `cancelled`. */
  signal?: AbortSignal;
  /** Nombre del contenedor; por defecto `demiurgo-run-<uuid>`. */
  containerName?: string;
  /** Ejecutable de docker. Solo para pruebas de fallo de infraestructura. */
  dockerBinary?: string;
  /** Tope de bytes que se guardan de stdout y de stderr (por defecto 1 MiB cada uno). */
  outputLimitBytes?: number;
};

/** Etiqueta con la que se marcan todos los contenedores del runner. */
export const RUNNER_LABEL = 'demiurgo.runner=1';
export const RUNNER_USER = '1000:1000';
export const TMPFS_RUNNER = '/tmp:rw,noexec,nosuid,size=64m';

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;
const DOCKER_COMMAND_MS = 15_000;
const STOP_RETRIES = 10;
const RETRY_PAUSE_MS = 1000;

/**
 * Variables del entorno del host que se pasan a la CLI de docker: solo lo imprescindible
 * para encontrar el ejecutable, su configuración y el daemon en Windows y en Linux.
 * Nunca DEMIURGO_*, DATABASE_URL, PG* ni claves de proveedores.
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

/** Entorno mínimo del proceso docker a partir del entorno del host (función pura). */
export function dockerEnv(
  origin: Readonly<Record<string, string | undefined>> = processEnv(),
): Record<string, string> {
  // En Windows los nombres no distinguen mayúsculas (Path, PATH): se buscan sin distinguirlas.
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
 * Argumentos de `docker run` para un JobSpec (función pura). Valida el spec otra vez: los
 * flags de seguridad son fijos y ningún campo del spec puede añadir montajes, red,
 * privilegios ni cambiar el usuario.
 */
export function dockerArguments(input: JobSpecInput, containerName: string): string[] {
  const spec: JobSpec = validateJobSpec(input);
  if (!NAME_PATTERN.test(containerName)) {
    throw new Error(`Nombre de contenedor no válido: ${JSON.stringify(containerName)}.`);
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

/** Acumula la salida de un flujo sin pasar del tope indicado. */
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
      return truncated ? `${t}\n[salida truncada por el runner]` : t;
    },
  };
}

/** Lanza una orden auxiliar de docker (kill, rm) sin shell y con tiempo máximo. */
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

/** Errores de la CLI que indican que el daemon no está disponible. */
const DEAD_DAEMON_PATTERN = /error during connect|Cannot connect to the Docker daemon|docker daemon is not running/i;

/**
 * Ejecuta un trabajo en un contenedor efímero y endurecido. Lanza `JobSpecInvalido` si el
 * spec no cumple el esquema cerrado; cualquier otro problema se devuelve como resultado.
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

    // Para el contenedor: `docker kill` y, si aún no existe o no responde, `docker rm -f`
    // hasta que el proceso `docker run` termine. Como último recurso se mata la CLI.
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
      // Solo es fallo de arranque si el proceso no llegó a existir; si ya corre (p. ej. un
      // `kill` fallido), el resultado lo decide su evento `close`.
      if (child.pid !== undefined) return;
      startupError = e;
      terminate(null);
    });
    child.once('close', (c) => terminate(c));
    if (spec.input !== undefined && child.stdin) {
      // Si el contenedor cierra stdin antes de leerlo todo, el EPIPE no es un fallo del runner.
      child.stdin.on('error', () => {});
      child.stdin.end(spec.input);
    }
  });

  if (stopReason !== undefined || startupError !== undefined) {
    // Garantía de limpieza: el contenedor no debe sobrevivir a un trabajo parado.
    await runDockerCommand(binary, ['rm', '-f', name], environment);
  }

  const stderr = errors.text();
  const base = {
    exitCode: code,
    stdout: output.text(),
    stderr: startupError ? `${stderr}No se pudo lanzar docker: ${startupError.message}` : stderr,
    durationMs: Math.round(performance.now() - start),
    container: name,
  };
  if (stopReason !== undefined) return { state: 'failure', ...base, failureKind: stopReason };
  if (startupError !== undefined || code === null || code === 125 || (code !== 0 && DEAD_DAEMON_PATTERN.test(stderr))) {
    return { state: 'failure', ...base, failureKind: 'infra' };
  }
  return { state: code === 0 ? 'ok' : 'failure', ...base };
}
