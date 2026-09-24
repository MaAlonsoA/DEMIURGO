// Lanzamiento de procesos de agente: la única pieza que llama a `spawn`. Los adaptadores
// reciben un `Lanzador` inyectable para que las pruebas no lancen binarios reales.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { join } from 'node:path';

export type OrdenLanzamiento = {
  /** Ruta del ejecutable. Nunca se interpreta con una shell. */
  ejecutable: string;
  args: readonly string[];
  cwd: string;
  /** Entorno completo del hijo (ya filtrado): no hereda nada más. */
  env: Readonly<Record<string, string>>;
  /** Texto que se escribe en stdin antes de cerrarlo. */
  entrada: string;
};

export type FinProceso = { codigo: number | null; senal: string | null; stdout: string; stderr: string };

export type ProcesoLanzado = {
  readonly pid: number | undefined;
  /** Se resuelve al cerrarse el proceso y se rechaza si no se pudo lanzar (p. ej. `ENOENT`). */
  readonly fin: Promise<FinProceso>;
  /** Mata el proceso y todo su árbol. Es idempotente. */
  terminar(): void;
};

export type Lanzador = (orden: OrdenLanzamiento) => ProcesoLanzado;

/** Busca una variable sin distinguir mayúsculas (en Windows `Path` y `PATH` son la misma). */
export function leerVariable(env: Readonly<Record<string, string | undefined>>, nombre: string): string | undefined {
  const buscado = nombre.toUpperCase();
  for (const [clave, valor] of Object.entries(env)) {
    if (clave.toUpperCase() === buscado && valor !== undefined) return valor;
  }
  return undefined;
}

/** Error de lanzamiento por ejecutable inexistente. */
export function esEjecutableNoEncontrado(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function terminarArbol(hijo: ChildProcessWithoutNullStreams, env: OrdenLanzamiento['env']): void {
  const pid = hijo.pid;
  if (pid === undefined || hijo.exitCode !== null || hijo.signalCode !== null) return;
  if (process.platform === 'win32') {
    // `taskkill /T` mata también los procesos que haya lanzado la CLI. Ruta absoluta para no
    // depender del PATH del hijo.
    const raiz = leerVariable(env, 'SystemRoot') ?? 'C:\\Windows';
    const matador = spawn(join(raiz, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    matador.once('error', () => hijo.kill('SIGKILL'));
    return;
  }
  try {
    // El hijo se lanzó como líder de su propio grupo: se mata el grupo entero.
    process.kill(-pid, 'SIGKILL');
  } catch {
    hijo.kill('SIGKILL');
  }
}

/** Lanzador real sobre `child_process.spawn`, sin shell y con stdout y stderr completos. */
export const lanzadorNodo: Lanzador = (orden) => {
  const hijo = spawn(orden.ejecutable, [...orden.args], {
    cwd: orden.cwd,
    env: { ...orden.env },
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const salida: Buffer[] = [];
  const errores: Buffer[] = [];
  hijo.stdout.on('data', (trozo: Buffer) => salida.push(trozo));
  hijo.stderr.on('data', (trozo: Buffer) => errores.push(trozo));
  // Si el proceso muere antes de leer stdin, la escritura falla con EPIPE: no es un error propio.
  hijo.stdin.on('error', () => undefined);
  const fin = new Promise<FinProceso>((resolver, rechazar) => {
    hijo.once('error', rechazar);
    hijo.once('close', (codigo, senal) =>
      resolver({
        codigo,
        senal,
        stdout: Buffer.concat(salida).toString('utf8'),
        stderr: Buffer.concat(errores).toString('utf8'),
      }),
    );
  });
  hijo.stdin.end(orden.entrada, 'utf8');
  let terminado = false;
  return {
    pid: hijo.pid,
    fin,
    terminar() {
      if (terminado) return;
      terminado = true;
      terminarArbol(hijo, orden.env);
    },
  };
};
