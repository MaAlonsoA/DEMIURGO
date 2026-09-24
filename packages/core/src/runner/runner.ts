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
import { type JobSpec, type JobSpecEntrada, validarJobSpec } from './jobspec.ts';
import { entornoDelProceso } from '../entorno.ts';

export type FalloRunner = Extract<FailureKind, 'timeout' | 'infra' | 'cancelled'>;

/**
 * Resultado de un trabajo. `estado` es `ok` solo si el proceso del contenedor terminó con
 * código 0. Un código distinto de 0 del propio trabajo es `fallo` sin `failureKind`: lo
 * interpreta quien lo encargó. `failureKind` solo aparece cuando el fallo es del runner:
 * tiempo agotado, cancelación o infraestructura (docker no arranca o rechaza el trabajo).
 */
export type ResultadoTrabajo = {
  estado: 'ok' | 'fallo';
  codigoSalida: number | null;
  stdout: string;
  stderr: string;
  duracionMs: number;
  failureKind?: FalloRunner;
  contenedor: string;
};

export type OpcionesTrabajo = {
  /** Cancela el trabajo: se mata el contenedor y el resultado es `cancelled`. */
  signal?: AbortSignal;
  /** Nombre del contenedor; por defecto `demiurgo-run-<uuid>`. */
  nombreContenedor?: string;
  /** Ejecutable de docker. Solo para pruebas de fallo de infraestructura. */
  binarioDocker?: string;
  /** Tope de bytes que se guardan de stdout y de stderr (por defecto 1 MiB cada uno). */
  limiteSalidaBytes?: number;
};

/** Etiqueta con la que se marcan todos los contenedores del runner. */
export const ETIQUETA_RUNNER = 'demiurgo.runner=1';
export const USUARIO_RUNNER = '1000:1000';
export const TMPFS_RUNNER = '/tmp:rw,noexec,nosuid,size=64m';

const PATRON_NOMBRE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const LIMITE_SALIDA_POR_DEFECTO = 1024 * 1024;
const TIEMPO_ORDEN_DOCKER_MS = 15_000;
const REINTENTOS_PARADA = 10;
const PAUSA_REINTENTO_MS = 1000;

/**
 * Variables del entorno del host que se pasan a la CLI de docker: solo lo imprescindible
 * para encontrar el ejecutable, su configuración y el daemon en Windows y en Linux.
 * Nunca DEMIURGO_*, DATABASE_URL, PG* ni claves de proveedores.
 */
