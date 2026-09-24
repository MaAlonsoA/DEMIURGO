// Flujos durables del conocimiento: «Actualizar conocimiento» en una cola en serie (una
// actualización tras otra, en orden) y la evaluación de ideas de cada lote de un agente.

import { DBOS, WorkflowQueue } from '@dbos-inc/dbos-sdk';
import {
  type Candidato,
  HALLAZGOS_IDEA,
  type ItemChoice,
  type RespuestaChoice,
  candidatosDeIdea,
  huella,
} from '@demiurgo/domain';
import { ejecutarComando } from '../bus/bus.ts';
import type { Servicios } from '../servicios.ts';
import {
  registrarArranqueActualizacion,
  registrarArranqueEvaluacion,
  registrarConciliador,
  serviciosDelMotor,
} from '../motor/registro.ts';
import { ACTUALIZADOR } from './comandos.ts';
import { pasoAplicar, pasoClasificar, rechazarPorError, responderConCache } from './actualizar.ts';
import { cargarGrafo } from './grafo-pg.ts';

const REINTENTOS = { retriesAllowed: true, maxAttempts: 3, intervalSeconds: 1 } as const;

// Una sola actualización a la vez: el grafo avanza en el orden de los eventos de autoridad.
const cola = new WorkflowQueue('demiurgo-conocimiento', { globalConcurrency: 1, minPollingIntervalMs: 100 });

export async function pendientesDe(s: Servicios, proyectoId: string): Promise<string[]> {
  const filas = await s.db
    .selectFrom('knowledge_updates')
    .select('id')
    .where('project_id', '=', proyectoId)
    .where('state', 'in', ['queued', 'classifying', 'verifying'])
    .orderBy('trigger_seq')
    .orderBy('id')
    .execute();
  return filas.map((f) => f.id);
}

async function flujoDrenar(proyectoId: string): Promise<number> {
  let procesadas = 0;
  for (let ronda = 0; ronda < 100; ronda++) {
    const pendientes = await DBOS.runStep(() => pendientesDe(serviciosDelMotor(), proyectoId), { name: 'pendientes' });
    if (pendientes.length === 0) break;
    for (const id of pendientes) {
      const r = await DBOS.runStep(() => pasoClasificar(serviciosDelMotor(), id, proyectoId), {
        name: 'clasificar',
        ...REINTENTOS,
      });
      try {
        await DBOS.runStep(() => pasoAplicar(serviciosDelMotor(), id, proyectoId, r), { name: 'aplicar', ...REINTENTOS });
      } catch (e) {
        await DBOS.runStep(() => rechazarPorError(serviciosDelMotor(), id, proyectoId, e), { name: 'rechazar', ...REINTENTOS });
      }
      procesadas++;
    }
  }
  return procesadas;
}

const drenarRegistrado = DBOS.registerWorkflow(flujoDrenar, { name: 'demiurgo.conocimiento' });

registrarArranqueActualizacion(async (updateId, proyectoId) => {
  await DBOS.startWorkflow(drenarRegistrado, { workflowID: `conocimiento:${updateId}`, queueName: cola.name })(proyectoId);
});

