// Registro de guardas por nombre. Cada guarda declarada en design/datos/transiciones.yaml
// tiene aquí su implementación (AC-NUC-001-03). Una guarda devuelve null si se cumple o el
// motivo, en lenguaje de producto, si no.

import type { Guard } from './types.ts';

export const GUARDS: Record<string, Guard> = {};

/** Registra guardas; se llama desde cada módulo de comandos. */
export function registerGuards(guards: Record<string, Guard>): void {
  for (const [name, g] of Object.entries(guards)) {
    if (GUARDS[name]) throw new Error(`La guarda «${name}» ya está registrada.`);
    GUARDS[name] = g;
  }
}

/** Guardas de incrementos posteriores: bloquean siempre hasta que se implementen. */
export function pendingGuard(increment: string): Guard {
  return () => `Esta condición se implementa en ${increment}.`;
}

/** Texto de un valor desconocido: la cadena recortada o vacío. */
export const string = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Lee un campo de los datos del comando sin suponer su forma. */
export function field(data: unknown, name: string): unknown {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[name] : undefined;
}

registerGuards({
  reason_present: ({ data }) => (string(field(data, 'reason')) ? null : 'Hace falta un motivo.'),
  fdr_ready_to_build: pendingGuard('S3'),
  full_coverage: pendingGuard('S3'),
  gates_green: pendingGuard('S4'),
  covers_at_least_one_approved_ac: pendingGuard('S3'),
  attempts_remaining: pendingGuard('S4'),
  clarification_present: pendingGuard('S5'),
  red_test_on_base: pendingGuard('S3'),
  ac_manual: pendingGuard('S4'),
  test_map_accepted: pendingGuard('S3'),
});
