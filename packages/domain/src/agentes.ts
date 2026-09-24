// Puerto de agentes (System Two). Un agente solo produce una salida cruda; el sistema la
// valida con el esquema común y, si no cumple, la ejecución acaba en `invalid_output`
// sin ningún efecto (I7).

import { z } from 'zod';

export const ACCIONES_AGENTE = ['eco', 'exploration_chat', 'design_proposal'] as const;
export type AccionAgente = (typeof ACCIONES_AGENTE)[number];

/** Tipos de fallo cerrados (docs/investigacion-stack-2026-09-24.md §8). */
export const FAILURE_KINDS = ['infra', 'timeout', 'invalid_output', 'agent_error', 'cancelled', 'stale_knowledge'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export type Uso = {
  tokensEntrada: number;
  tokensSalida: number;
  duracionMs: number;
  costeDeclaradoUsd?: number;
};

export type PeticionAgente = {
  runId: string;
  accion: AccionAgente;
  metodo: { version: string; texto: string };
  /** JSON Schema generado desde el esquema Zod de la acción. */
  esquemaSalida: Record<string, unknown>;
  contexto: { hash: string; contenido: unknown };
  presupuesto: { tiempoMs: number; maxUsd?: number };
  modelo?: string;
  signal?: AbortSignal;
};

export type ResultadoAgente =
  | { estado: 'ok'; salidaCruda: unknown; uso: Uso; eventosCrudos: string; proveedor: string; modelo: string }
  | {
      estado: 'error';
      failureKind: Exclude<FailureKind, 'invalid_output'>;
      mensaje: string;
      uso?: Uso;
      eventosCrudos: string;
      proveedor: string;
      modelo: string;
    };

export interface PuertoAgente {
  readonly proveedor: string;
  ejecutar(peticion: PeticionAgente): Promise<ResultadoAgente>;
}

// Esquemas de salida por acción: la única fuente del contrato (Zod → JSON Schema).

const texto = (max: number) => z.string().trim().min(1).max(max);

export const salidaEco = z.object({ reply: texto(2000) }).strict();

export const salidaExplorationChat = z
  .object({
    reply: texto(6000),
    observaciones: z.array(z.object({ tipo: z.enum(['claim', 'hypothesis', 'unknown']), texto: texto(1000) }).strict()).max(10),
    preguntas: z
      .array(z.object({ pregunta: texto(500), motivo: texto(500), impacto: z.enum(['alto', 'medio', 'bajo']) }).strict())
      .max(5),
    inferencias: z
      .array(z.object({ pregunta_id: z.string().uuid(), conclusion: texto(1500), razonamiento: texto(1500) }).strict())
      .max(5),
    propuestas: z
      .array(
        z.discriminatedUnion('tipo', [
          z
            .object({
              tipo: z.literal('decision'),
              titulo: texto(160),
              contexto: texto(3000),
              decision: texto(3000),
              consecuencias: texto(3000),
            })
            .strict(),
          z.object({ tipo: z.literal('exploracion'), proposito: texto(500) }).strict(),
        ]),
      )
      .max(5),
  })
  .strict();

export const criterioPropuesto = z
  .object({
    titulo: texto(160),
    enunciado: texto(1500),
    verificacion: z.enum(['automatic', 'manual']),
    comprobacion: texto(600),
  })
  .strict();

export const salidaDesignProposal = z
  .object({
    fdr: z
      .object({
        titulo: texto(160),
        objetivo: texto(3000),
        alcance: texto(3000),
        fuera_de_alcance: texto(3000),
        comportamiento: texto(6000),
        criterios: z.array(criterioPropuesto).min(1).max(12),
      })
      .strict(),
  })
  .strict();

export const ESQUEMAS_SALIDA = {
  eco: salidaEco,
  exploration_chat: salidaExplorationChat,
  design_proposal: salidaDesignProposal,
} as const satisfies Record<AccionAgente, z.ZodType>;

export type SalidaAccion<A extends AccionAgente> = z.infer<(typeof ESQUEMAS_SALIDA)[A]>;

export function esquemaJsonDe(accion: AccionAgente): Record<string, unknown> {
  return z.toJSONSchema(ESQUEMAS_SALIDA[accion], { target: 'draft-2020-12' });
}