/** Espera a que el conocimiento de un proyecto esté al día (pruebas y CLI). */
export async function esperarConocimiento(s: Servicios, proyectoId: string, maxMs = 30_000): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < maxMs) {
    if ((await pendientesDe(s, proyectoId)).length === 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('El conocimiento no se puso al día a tiempo.');
}

// Evaluación de ideas (§7.7): cada propuesta de un agente se compara con el conocimiento.

type Hallazgo = { hallazgo: string; cita: string; confianza: number; justificacion: string };

function textoDeIdea(tipo: string, carga: Record<string, unknown>): string {
  const t = (k: string): string => {
    const v = carga[k];
    return typeof v === 'string' ? v : '';
  };
  if (tipo === 'decision') return `${t('titulo')}. ${t('decision')} ${t('contexto')}`;
  if (tipo === 'exploracion') return t('proposito');
  if (tipo === 'fdr') return `${t('titulo')}. ${t('objetivo')} ${t('comportamiento')}`;
  return '';
}

function itemsDeIdea(idea: string, candidatos: readonly Candidato[]): ItemChoice[] {
  return candidatos.map((c) => ({
    id: c.ref,
    estado: { tarea: 'idea', idea: { texto: idea }, nodo: { ref: c.ref, tipo: c.tipo, titulo: c.etiqueta, texto: c.texto } },
    pregunta:
      '¿Qué relación tiene la idea con este conocimiento: la duplica, lo contradice, es incoherente, se relaciona o ninguna?',
    opciones: HALLAZGOS_IDEA,
  }));
}

type EvaluacionCalculada = { propuestaId: string; hallazgos: Hallazgo[]; version: number; hash: string };

export async function calcularEvaluaciones(s: Servicios, loteId: string, proyectoId: string): Promise<EvaluacionCalculada[]> {
  const propuestas = await s.db
    .selectFrom('proposals')
    .select(['id', 'type', 'payload'])
    .where('batch_id', '=', loteId)
    .where('type', 'in', ['decision', 'exploracion', 'fdr'])
    .orderBy('position')
    .execute();
  const grafo = await cargarGrafo(s.db, proyectoId);
  const resultado: EvaluacionCalculada[] = [];
  for (const p of propuestas) {
    const idea = textoDeIdea(p.type, p.payload as Record<string, unknown>);
    const candidatos = candidatosDeIdea(grafo, idea);
    const hash = huella({
      clasificador: s.clasificador.id,
      idea,
      candidatos: candidatos.map((c) => ({ ref: c.ref, texto: c.texto })),
    });
    const { respuestas } = await responderConCache(s.db, s.clasificador, hash, itemsDeIdea(idea, candidatos));
    // Verificación determinista: una respuesta por candidato y con una opción válida.
    const validas = respuestas.filter(
      (r: RespuestaChoice) =>
        candidatos.some((c) => c.ref === r.id) && (HALLAZGOS_IDEA as readonly string[]).includes(r.eleccion),
    );
    const hallazgos = validas
      .filter((r) => r.eleccion !== 'none')
      .map((r) => ({ hallazgo: r.eleccion, cita: r.id, confianza: r.confianza, justificacion: r.justificacion }));
    resultado.push({ propuestaId: p.id, hallazgos, version: grafo.version, hash });
  }
  return resultado;
}

export async function registrarEvaluaciones(
  s: Servicios,
  proyectoId: string,
  evaluaciones: EvaluacionCalculada[],
): Promise<void> {
  for (const e of evaluaciones) {
    await ejecutarComando(s, {
      comando: 'idea_assessment.record',
      actor: ACTUALIZADOR,
      proyectoId,
      datos: {
        propuesta_id: e.propuestaId,
        hallazgos: e.hallazgos,
        version_grafo: e.version,
        clasificador: s.clasificador.id,
        input_hash: e.hash,
      },
    });
  }
}

async function flujoEvaluar(loteId: string, proyectoId: string): Promise<number> {
  const evaluaciones = await DBOS.runStep(() => calcularEvaluaciones(serviciosDelMotor(), loteId, proyectoId), {
    name: 'evaluar',
    ...REINTENTOS,
  });
  await DBOS.runStep(() => registrarEvaluaciones(serviciosDelMotor(), proyectoId, evaluaciones), {
    name: 'registrar',
    ...REINTENTOS,
  });
  return evaluaciones.length;
}

const evaluarRegistrado = DBOS.registerWorkflow(flujoEvaluar, { name: 'demiurgo.ideas' });

registrarArranqueEvaluacion(async (loteId, proyectoId) => {
  await DBOS.startWorkflow(evaluarRegistrado, { workflowID: `ideas:${loteId}` })(loteId, proyectoId);
});

// Al arrancar: actualizaciones sin flujo y lotes de agentes sin evaluar (corte entre confirmar y arrancar).
registrarConciliador(async (s) => {
  const pendientes = await s.db
    .selectFrom('knowledge_updates')
    .select(['id', 'project_id'])
    .where('state', 'in', ['queued', 'classifying', 'verifying'])
    .execute();
  for (const u of pendientes) await s.motor.iniciarActualizacion(u.id, u.project_id);
  const sinEvaluar = await s.db
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .leftJoin('idea_assessments', 'idea_assessments.proposal_id', 'proposals.id')
    .select(['proposal_batches.id as loteId', 'proposal_batches.project_id as proyectoId'])
    .where('proposal_batches.kind', '=', 'agent')
    .where('proposals.type', 'in', ['decision', 'exploracion', 'fdr'])
    .where('idea_assessments.id', 'is', null)
    .groupBy(['proposal_batches.id', 'proposal_batches.project_id'])
    .execute();
  for (const l of sinEvaluar) await s.motor.iniciarEvaluacion(l.loteId, l.proyectoId);
});

/** Espera la evaluación de las ideas de un lote (pruebas). */
export async function esperarEvaluacion(loteId: string): Promise<void> {
  await DBOS.retrieveWorkflow(`ideas:${loteId}`).getResult();
}
