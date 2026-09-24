// Cargas de las propuestas por tipo: el esquema con el que se validan al crearlas y al
// aceptarlas con cambios. Un agente solo propone; aceptar es siempre de una persona.

import { z } from 'zod';
import { criterioPropuesto } from './agentes.ts';

const texto = (max: number) => z.string().trim().min(1).max(max);

export const referenciaRegistro = z
  .object({ codigo: z.string().regex(/^[A-Z]{3}-[A-Z]{3}-\d{3}$/), version: z.number().int().positive() })
  .strict();

export const cargaDecision = z
  .object({
    titulo: texto(200),
    contexto: texto(5000),
    decision: texto(5000),
    consecuencias: texto(5000),
    dominio: z
      .string()
      .regex(/^[a-z][a-z_]*$/)
      .optional(),
  })
  .strict();

export const cargaExploracion = z.object({ proposito: texto(1000) }).strict();

export const cargaFdr = z
  .object({
    titulo: texto(200),
    objetivo: texto(5000),
    alcance: texto(5000),
    fuera_de_alcance: texto(5000),
    comportamiento: texto(10_000),
    criterios: z.array(criterioPropuesto).min(1).max(12),
    basado_en: referenciaRegistro.optional(),
    dominio: z
      .string()
      .regex(/^[a-z][a-z_]*$/)
      .optional(),
  })
  .strict();

/** Propuesta del sistema de conocimiento: revisar un registro con autoridad (nunca un cambio directo). */
export const cargaRevision = z
  .object({
    registro: referenciaRegistro,
    veredicto: z.enum(['invalidate', 'update', 'add', 'other']),
    motivo: texto(2000),
    cambio: z.object({ tipo: z.string(), id: z.string(), version: z.number().int().nullable() }).strict(),
    confianza: z.number().min(0).max(1),
  })
  .strict();

export const TIPOS_PROPUESTA_AGENTE = ['decision', 'exploracion', 'fdr'] as const;

/** Tipos de propuesta. `registro_importado` y `taxonomia_importada` solo los crea la importación de design/. */
export const CARGAS = {
  decision: cargaDecision,
  exploracion: cargaExploracion,
  fdr: cargaFdr,
  revision: cargaRevision,
  registro_importado: z.object({ documento: z.record(z.string(), z.unknown()), ruta: z.string() }).strict(),
  taxonomia_importada: z.object({ documento: z.record(z.string(), z.unknown()), ruta: z.string() }).strict(),
} as const;

export type TipoPropuesta = keyof typeof CARGAS;
export const TIPOS_PROPUESTA = Object.keys(CARGAS) as TipoPropuesta[];

export function esTipoPropuesta(t: string): t is TipoPropuesta {
  return Object.hasOwn(CARGAS, t);
}

/** Dependencia declarada: el registro sigue con la misma versión vigente. */
export const esquemaDependencia = z
  .object({ tipo: z.literal('record'), id: z.string().uuid(), codigo: z.string(), version: z.number().int().positive() })
  .strict();

export type Dependencia = z.infer<typeof esquemaDependencia>;

export const MAX_PROPUESTAS_AGENTE_EXTERNO = 10;
