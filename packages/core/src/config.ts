// Injected configuration. Along with `env.ts`, it is the only module that reads environment
// variables (AC-ESQ-001-06): the rest of the core receives the configuration as a parameter.

import { z } from 'zod';

const schema = z.object({
  DEMIURGO_DATABASE_URL: z.string().url(),
  DEMIURGO_HOST: z.string().default('127.0.0.1'),
  DEMIURGO_PORT: z.coerce.number().int().min(1).max(65535).default(8100),
  DEMIURGO_AGENT: z.enum(['simulated', 'claude']).default('simulated'),
  DEMIURGO_AGENT_MODEL: z.string().default('haiku'),
  DEMIURGO_CLASSIFIER: z.enum(['simulated', 'reference', 'jev']).default('simulated'),
  DEMIURGO_CLASSIFIER_MODEL: z.string().default('haiku'),
  // Cascade reviewer (§7.5): reviews what the classifier returns with medium confidence.
  DEMIURGO_REVIEWER: z.enum(['none', 'reference']).default('none'),
  DEMIURGO_REVIEWER_MODEL: z.string().default('sonnet'),
  DEMIURGO_SESSION_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  DEMIURGO_ORIGINS: z.string().default('http://127.0.0.1:8100,http://localhost:8100'),
});

export type Config = {
  databaseUrl: string;
  host: string;
  port: number;
  agent: 'simulated' | 'claude';
  agentModel: string;
  classifier: 'simulated' | 'reference' | 'jev';
  classifierModel: string;
  reviewer: 'none' | 'reference';
  reviewerModel: string;
  sessionHours: number;
  allowedOrigins: string[];
};

/** Ports reserved for v1: v2 never uses them. */
export const FORBIDDEN_PORTS = [8000];

/** Variables renamed when the code moved to English: an old name is an error, never silently ignored. */
const RENAMED_VARIABLES: Record<string, string> = {
  DEMIURGO_PUERTO: 'DEMIURGO_PORT',
  DEMIURGO_AGENTE: 'DEMIURGO_AGENT',
  DEMIURGO_MODELO_AGENTE: 'DEMIURGO_AGENT_MODEL',
  DEMIURGO_CLASIFICADOR: 'DEMIURGO_CLASSIFIER',
  DEMIURGO_MODELO_CLASIFICADOR: 'DEMIURGO_CLASSIFIER_MODEL',
  DEMIURGO_REVISOR: 'DEMIURGO_REVIEWER',
  DEMIURGO_MODELO_REVISOR: 'DEMIURGO_REVIEWER_MODEL',
  DEMIURGO_HORAS_SESION: 'DEMIURGO_SESSION_HOURS',
  DEMIURGO_ORIGENES: 'DEMIURGO_ORIGINS',
};

export function readConfig(environment: Readonly<Record<string, string | undefined>> = process.env): Config {
  const renamed = Object.keys(RENAMED_VARIABLES).filter((n) => environment[n] !== undefined);
  if (renamed.length > 0) {
    const list = renamed.map((n) => `${n} → ${RENAMED_VARIABLES[n]}`).join(', ');
    throw new Error(`Renamed environment variables: ${list}. Values are in English too (simulated, reference, none).`);
  }
  const e = schema.parse(environment);
  if (FORBIDDEN_PORTS.includes(e.DEMIURGO_PORT)) {
    throw new Error(`Port ${e.DEMIURGO_PORT} belongs to v1 and v2 cannot use it.`);
  }
  return {
    databaseUrl: e.DEMIURGO_DATABASE_URL,
    host: e.DEMIURGO_HOST,
    port: e.DEMIURGO_PORT,
    agent: e.DEMIURGO_AGENT,
    agentModel: e.DEMIURGO_AGENT_MODEL,
    classifier: e.DEMIURGO_CLASSIFIER,
    classifierModel: e.DEMIURGO_CLASSIFIER_MODEL,
    reviewer: e.DEMIURGO_REVIEWER,
    reviewerModel: e.DEMIURGO_REVIEWER_MODEL,
    sessionHours: e.DEMIURGO_SESSION_HOURS,
    allowedOrigins: e.DEMIURGO_ORIGINS.split(',').map((o) => o.trim()),
  };
}
