// JSON canónico y huellas. Mismo contenido → misma huella, sin depender del orden de las claves.

import { createHash } from 'node:crypto';

export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') {
    if (typeof valor === 'number' && !Number.isFinite(valor)) throw new Error('Número no finito en JSON canónico.');
    return JSON.stringify(valor) ?? 'null';
  }
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  const entradas = Object.entries(valor as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${jsonCanonico(v)}`).join(',')}}`;
}

export function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

export function huella(valor: unknown): string {
  return sha256(jsonCanonico(valor));
}
