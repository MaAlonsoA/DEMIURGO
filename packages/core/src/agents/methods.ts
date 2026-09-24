// Métodos (prompts) versionados como archivos: `packages/core/metodos/<acción>/<versión>.md`.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type AccionAgente, esquemaJsonDe, huella } from '@demiurgo/domain';

export const VERSION_METODO: Record<AccionAgente, string> = {
  eco: 'v1',
  exploration_chat: 'v1',
  design_proposal: 'v1',
};

const DIR = fileURLToPath(new URL('../../metodos/', import.meta.url));

export type Metodo = { id: string; version: string; texto: string };

export async function cargarMetodo(accion: AccionAgente, version = VERSION_METODO[accion]): Promise<Metodo> {
  const texto = await readFile(`${DIR}${accion}/${version}.md`, 'utf8');
  return { id: `${accion}@${version}`, version, texto: texto.replaceAll('\r\n', '\n') };
}

/** Versión del esquema de salida: huella corta del JSON Schema generado desde Zod. */
export function versionEsquema(accion: AccionAgente): string {
  return huella(esquemaJsonDe(accion)).slice(0, 16);
}
