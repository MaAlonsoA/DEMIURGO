// Dependencias inyectadas del núcleo. Nada de estado global fuera de aquí.

import type { Clasificador, PuertoAgente } from '@demiurgo/domain';
import type { Bd } from './db/conexion.ts';

export type MotorFlujos = {
  iniciarRun(runId: string, proyectoId: string): Promise<void>;
  cancelarRun(runId: string): Promise<void>;
  iniciarActualizacion(updateId: string, proyectoId: string): Promise<void>;
  iniciarEvaluacion(loteId: string, proyectoId: string): Promise<void>;
  iniciarRespuesta(mensajeId: string, proyectoId: string, exploracionId: string, preguntaId?: string): Promise<void>;
};

export type Registro = {
  info(mensaje: string, datos?: Record<string, unknown>): void;
  error(mensaje: string, datos?: Record<string, unknown>): void;
};

export type Servicios = {
  db: Bd;
  reloj: () => Date;
  agente: PuertoAgente;
  clasificador: Clasificador;
  motor: MotorFlujos;
  registro: Registro;
};

export const registroSilencioso: Registro = { info: () => undefined, error: () => undefined };

export const registroConsola: Registro = {
  info: (m, d) => console.log(JSON.stringify({ nivel: 'info', m, ...d })),
  error: (m, d) => console.error(JSON.stringify({ nivel: 'error', m, ...d })),
};

/** Motor que no ejecuta nada: para pruebas del bus sin flujos durables. */
export function motorInerte(): MotorFlujos & {
  runs: string[];
  actualizaciones: string[];
  evaluaciones: string[];
  respuestas: string[];
} {
  const runs: string[] = [];
  const actualizaciones: string[] = [];
  const evaluaciones: string[] = [];
  const respuestas: string[] = [];
  return {
    runs,
    actualizaciones,
    evaluaciones,
    respuestas,
    iniciarRespuesta: async (id) => {
      respuestas.push(id);
    },
    iniciarEvaluacion: async (id) => {
      evaluaciones.push(id);
    },
    iniciarRun: async (id) => {
      runs.push(id);
    },
    cancelarRun: async () => undefined,
    iniciarActualizacion: async (id) => {
      actualizaciones.push(id);
    },
  };
}
