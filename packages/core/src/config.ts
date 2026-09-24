// Injected configuration. Along with `env.ts`, it is the only module that reads environment
// variables (AC-ESQ-001-06): the rest of the core receives the configuration as a parameter.

import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const schema = z.object({
  DEMIURGO_DATABASE_URL: z.string().url(),
  DEMIURGO_HOST: z.string().default('127.0.0.1'),
  DEMIURGO_PORT: z.coerce.number().int().min(1).max(65535).default(8100),
  DEMIURGO_SESSION_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  DEMIURGO_ORIGINS: z.string().default('http://127.0.0.1:8100,http://localhost:8100'),
  // Development tools (snapshots, reset). Never on for the real instance.
  DEMIURGO_DEV_TOOLS: z.enum(['0', '1']).default('0'),
  // OpenCode's config, where the local models (Qwen…) are declared. Read-only.
  DEMIURGO_OPENCODE_CONFIG: z.string().min(1).optional(),
  // Stable folders of the conversations that keep a provider session.
  DEMIURGO_AGENT_SESSIONS_DIR: z.string().min(1).optional(),
});

export type Config = {
  databaseUrl: string;
  host: string;
  port: number;
  sessionHours: number;
  allowedOrigins: string[];
  devTools: boolean;
  /** OpenCode's `opencode.json`: the local models the person configured. */
  openCodeConfig: string;
  agentSessionsDir: string;
};

/** Ports reserved for v1: v2 never uses them. */
export const FORBIDDEN_PORTS = [8000];

/** Variables renamed when the code moved to English: an old name is an error, never silently ignored. */
const RENAMED_VARIABLES: Record<string, string> = {
  DEMIURGO_PUERTO: 'DEMIURGO_PORT',
  DEMIURGO_HORAS_SESION: 'DEMIURGO_SESSION_HOURS',
  DEMIURGO_ORIGENES: 'DEMIURGO_ORIGINS',
};

/** The engine of each agent is chosen in the web (FDR-AGE-002): these variables no longer exist. */
const REMOVED_VARIABLES = [
  'DEMIURGO_AGENT',
  'DEMIURGO_AGENT_MODEL',
  'DEMIURGO_CLASSIFIER',
  'DEMIURGO_CLASSIFIER_MODEL',
  'DEMIURGO_REVIEWER',
  'DEMIURGO_REVIEWER_MODEL',
  'DEMIURGO_AGENTE',
  'DEMIURGO_MODELO_AGENTE',
  'DEMIURGO_CLASIFICADOR',
  'DEMIURGO_MODELO_CLASIFICADOR',
  'DEMIURGO_REVISOR',
  'DEMIURGO_MODELO_REVISOR',
];

export function readConfig(environment: Readonly<Record<string, string | undefined>> = process.env): Config {
  const renamed = Object.keys(RENAMED_VARIABLES).filter((n) => environment[n] !== undefined);
  if (renamed.length > 0) {
    const list = renamed.map((n) => `${n} → ${RENAMED_VARIABLES[n]}`).join(', ');
    throw new Error(`Renamed environment variables: ${list}. Values are in English too (simulated, reference, none).`);
  }
  const removed = REMOVED_VARIABLES.filter((n) => environment[n] !== undefined);
  if (removed.length > 0) {
    throw new Error(`${removed.join(', ')} no longer exist: choose each agent's model in Settings → Models & providers.`);
  }
  const e = schema.parse(environment);
  if (FORBIDDEN_PORTS.includes(e.DEMIURGO_PORT)) {
    throw new Error(`Port ${e.DEMIURGO_PORT} belongs to v1 and v2 cannot use it.`);
  }
  return {
    databaseUrl: e.DEMIURGO_DATABASE_URL,
    host: e.DEMIURGO_HOST,
    port: e.DEMIURGO_PORT,
    sessionHours: e.DEMIURGO_SESSION_HOURS,
    allowedOrigins: e.DEMIURGO_ORIGINS.split(',').map((o) => o.trim()),
    devTools: e.DEMIURGO_DEV_TOOLS === '1',
    openCodeConfig: e.DEMIURGO_OPENCODE_CONFIG ?? join(configHome(environment), 'opencode', 'opencode.json'),
    agentSessionsDir: e.DEMIURGO_AGENT_SESSIONS_DIR ?? join(environment.LOCALAPPDATA ?? tmpdir(), 'Demiurgo', 'agent-sessions'),
  };
}

/** Where OpenCode looks for its config: `$XDG_CONFIG_HOME`, or `~/.config` (also on Windows). */
function configHome(environment: Readonly<Record<string, string | undefined>>): string {
  return environment.XDG_CONFIG_HOME ?? join(environment.USERPROFILE ?? environment.HOME ?? homedir(), '.config');
}
