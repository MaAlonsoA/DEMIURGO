// Configuración inyectada. Es, junto con `entorno.ts`, el único módulo que lee variables de
// entorno (AC-ESQ-001-06): el resto del núcleo recibe la configuración como parámetro.

import { z } from 'zod';

const schema = z.object({
  DEMIURGO_DATABASE_URL: z.string().url(),
  DEMIURGO_HOST: z.string().default('127.0.0.1'),
  DEMIURGO_PORT: z.coerce.number().int().min(1).max(65535).default(8100),
  DEMIURGO_AGENT: z.enum(['simulated', 'claude']).default('simulated'),
  DEMIURGO_AGENT_MODEL: z.string().default('haiku'),
  DEMIURGO_CLASSIFIER: z.enum(['simulated', 'reference', 'jev']).default('simulated'),
  DEMIURGO_CLASSIFIER_MODEL: z.string().default('haiku'),
  // Revisor de la cascada (§7.5): revisa lo que el clasificador devuelve con confianza media.
  DEMIURGO_REVIEWER: z.enum(['none', 'reference']).default('none'),
  DEMIURGO_REVIEWER_MODEL: z.string().default('sonnet'),
  DEMIURGO_SESSION_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  DEMIURGO_ORIGINS: z.string().default('http://127.0.0.1:8100,http://localhost:8100'),
});

export type Config = {
  baseUrl: string;
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

/** Puertos reservados a la v1: la v2 nunca los usa. */
export const FORBIDDEN_PORTS = [8000];

export function readConfig(environment: Readonly<Record<string, string | undefined>> = process.env): Config {
  const e = schema.parse(environment);
  if (FORBIDDEN_PORTS.includes(e.DEMIURGO_PORT)) {
    throw new Error(`El puerto ${e.DEMIURGO_PORT} es de la v1 y la v2 no puede usarlo.`);
  }
  return {
    baseUrl: e.DEMIURGO_DATABASE_URL,
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
