// Motor en línea para pruebas sin DBOS: procesa el conocimiento y la evaluación de ideas en el
// acto, tras confirmar, con las mismas funciones que los flujos durables. Las ejecuciones de
// agentes y las respuestas solo se anotan (esas pruebas usan el motor durable).

import { pasoAplicar, pasoClasificar, rechazarPorError } from '../conocimiento/actualizar.ts';
import { calcularEvaluaciones, pendientesDe, registrarEvaluaciones } from '../conocimiento/flujos.ts';
import type { MotorFlujos, Servicios } from '../servicios.ts';

export type MotorEnLinea = MotorFlujos & { runs: string[]; respuestas: string[] };

export function crearMotorEnLinea(servicios: () => Servicios): MotorEnLinea {
  const runs: string[] = [];
  const respuestas: string[] = [];
  return {
    runs,
    respuestas,
    iniciarRun: async (id) => {
      runs.push(id);
    },
    cancelarRun: async () => undefined,
    iniciarRespuesta: async (id) => {
      respuestas.push(id);
    },
    async iniciarActualizacion(_id, proyectoId) {
      const s = servicios();
      for (let ronda = 0; ronda < 100; ronda++) {
        const pendientes = await pendientesDe(s, proyectoId);
        if (pendientes.length === 0) return;
        for (const id of pendientes) {
          try {
            await pasoAplicar(s, id, proyectoId, await pasoClasificar(s, id, proyectoId));
          } catch (e) {
            await rechazarPorError(s, id, proyectoId, e);
          }
        }
      }
    },
    async iniciarEvaluacion(loteId, proyectoId) {
      const s = servicios();
      await registrarEvaluaciones(s, proyectoId, await calcularEvaluaciones(s, loteId, proyectoId));
    },
  };
}