export const ENTORNO_CLI_DOCKER: readonly string[] = Object.freeze([
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
export function entornoDocker(
  origen: Readonly<Record<string, string | undefined>> = entornoDelProceso(),
): Record<string, string> {
  // En Windows los nombres no distinguen mayúsculas (Path, PATH): se buscan sin distinguirlas.
  const porNombre = new Map<string, string>();
  for (const [clave, valor] of Object.entries(origen)) {
    if (valor !== undefined) porNombre.set(clave.toUpperCase(), valor);
  }
  const entorno: Record<string, string> = {};
  for (const nombre of ENTORNO_CLI_DOCKER) {
    const valor = porNombre.get(nombre.toUpperCase());
    if (valor !== undefined) entorno[nombre] = valor;
  }
  return entorno;
}

/**
 * Argumentos de `docker run` para un JobSpec (función pura). Valida el spec otra vez: los
 * flags de seguridad son fijos y ningún campo del spec puede añadir montajes, red,
 * privilegios ni cambiar el usuario.
 */
export function argumentosDocker(entrada: JobSpecEntrada, nombreContenedor: string): string[] {
  const spec: JobSpec = validarJobSpec(entrada);
  if (!PATRON_NOMBRE.test(nombreContenedor)) {
    throw new Error(`Nombre de contenedor no válido: ${JSON.stringify(nombreContenedor)}.`);
  }
  const { cpus, memoriaMb, pids } = spec.limites;
  const args = [
    'run',
    '--rm',
    '--name',
    nombreContenedor,
    '--label',
    ETIQUETA_RUNNER,
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
    USUARIO_RUNNER,
    '--pids-limit',
    String(pids),
    '--memory',
    `${memoriaMb}m`,
    '--memory-swap',
    `${memoriaMb}m`,
    '--cpus',
    String(cpus),
  ];
  if (spec.entrada !== undefined) args.push('-i');
  for (const [clave, valor] of Object.entries(spec.entorno).sort(([a], [b]) => a.localeCompare(b))) {
    args.push('--env', `${clave}=${valor}`);
  }
  args.push(spec.imagen, ...spec.comando);
  return args;
}

/** Acumula la salida de un flujo sin pasar del tope indicado. */
function colector(limite: number): { anadir(trozo: Buffer): void; texto(): string } {
  const trozos: Buffer[] = [];
  let bytes = 0;
  let truncado = false;
  return {
    anadir(trozo) {
      if (bytes >= limite) {
        truncado = true;
        return;
      }
      const parte = trozo.length > limite - bytes ? trozo.subarray(0, limite - bytes) : trozo;
      if (parte.length < trozo.length) truncado = true;
      trozos.push(parte);
      bytes += parte.length;
    },
    texto() {
      const t = Buffer.concat(trozos).toString('utf8');
      return truncado ? `${t}\n[salida truncada por el runner]` : t;
    },
  };
}

/** Lanza una orden auxiliar de docker (kill, rm) sin shell y con tiempo máximo. */
function ordenDocker(binario: string, args: string[], entorno: Record<string, string>): Promise<number | null> {
  return new Promise((resolver) => {
    let hijo: ReturnType<typeof spawn>;
    try {
      hijo = spawn(binario, args, {
        shell: false,
        env: entorno,
        stdio: 'ignore',
        windowsHide: true,
        timeout: TIEMPO_ORDEN_DOCKER_MS,
      });
    } catch {
      resolver(null);
      return;
    }
    hijo.once('error', () => resolver(null));
    hijo.once('close', (codigo) => resolver(codigo));
  });
}

const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Errores de la CLI que indican que el daemon no está disponible. */
const PATRON_DAEMON_CAIDO = /error during connect|Cannot connect to the Docker daemon|docker daemon is not running/i;

/**
 * Ejecuta un trabajo en un contenedor efímero y endurecido. Lanza `JobSpecInvalido` si el
 * spec no cumple el esquema cerrado; cualquier otro problema se devuelve como resultado.
 */
export async function ejecutarTrabajo(entrada: JobSpecEntrada, opciones: OpcionesTrabajo = {}): Promise<ResultadoTrabajo> {
  const spec = validarJobSpec(entrada);
  const nombre = opciones.nombreContenedor ?? `demiurgo-run-${randomUUID()}`;
  const args = argumentosDocker(spec, nombre);
  const binario = opciones.binarioDocker ?? 'docker';
  const entorno = entornoDocker();
  const limite = opciones.limiteSalidaBytes ?? LIMITE_SALIDA_POR_DEFECTO;
  const inicio = performance.now();

  if (opciones.signal?.aborted) {
    return {
      estado: 'fallo',
      codigoSalida: null,
      stdout: '',
      stderr: '',
      duracionMs: 0,
      failureKind: 'cancelled',
      contenedor: nombre,
    };
  }

  const salida = colector(limite);
  const errores = colector(limite);
  let motivoParada: 'timeout' | 'cancelled' | undefined;
  let errorArranque: Error | undefined;

  const codigo = await new Promise<number | null>((resolver) => {
    let terminado = false;
    let hijo: ReturnType<typeof spawn>;

    const terminar = (c: number | null) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      opciones.signal?.removeEventListener('abort', alAbortar);
      resolver(c);
    };

    // Para el contenedor: `docker kill` y, si aún no existe o no responde, `docker rm -f`
    // hasta que el proceso `docker run` termine. Como último recurso se mata la CLI.
    const detener = async (motivo: 'timeout' | 'cancelled') => {
      if (motivoParada !== undefined || terminado) return;
      motivoParada = motivo;
      await ordenDocker(binario, ['kill', nombre], entorno);
      for (let i = 0; i < REINTENTOS_PARADA; i++) {
        if (terminado) break;
        await pausa(PAUSA_REINTENTO_MS);
        if (!terminado) await ordenDocker(binario, ['rm', '-f', nombre], entorno);
      }
      if (!terminado) {
        hijo.kill('SIGKILL');
        terminar(null);
      }
    };
    const alAbortar = () => void detener('cancelled');
    const temporizador = setTimeout(() => void detener('timeout'), spec.tiempoMaxMs);

    try {
      hijo = spawn(binario, args, {
        shell: false,
        env: entorno,
        stdio: [spec.entrada !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      errorArranque = e instanceof Error ? e : new Error(String(e));
      terminar(null);
      return;
    }
    opciones.signal?.addEventListener('abort', alAbortar, { once: true });
    hijo.stdout?.on('data', (t: Buffer) => salida.anadir(t));
    hijo.stderr?.on('data', (t: Buffer) => errores.anadir(t));
    hijo.on('error', (e) => {
      // Solo es fallo de arranque si el proceso no llegó a existir; si ya corre (p. ej. un
      // `kill` fallido), el resultado lo decide su evento `close`.
      if (hijo.pid !== undefined) return;
      errorArranque = e;
      terminar(null);
    });
    hijo.once('close', (c) => terminar(c));
    if (spec.entrada !== undefined && hijo.stdin) {
      // Si el contenedor cierra stdin antes de leerlo todo, el EPIPE no es un fallo del runner.
      hijo.stdin.on('error', () => {});
      hijo.stdin.end(spec.entrada);
    }
  });

  if (motivoParada !== undefined || errorArranque !== undefined) {
    // Garantía de limpieza: el contenedor no debe sobrevivir a un trabajo parado.
    await ordenDocker(binario, ['rm', '-f', nombre], entorno);
  }

  const stderr = errores.texto();
  const base = {
    codigoSalida: codigo,
    stdout: salida.texto(),
    stderr: errorArranque ? `${stderr}No se pudo lanzar docker: ${errorArranque.message}` : stderr,
    duracionMs: Math.round(performance.now() - inicio),
    contenedor: nombre,
  };
  if (motivoParada !== undefined) return { estado: 'fallo', ...base, failureKind: motivoParada };
  if (errorArranque !== undefined || codigo === null || codigo === 125 || (codigo !== 0 && PATRON_DAEMON_CAIDO.test(stderr))) {
    return { estado: 'fallo', ...base, failureKind: 'infra' };
  }
  return { estado: codigo === 0 ? 'ok' : 'fallo', ...base };
}
