// Métodos (prompts) versionados como archivos: `packages/core/metodos/<acción>/<versión>.md`.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type AgentAction, jsonSchemaOf, fingerprint } from '@demiurgo/domain';

export const METHOD_VERSION: Record<AgentAction, string> = {
  echo: 'v1',
  exploration_chat: 'v1',
  design_proposal: 'v1',
};

const DIR = fileURLToPath(new URL('../../methods/', import.meta.url));

export type Method = { id: string; version: string; text: string };

export async function loadMethod(action: AgentAction, version = METHOD_VERSION[action]): Promise<Method> {
  const text = await readFile(`${DIR}${action}/${version}.md`, 'utf8');
  return { id: `${action}@${version}`, version, text: text.replaceAll('\r\n', '\n') };
}

/** Versión del esquema de salida: huella corta del JSON Schema generado desde Zod. */
export function schemaVersion(action: AgentAction): string {
  return fingerprint(jsonSchemaOf(action)).slice(0, 16);
}
