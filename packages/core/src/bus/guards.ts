// Registro de guardas por nombre. Cada guarda declarada en design/datos/transiciones.yaml
// tiene aquí su implementación (AC-NUC-001-03). Una guarda devuelve null si se cumple o el
// motivo, en lenguaje de producto, si no.

import type { Guarda } from './tipos.ts';

export const GUARDAS: Record<string, Guarda> = {};

/** Registra guardas; se llama desde cada módulo de comandos. */
export function registrarGuardas(guardas: Record<string, Guarda>): void {
  for (const [nombre, g] of Object.entries(guardas)) {
    if (GUARDAS[nombre]) throw new Error(`La guarda «${nombre}» ya está registrada.`);
    GUARDAS[nombre] = g;
  }
}

/** Guardas de incrementos posteriores: bloquean siempre hasta que se implementen. */
export function guardaPendiente(incremento: string): Guarda {
  return () => `Esta condición se implementa en ${incremento}.`;
}

/** Texto de un valor desconocido: la cadena recortada o vacío. */
export const cadena = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Lee un campo de los datos del comando sin suponer su forma. */
export function campo(datos: unknown, nombre: string): unknown {
  return typeof datos === 'object' && datos !== null ? (datos as Record<string, unknown>)[nombre] : undefined;
}

registrarGuardas({
  motivo_presente: ({ datos }) => (cadena(campo(datos, 'motivo')) ? null : 'Hace falta un motivo.'),
  fdr_lista_para_construir: guardaPendiente('S3'),
  cobertura_completa: guardaPendiente('S3'),
  gates_en_verde: guardaPendiente('S4'),
  cubre_al_menos_un_ac_aprobado: guardaPendiente('S3'),
  quedan_intentos: guardaPendiente('S4'),
  aclaracion_presente: guardaPendiente('S5'),
  prueba_en_rojo_sobre_la_base: guardaPendiente('S3'),
  ac_manual: guardaPendiente('S4'),
  mapa_aceptado: guardaPendiente('S3'),
});
