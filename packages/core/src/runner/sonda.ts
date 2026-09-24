// Sonda del runner (invariante I9): un script sin dependencias que se ejecuta con `node -`
// dentro del contenedor y cuenta qué ve. El runner cumple si la sonda no ve variables ni
// ficheros sensibles, no abre ninguna conexión, no escribe fuera de /tmp y no es root.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IMAGENES_PERMITIDAS, type JobSpecEntrada } from './jobspec.ts';
import { argumentosDocker, ejecutarTrabajo, type ResultadoTrabajo } from './runner.ts';

export type DestinoTcp = { host: string; puerto: number };

export type ConfiguracionSonda = {
  /** Rutas cuya mera existencia ya sería una fuga (datos, credenciales, socket, host). */
  rutasSensibles: string[];
  destinosTcp: DestinoTcp[];
  nombresDns: string[];
  /** Directorios donde la sonda intenta escribir; `.` es el directorio de trabajo. */
  rutasEscritura: string[];
  /** Directorio de trabajo temporal donde sí debe poder escribir. */
  rutaTmp: string;
  timeoutConexionMs: number;
};

export const CONFIGURACION_SONDA: ConfiguracionSonda = Object.freeze({
  rutasSensibles: [
    '/data',
    '/codex',
    '/root/.claude',
    '/root/.codex',
    '/home/node/.claude',
    '/home/node/.codex',
    '/run/secrets',
    '/var/run/docker.sock',
    '/run/docker.sock',
    '/host',
    '/mnt/c',
    '/mnt/host',
    '/workspace',
  ],
  destinosTcp: [
    { host: 'host.docker.internal', puerto: 55432 },
    { host: 'host.docker.internal', puerto: 8000 },
    { host: '192.168.65.254', puerto: 55432 },
    { host: '172.17.0.1', puerto: 5432 },
    // Pasarela del puente de Docker con el puerto publicado del Postgres de desarrollo y de la CI.
    { host: '172.17.0.1', puerto: 55432 },
    { host: '10.0.2.2', puerto: 55432 },
    { host: '127.0.0.1', puerto: 5432 },
    { host: '1.1.1.1', puerto: 443 },
  ],
  nombresDns: ['registry.npmjs.org'],
  rutasEscritura: ['/', '.', '/home/node', '/etc', '/usr/local/lib'],
  rutaTmp: '/tmp',
  timeoutConexionMs: 1500,
});

/**
 * Patrones de nombres de variable que parecen credenciales o datos. Se buscan como
 * subcadenas sin distinguir mayúsculas: preferimos un falso positivo a una fuga sin ver.
 * `PG`, `GH` y `SSH` solo cuentan como prefijo de segmento para no marcar nombres inocentes.
 */
export const PATRON_VARIABLE_SENSIBLE =
  /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|DATABASE|DEMIURGO|ANTHROPIC|OPENAI|CODEX|CLAUDE|AWS|GITHUB|(^|_)PG|(^|_)GH_|(^|_)SSH_/i;

