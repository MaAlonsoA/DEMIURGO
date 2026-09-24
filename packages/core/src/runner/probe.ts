// Runner probe (invariant I9): a dependency-free script that runs with `node -` inside
// the container and reports what it can see. The runner passes if the probe sees no
// sensitive variables or files, opens no connections, writes nothing outside /tmp and
// isn't root.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ALLOWED_IMAGES, type JobSpecInput } from './jobspec.ts';
import { dockerArguments, runJob, type JobResult } from './runner.ts';

export type TcpTarget = { host: string; port: number };

export type ProbeConfig = {
  /** Paths whose mere existence would already be a leak (data, credentials, socket, host). */
  sensitivePaths: string[];
  tcpTargets: TcpTarget[];
  dnsNames: string[];
  /** Directories where the probe tries to write; `.` is the working directory. */
  writePaths: string[];
  /** Temp working directory where it must be able to write. */
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
    // Docker bridge gateway with the published port of the dev and CI Postgres.
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
 * Patterns for variable names that look like credentials or data. Matched as
 * case-insensitive substrings: we prefer a false positive to an unseen leak.
 * `PG`, `GH` and `SSH` only count as a segment prefix so innocent names aren't flagged.
 */
export const SENSITIVE_VARIABLE_PATTERN =
  /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|DATABASE|DEMIURGO|ANTHROPIC|OPENAI|CODEX|CLAUDE|AWS|GITHUB|(^|_)PG|(^|_)GH_|(^|_)SSH_/i;

/** Generates the probe script with its configuration embedded as JSON. */
export function generateProbeScript(config: ProbeConfig = PROBE_CONFIG): string {
  return `'use strict';
const CONFIG = ${JSON.stringify(config)};
const PATTERN = new RegExp(${JSON.stringify(SENSITIVE_VARIABLE_PATTERN.source)}, 'i');
const fs = process.getBuiltinModule('node:fs');
const net = process.getBuiltinModule('node:net');
const dns = process.getBuiltinModule('node:dns');
const path = process.getBuiltinModule('node:path');

function errorDetail(e) {
  return e && typeof e === 'object' && 'code' in e && e.code ? String(e.code) : String((e && e.message) || e);
}

function withTimeout(promise, ms) {
  let t;
  const limit = new Promise((resolve) => { t = setTimeout(() => resolve({ ok: false, detail: 'TIMEOUT' }), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(t));
}

function probeTcp(target) {
  const attempt = new Promise((resolve) => {
    let done = false;
    const finish = (ok, detail) => { if (done) return; done = true; socket.destroy(); resolve({ ok, detail }); };
    const socket = net.connect({ host: target.host, port: target.port });
    socket.once('connect', () => finish(true, 'CONNECTED'));
    socket.once('error', (e) => finish(false, errorDetail(e)));
  });
  return withTimeout(attempt, CONFIG.connectionTimeoutMs).then((r) => ({
    type: 'tcp', target: target.host + ':' + target.port, connected: r.ok, detail: r.detail,
  }));
}

function probeDns(name) {
  const attempt = dns.promises.lookup(name, { all: true }).then(
    (addrs) => ({ ok: true, detail: addrs.map((d) => d.address).join(',') }),
    (e) => ({ ok: false, detail: errorDetail(e) }),
  );
  return withTimeout(attempt, CONFIG.connectionTimeoutMs * 2).then((r) => ({
    type: 'dns', target: name, connected: r.ok, detail: r.detail,
  }));
}

function tryWrite(target) {
  const resolved = path.resolve(target);
  const file = path.join(resolved, '.probe-demiurgo-' + process.pid + '-' + Date.now());
  try {
    fs.writeFileSync(file, 'probe');
    try { fs.unlinkSync(file); } catch {}
    return { target, path: resolved, written: true, detail: 'WRITTEN' };
  } catch (e) {
    return { target, path: resolved, written: false, detail: errorDetail(e) };
  }
}

// visible: it exists and the probe can see it; absent: it doesn't exist; no_access: the
// probe can't even check it (e.g. /root with mode 700 for uid 1000), so it's unreachable.
function checkPath(candidate) {
  try { fs.lstatSync(candidate); return { path: candidate, state: 'visible', detail: 'EXISTS' }; } catch (e) {
    const code = errorDetail(e);
    if (code === 'ENOENT' || code === 'ENOTDIR') return { path: candidate, state: 'absent', detail: code };
    if (code === 'EACCES' || code === 'EPERM') return { path: candidate, state: 'no_access', detail: code };
    return { path: candidate, state: 'visible', detail: code };
  }
}

function statusField(name) {
  try {
    const line = fs.readFileSync('/proc/self/status', 'utf8').split('\\n').find((l) => l.startsWith(name + ':'));
    return line ? line.slice(name.length + 1).trim() : null;
  } catch { return null; }
}

async function main() {
  const visibleVariables = Object.keys(process.env).sort();
  const paths = CONFIG.sensitivePaths.map(checkPath);
  const connections = await Promise.all([
    ...CONFIG.tcpTargets.map(probeTcp),
    ...CONFIG.dnsNames.map(probeDns),
  ]);
  const report = {
    uid: typeof process.getuid === 'function' ? process.getuid() : -1,
    gid: typeof process.getgid === 'function' ? process.getgid() : -1,
    cwd: process.cwd(),
    visibleVariables,
    sensitiveVariables: visibleVariables.filter((n) => PATTERN.test(n)),
    visibleFiles: paths.filter((r) => r.state === 'visible').map((r) => r.path),
    paths,
    proc: { capEff: statusField('CapEff'), noNewPrivs: statusField('NoNewPrivs'), seccomp: statusField('Seccomp') },
    connections,
    writeOutsideTmp: CONFIG.writePaths.map(tryWrite),
    writeInTmp: tryWrite(CONFIG.tmpPath),
  };
  // Explicit exit: musl's getaddrinfo keeps retrying in the background and would keep the
  // process alive for several seconds after the attempts have already timed out.
  process.stdout.write(JSON.stringify(report), () => process.exit(0));
}

main().catch((e) => { process.stderr.write('Probe failure: ' + errorDetail(e)); process.exit(2); });
`;
}

export const PROBE_SCRIPT = generateProbeScript();

const attempt = z.object({ target: z.string(), path: z.string(), written: z.boolean(), detail: z.string() });

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

/** List of isolation violations found in the report (empty if everything's fine). */
export function probeViolations(report: ProbeReport): string[] {
  const v: string[] = [];
  if (report.uid === 0) v.push('The probe is running as root (uid 0).');
  if (report.gid === 0) v.push('The probe is running with the root group (gid 0).');
  if (report.sensitiveVariables.length > 0) v.push(`Sensitive variables visible: ${report.sensitiveVariables.join(', ')}.`);
  if (report.visibleFiles.length > 0) v.push(`Sensitive files visible: ${report.visibleFiles.join(', ')}.`);
  for (const c of report.connections.filter((x) => x.connected)) v.push(`Open ${c.type} connection to ${c.target}.`);
  for (const e of report.writeOutsideTmp.filter((x) => x.written)) v.push(`Write outside /tmp at ${e.path}.`);
  if (report.proc.capEff !== null && /[1-9a-f]/i.test(report.proc.capEff)) {
    v.push(`The process retains capabilities (CapEff ${report.proc.capEff}).`);
  }
  if (report.proc.noNewPrivs !== null && report.proc.noNewPrivs !== '1') v.push('no-new-privileges is not active.');
  return v;
}

/** JobSpec used to launch the probe. */
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

/** Launches the probe on the runner and returns its report. Throws if the probe never reports. */
export async function runProbe(options: { signal?: AbortSignal; maxTimeMs?: number } = {}): Promise<ProbeResult> {
  const spec = probeSpec(options.maxTimeMs);
  const name = `demiurgo-probe-${randomUUID()}`;
  const result = await runJob(spec, {
    containerName: name,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (result.state !== 'ok') {
    throw new Error(
      `The probe did not finish cleanly (${result.failureKind ?? `code ${result.exitCode}`}): ${result.stderr.trim()}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    throw new Error(`The probe did not return JSON: ${result.stdout.slice(0, 500)}`);
  }
  const report = probeReportSchema.parse(raw);
  const argList = dockerArguments(spec, name);
  return { report, violations: probeViolations(report), durationMs: result.durationMs, argList, result };
}
