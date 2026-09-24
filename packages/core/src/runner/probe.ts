// Sonda del runner (invariante I9): un script sin dependencias que se ejecuta con `node -`
// dentro del contenedor y cuenta qué ve. El runner cumple si la sonda no ve variables ni
// ficheros sensibles, no abre ninguna conexión, no escribe fuera de /tmp y no es root.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ALLOWED_IMAGES, type JobSpecInput } from './jobspec.ts';
import { dockerArguments, runJob, type JobResult } from './runner.ts';

export type TcpTarget = { host: string; port: number };

export type ProbeConfig = {
  /** Rutas cuya mera existencia ya sería una fuga (datos, credenciales, socket, host). */
  sensitivePaths: string[];
  tcpTargets: TcpTarget[];
  dnsNames: string[];
  /** Directorios donde la sonda intenta escribir; `.` es el directorio de trabajo. */
  writePaths: string[];
  /** Directorio de trabajo temporal donde sí debe poder escribir. */
  tmpPath: string;
  connectionTimeoutMs: number;
};

export const PROBE_CONFIG: ProbeConfig = Object.freeze({
  sensitivePaths: [
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
  tcpTargets: [
    { host: 'host.docker.internal', port: 55432 },
    { host: 'host.docker.internal', port: 8000 },
    { host: '192.168.65.254', port: 55432 },
    { host: '172.17.0.1', port: 5432 },
    // Pasarela del puente de Docker con el puerto publicado del Postgres de desarrollo y de la CI.
    { host: '172.17.0.1', port: 55432 },
    { host: '10.0.2.2', port: 55432 },
    { host: '127.0.0.1', port: 5432 },
    { host: '1.1.1.1', port: 443 },
  ],
  dnsNames: ['registry.npmjs.org'],
  writePaths: ['/', '.', '/home/node', '/etc', '/usr/local/lib'],
  tmpPath: '/tmp',
  connectionTimeoutMs: 1500,
});

/**
 * Patrones de nombres de variable que parecen credenciales o datos. Se buscan como
 * subcadenas sin distinguir mayúsculas: preferimos un falso positivo a una fuga sin ver.
 * `PG`, `GH` y `SSH` solo cuentan como prefijo de segmento para no marcar nombres inocentes.
 */
export const SENSITIVE_VARIABLE_PATTERN =
  /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|DATABASE|DEMIURGO|ANTHROPIC|OPENAI|CODEX|CLAUDE|AWS|GITHUB|(^|_)PG|(^|_)GH_|(^|_)SSH_/i;

/** Genera el script de la sonda con la configuración incrustada como JSON. */
export function generateProbeScript(config: ProbeConfig = PROBE_CONFIG): string {
  return `'use strict';
const CONFIG = ${JSON.stringify(config)};
const PATRON = new RegExp(${JSON.stringify(SENSITIVE_VARIABLE_PATTERN.source)}, 'i');
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

export const PROBE_SCRIPT = generateProbeScript();

const attempt = z.object({ goal: z.string(), path: z.string(), written: z.boolean(), detail: z.string() });

export const probeReportSchema = z.object({
  uid: z.number().int(),
  gid: z.number().int(),
  cwd: z.string(),
  visibleVariables: z.array(z.string()),
  sensitiveVariables: z.array(z.string()),
  visibleFiles: z.array(z.string()),
  paths: z.array(z.object({ path: z.string(), state: z.enum(['visible', 'absent', 'no_access']), detail: z.string() })),
  proc: z.object({ capEff: z.string().nullable(), noNewPrivs: z.string().nullable(), seccomp: z.string().nullable() }),
  connections: z.array(
    z.object({ type: z.enum(['tcp', 'dns']), target: z.string(), connected: z.boolean(), detail: z.string() }),
  ),
  writeOutsideTmp: z.array(attempt),
  writeInTmp: attempt,
});

export type ProbeReport = z.infer<typeof probeReportSchema>;

/** Lista de incumplimientos del aislamiento según el informe (vacía si todo está bien). */
export function probeViolations(report: ProbeReport): string[] {
  const v: string[] = [];
  if (report.uid === 0) v.push('La sonda se ejecuta como root (uid 0).');
  if (report.gid === 0) v.push('La sonda se ejecuta con el grupo root (gid 0).');
  if (report.sensitiveVariables.length > 0) v.push(`Variables sensibles visibles: ${report.sensitiveVariables.join(', ')}.`);
  if (report.visibleFiles.length > 0) v.push(`Ficheros sensibles visibles: ${report.visibleFiles.join(', ')}.`);
  for (const c of report.connections.filter((x) => x.connected)) v.push(`Conexión ${c.type} abierta con ${c.target}.`);
  for (const e of report.writeOutsideTmp.filter((x) => x.written)) v.push(`Escritura fuera de /tmp en ${e.path}.`);
  if (report.proc.capEff !== null && /[1-9a-f]/i.test(report.proc.capEff)) {
    v.push(`El proceso conserva capacidades (CapEff ${report.proc.capEff}).`);
  }
  if (report.proc.noNewPrivs !== null && report.proc.noNewPrivs !== '1') v.push('no-new-privileges no está activo.');
  return v;
}

/** JobSpec con el que se lanza la sonda. */
export function probeSpec(maxTimeMs = 30_000): JobSpecInput {
  return {
    image: ALLOWED_IMAGES[0] ?? '',
    command: ['node', '-'],
    input: PROBE_SCRIPT,
    maxTimeMs,
    environment: { LANG: 'C.UTF-8', CI: '1' },
  };
}

export type ProbeResult = {
  report: ProbeReport;
  violations: string[];
  durationMs: number;
  argList: string[];
  result: JobResult;
};

/** Lanza la sonda en el runner y devuelve su informe. Lanza un error si la sonda no llega a informar. */
export async function runProbe(options: { signal?: AbortSignal; maxTimeMs?: number } = {}): Promise<ProbeResult> {
  const spec = probeSpec(options.maxTimeMs);
  const name = `demiurgo-sonda-${randomUUID()}`;
  const result = await runJob(spec, {
    containerName: name,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (result.state !== 'ok') {
    throw new Error(
      `La sonda no terminó bien (${result.failureKind ?? `código ${result.exitCode}`}): ${result.stderr.trim()}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    throw new Error(`La sonda no devolvió JSON: ${result.stdout.slice(0, 500)}`);
  }
  const report = probeReportSchema.parse(raw);
  const argList = dockerArguments(spec, name);
  return { report, violations: probeViolations(report), durationMs: result.durationMs, argList, result };
}