/** Genera el script de la sonda con la configuración incrustada como JSON. */
export function generarScriptSonda(config: ConfiguracionSonda = CONFIGURACION_SONDA): string {
  return `'use strict';
const CONFIG = ${JSON.stringify(config)};
const PATRON = new RegExp(${JSON.stringify(PATRON_VARIABLE_SENSIBLE.source)}, 'i');
const fs = process.getBuiltinModule('node:fs');
const net = process.getBuiltinModule('node:net');
const dns = process.getBuiltinModule('node:dns');
const path = process.getBuiltinModule('node:path');

function detalleError(e) {
  return e && typeof e === 'object' && 'code' in e && e.code ? String(e.code) : String((e && e.message) || e);
}

function conTiempo(promesa, ms) {
  let t;
  const limite = new Promise((resolver) => { t = setTimeout(() => resolver({ ok: false, detalle: 'TIMEOUT' }), ms); });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(t));
}

function probarTcp(destino) {
  const intento = new Promise((resolver) => {
    let hecho = false;
    const fin = (ok, detalle) => { if (hecho) return; hecho = true; socket.destroy(); resolver({ ok, detalle }); };
    const socket = net.connect({ host: destino.host, port: destino.puerto });
    socket.once('connect', () => fin(true, 'CONECTADO'));
    socket.once('error', (e) => fin(false, detalleError(e)));
  });
  return conTiempo(intento, CONFIG.timeoutConexionMs).then((r) => ({
    tipo: 'tcp', destino: destino.host + ':' + destino.puerto, conectado: r.ok, detalle: r.detalle,
  }));
}

function probarDns(nombre) {
  const intento = dns.promises.lookup(nombre, { all: true }).then(
    (dirs) => ({ ok: true, detalle: dirs.map((d) => d.address).join(',') }),
    (e) => ({ ok: false, detalle: detalleError(e) }),
  );
  return conTiempo(intento, CONFIG.timeoutConexionMs * 2).then((r) => ({
    tipo: 'dns', destino: nombre, conectado: r.ok, detalle: r.detalle,
  }));
}

function intentarEscribir(objetivo) {
  const ruta = path.resolve(objetivo);
  const fichero = path.join(ruta, '.sonda-demiurgo-' + process.pid + '-' + Date.now());
  try {
    fs.writeFileSync(fichero, 'sonda');
    try { fs.unlinkSync(fichero); } catch {}
    return { objetivo, ruta, escrito: true, detalle: 'ESCRITO' };
  } catch (e) {
    return { objetivo, ruta, escrito: false, detalle: detalleError(e) };
  }
}

// visible: existe y la sonda la ve; ausente: no existe; sin_permiso: la sonda ni siquiera
// puede comprobarla (p. ej. /root con modo 700 para uid 1000), así que no le es accesible.
function comprobarRuta(ruta) {
  try { fs.lstatSync(ruta); return { ruta, estado: 'visible', detalle: 'EXISTE' }; } catch (e) {
    const codigo = detalleError(e);
    if (codigo === 'ENOENT' || codigo === 'ENOTDIR') return { ruta, estado: 'ausente', detalle: codigo };
    if (codigo === 'EACCES' || codigo === 'EPERM') return { ruta, estado: 'sin_permiso', detalle: codigo };
    return { ruta, estado: 'visible', detalle: codigo };
  }
}

function campoEstado(nombre) {
  try {
    const linea = fs.readFileSync('/proc/self/status', 'utf8').split('\\n').find((l) => l.startsWith(nombre + ':'));
    return linea ? linea.slice(nombre.length + 1).trim() : null;
  } catch { return null; }
}

async function principal() {
  const variablesVisibles = Object.keys(process.env).sort();
  const rutas = CONFIG.rutasSensibles.map(comprobarRuta);
  const conexiones = await Promise.all([
    ...CONFIG.destinosTcp.map(probarTcp),
    ...CONFIG.nombresDns.map(probarDns),
  ]);
  const informe = {
    uid: typeof process.getuid === 'function' ? process.getuid() : -1,
    gid: typeof process.getgid === 'function' ? process.getgid() : -1,
    cwd: process.cwd(),
    variablesVisibles,
    variablesSensibles: variablesVisibles.filter((n) => PATRON.test(n)),
    ficherosVisibles: rutas.filter((r) => r.estado === 'visible').map((r) => r.ruta),
    rutas,
    proceso: { capEff: campoEstado('CapEff'), noNewPrivs: campoEstado('NoNewPrivs'), seccomp: campoEstado('Seccomp') },
    conexiones,
    escrituraFueraDeTmp: CONFIG.rutasEscritura.map(intentarEscribir),
    escrituraEnTmp: intentarEscribir(CONFIG.rutaTmp),
  };
  // Salida explícita: getaddrinfo de musl sigue reintentando en segundo plano y retendría
  // el proceso varios segundos después de que los intentos ya hayan vencido.
  process.stdout.write(JSON.stringify(informe), () => process.exit(0));
}

principal().catch((e) => { process.stderr.write('Fallo de la sonda: ' + detalleError(e)); process.exit(2); });
`;
}

export const SCRIPT_SONDA = generarScriptSonda();

const intento = z.object({ objetivo: z.string(), ruta: z.string(), escrito: z.boolean(), detalle: z.string() });

