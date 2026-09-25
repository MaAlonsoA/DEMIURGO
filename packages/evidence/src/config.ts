// Configuration of the evidence stack, from the environment (spec §11).

export const DEFAULT_DATABASE_URL = 'postgres://evidence:evidence-local@127.0.0.1:55434/demiurgo_evidence';
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4319;

export type EvidenceConfig = { databaseUrl: string; host: string; port: number };

export function readConfig(env: NodeJS.ProcessEnv = process.env): EvidenceConfig {
  const port = Number.parseInt(env.DEMIURGO_EVIDENCE_PORT ?? '', 10);
  return {
    databaseUrl: env.DEMIURGO_EVIDENCE_DATABASE_URL || DEFAULT_DATABASE_URL,
    host: env.DEMIURGO_EVIDENCE_HOST || DEFAULT_HOST,
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT,
  };
}
