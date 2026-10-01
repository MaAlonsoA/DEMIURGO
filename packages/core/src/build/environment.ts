// The environment of a build, read from the project's own CI (the `ci` job of
// .github/workflows/ci.yml): the service containers (the database and its version), the job's
// environment variables and the commands that install, migrate and fetch browsers. DEMIURGO prepares
// all of it before the builder starts, so the agent only works on the task and its tests run in the
// same conditions as CI. Pure: no I/O. Anything it does not understand gives null and the build goes on
// as it did without it.

import { parse } from 'yaml';

export type CiService = {
  name: string;
  image: string;
  env: Record<string, string>;
  /** The port the service listens on inside its container (the right side of `5432:5432`). */
  port: number | null;
  /** The port CI published on the runner (the left side), which the job's variables point at. */
  hostPort: number | null;
};

export type CiEnvironment = {
  services: CiService[];
  /** Job and step variables (those with `${{ }}` expressions are left out: they cannot be resolved here). */
  env: Record<string, string>;
  install?: string;
  migrate?: string;
  browsers?: string;
};

const SERVICE_NAME = /^[a-z][a-z0-9_-]{0,30}$/;
const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Plain string variables of an `env:` map; values with expressions or control characters are dropped. */
function variablesOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!ENV_NAME.test(key)) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    const text = String(value);
    if (text.includes('${{') || /[\0\n\r]/.test(text)) continue;
    out[key] = text;
  }
  return out;
}

function portsOf(raw: unknown): { port: number | null; hostPort: number | null } {
  const first = Array.isArray(raw) ? raw[0] : undefined;
  if (first === undefined) return { port: null, hostPort: null };
  const text = String(first).replace(/\/(tcp|udp)$/, '');
  const parts = text.split(':');
  const container = Number(parts.at(-1));
  const host = parts.length > 1 ? Number(parts.at(-2)) : container;
  if (!Number.isInteger(container) || container < 1 || container > 65535) return { port: null, hostPort: null };
  return { port: container, hostPort: Number.isInteger(host) && host > 0 && host <= 65535 ? host : container };
}

const INSTALL = /^\s*(pnpm|npm|yarn)\s+(install|i|ci)\b/m;
const BROWSERS = /\bplaywright\s+install\b/;
const MIGRATE = /\b(?:pnpm|npm|yarn)(?:\s+run)?\s+[\w:-]*migrate[\w:-]*\b/;

/** `playwright install --with-deps` needs root for system packages: the image already has them. */
const withoutDeps = (command: string): string => command.replace(/\s+--with-deps\b/g, '');

/** Reads the `ci` job of a workflow. Null when the file is not a workflow we understand or has no such job. */
export function environmentFromCi(yamlText: string): CiEnvironment | null {
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch {
    return null;
  }
  if (!isRecord(doc) || !isRecord(doc.jobs)) return null;
  const jobs = doc.jobs;
  const job = isRecord(jobs.ci)
    ? jobs.ci
    : Object.values(jobs).find((j): j is Record<string, unknown> => isRecord(j) && j.name === 'ci');
  if (!job) return null;

  const services: CiService[] = [];
  if (isRecord(job.services)) {
    for (const [name, raw] of Object.entries(job.services)) {
      if (!isRecord(raw) || typeof raw.image !== 'string') return null;
      if (!SERVICE_NAME.test(name) || !IMAGE.test(raw.image)) return null;
      services.push({ name, image: raw.image, env: variablesOf(raw.env), ...portsOf(raw.ports) });
    }
  }

  const env = variablesOf(job.env);
  const result: CiEnvironment = { services, env };
  const steps = Array.isArray(job.steps) ? job.steps : [];
  for (const step of steps) {
    if (!isRecord(step) || typeof step.run !== 'string') continue;
    const run = step.run.trim();
    const label = typeof step.name === 'string' ? step.name : '';
    if (result.install === undefined && INSTALL.test(run)) {
      result.install = run;
      Object.assign(env, variablesOf(step.env));
    } else if (result.browsers === undefined && BROWSERS.test(run)) {
      result.browsers = withoutDeps(run);
    } else if (result.migrate === undefined && (/migrat/i.test(label) || MIGRATE.test(run))) {
      result.migrate = run;
      Object.assign(env, variablesOf(step.env));
    }
  }
  return result;
}

/**
 * Points the variables that name a CI service at it inside the build network: a URL on `localhost` or
 * `127.0.0.1` with the port CI published (or the container's) becomes `<service>:<container port>`. With a
 * `database`, the database name of a URL that points at a Postgres service becomes the build's own.
 */
export function rewriteForNetwork(env: Record<string, string>, services: CiService[], database?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    let next = value;
    for (const service of services) {
      if (service.port === null) continue;
      for (const port of new Set([service.hostPort, service.port])) {
        if (port === null) continue;
        next = next.replace(new RegExp(`@(?:localhost|127\\.0\\.0\\.1):${port}(?=[/?]|$)`), `@${service.name}:${service.port}`);
        next = next.replace(new RegExp(`^([a-z][a-z0-9+.-]*://)(?:localhost|127\\.0\\.0\\.1):${port}(?=[/?]|$)`), `$1${service.name}:${service.port}`);
        if (next === `localhost:${port}` || next === `127.0.0.1:${port}`) next = `${service.name}:${service.port}`;
      }
    }
    if (database !== undefined) {
      for (const service of services) {
        if (service.port === null || !/(^|\/)postgres(:|@|$)/.test(service.image)) continue;
        next = next.replace(new RegExp(`^(postgres(?:ql)?://[^/@\\s]*@?${service.name}:${service.port})/[^?\\s]*`), `$1/${database}`);
      }
    }
    out[key] = next;
  }
  return out;
}