export const esquemaInformeSonda = z.object({
  uid: z.number().int(),
  gid: z.number().int(),
  cwd: z.string(),
  variablesVisibles: z.array(z.string()),
  variablesSensibles: z.array(z.string()),
  ficherosVisibles: z.array(z.string()),
  rutas: z.array(z.object({ ruta: z.string(), estado: z.enum(['visible', 'ausente', 'sin_permiso']), detalle: z.string() })),
  proceso: z.object({ capEff: z.string().nullable(), noNewPrivs: z.string().nullable(), seccomp: z.string().nullable() }),
  conexiones: z.array(
    z.object({ tipo: z.enum(['tcp', 'dns']), destino: z.string(), conectado: z.boolean(), detalle: z.string() }),
  ),
  escrituraFueraDeTmp: z.array(intento),
  escrituraEnTmp: intento,
});

export type InformeSonda = z.infer<typeof esquemaInformeSonda>;

/** Lista de incumplimientos del aislamiento según el informe (vacía si todo está bien). */
export function violacionesSonda(informe: InformeSonda): string[] {
  const v: string[] = [];
  if (informe.uid === 0) v.push('La sonda se ejecuta como root (uid 0).');
  if (informe.gid === 0) v.push('La sonda se ejecuta con el grupo root (gid 0).');
  if (informe.variablesSensibles.length > 0) v.push(`Variables sensibles visibles: ${informe.variablesSensibles.join(', ')}.`);
  if (informe.ficherosVisibles.length > 0) v.push(`Ficheros sensibles visibles: ${informe.ficherosVisibles.join(', ')}.`);
  for (const c of informe.conexiones.filter((x) => x.conectado)) v.push(`Conexión ${c.tipo} abierta con ${c.destino}.`);
  for (const e of informe.escrituraFueraDeTmp.filter((x) => x.escrito)) v.push(`Escritura fuera de /tmp en ${e.ruta}.`);
  if (informe.proceso.capEff !== null && /[1-9a-f]/i.test(informe.proceso.capEff)) {
    v.push(`El proceso conserva capacidades (CapEff ${informe.proceso.capEff}).`);
  }
  if (informe.proceso.noNewPrivs !== null && informe.proceso.noNewPrivs !== '1') v.push('no-new-privileges no está activo.');
  return v;
}

/** JobSpec con el que se lanza la sonda. */
export function specSonda(tiempoMaxMs = 30_000): JobSpecEntrada {
  return {
    imagen: IMAGENES_PERMITIDAS[0] ?? '',
    comando: ['node', '-'],
    entrada: SCRIPT_SONDA,
    tiempoMaxMs,
    entorno: { LANG: 'C.UTF-8', CI: '1' },
  };
}

export type ResultadoSonda = {
  informe: InformeSonda;
  violaciones: string[];
  duracionMs: number;
  argumentos: string[];
  resultado: ResultadoTrabajo;
};

/** Lanza la sonda en el runner y devuelve su informe. Lanza un error si la sonda no llega a informar. */
export async function ejecutarSonda(opciones: { signal?: AbortSignal; tiempoMaxMs?: number } = {}): Promise<ResultadoSonda> {
  const spec = specSonda(opciones.tiempoMaxMs);
  const nombre = `demiurgo-sonda-${randomUUID()}`;
  const resultado = await ejecutarTrabajo(spec, {
    nombreContenedor: nombre,
    ...(opciones.signal ? { signal: opciones.signal } : {}),
  });
  if (resultado.estado !== 'ok') {
    throw new Error(
      `La sonda no terminó bien (${resultado.failureKind ?? `código ${resultado.codigoSalida}`}): ${resultado.stderr.trim()}`,
    );
  }
  let crudo: unknown;
  try {
    crudo = JSON.parse(resultado.stdout);
  } catch {
    throw new Error(`La sonda no devolvió JSON: ${resultado.stdout.slice(0, 500)}`);
  }
  const informe = esquemaInformeSonda.parse(crudo);
  const argumentos = argumentosDocker(spec, nombre);
  return { informe, violaciones: violacionesSonda(informe), duracionMs: resultado.duracionMs, argumentos, resultado };
}
