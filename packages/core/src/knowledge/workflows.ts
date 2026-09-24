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
import { type AGuardar, guardarEnCache, pasoAplicar, pasoClasificar, rechazarPorError, responderConCache } from './actualizar.ts';
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
      // Si clasificar o aplicar fallan tras sus reintentos, la actualización queda rechazada:
      // nunca se queda en curso bloqueando la frescura.
      try {
        const r = await DBOS.runStep(() => pasoClasificar(serviciosDelMotor(), id, proyectoId), {
          name: 'clasificar',
          ...REINTENTOS,
        });
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

/**
 * Intento de una actualización: cuántas veces ha empezado a clasificarse. Da el id de su flujo,
 * así que un reintento (que la devuelve a la cola) arranca un flujo nuevo.
 */
async function intentoDe(s: Servicios, updateId: string): Promise<number> {
  const r = await s.db
    .selectFrom('events')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('entity_id', '=', updateId)
    .where('command', '=', 'knowledge_update.classify')
    .executeTakeFirst();
  return Number(r?.n ?? 0);
}

// Un flujo por intento: el mismo id no arranca dos veces (DBOS) y un reintento tiene id propio.
registrarArranqueActualizacion(async (updateId, proyectoId) => {
  const intento = await intentoDe(serviciosDelMotor(), updateId);
  await DBOS.startWorkflow(drenarRegistrado, { workflowID: `conocimiento:${updateId}:${intento}`, queueName: cola.name })(
    proyectoId,
  );
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

type Hallazgo = { hallazgo: string; cita: string; estado_epistemico: string; confianza: number; justificacion: string };
type RespuestaInvalida = { cita: string; eleccion: string; motivo: string };

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

type EvaluacionCalculada = {
  propuestaId: string;
  hallazgos: Hallazgo[];
  invalidas: RespuestaInvalida[];
  version: number;
  hash: string;
  /** Solo si todas las respuestas se verificaron: lo inválido no entra en la caché. */
  aGuardar: AGuardar | null;
};

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
    const r = await responderConCache(s.db, s.clasificador, hash, itemsDeIdea(idea, candidatos));
    // Verificación determinista: una respuesta por candidato y con una opción válida. Lo que no
    // se verifica se registra (nunca se filtra en silencio) y no se guarda en la caché.
    const invalidas = motivosDeIdea(candidatos, r.respuestas);
    const erroneas = new Set(invalidas.map((i) => i.cita));
    const epistemico = new Map(grafo.nodos.filter((n) => n.hasta === null).map((n) => [n.ref, n.epistemico]));
    const hallazgos = r.respuestas
      .filter((x) => !erroneas.has(x.id) && x.eleccion !== 'none')
      .map((x) => ({
        hallazgo: x.eleccion,
        cita: x.id,
        estado_epistemico: epistemico.get(x.id) ?? 'desconocido',
        confianza: x.confianza,
        justificacion: x.justificacion,
      }));
    resultado.push({
      propuestaId: p.id,
      hallazgos,
      invalidas,
      version: grafo.version,
      hash,
      aGuardar: invalidas.length === 0 ? r.aGuardar : null,
    });
  }
  return resultado;
}

/** Respuestas que no se verifican: cita que no era candidata, opción desconocida, repetidas o ausentes. */
function motivosDeIdea(candidatos: readonly Candidato[], respuestas: readonly RespuestaChoice[]): RespuestaInvalida[] {
  const invalidas: RespuestaInvalida[] = [];
  const vistas = new Map<string, number>();
  for (const r of respuestas) {
    vistas.set(r.id, (vistas.get(r.id) ?? 0) + 1);
    if (!candidatos.some((c) => c.ref === r.id))
      invalidas.push({ cita: r.id, eleccion: r.eleccion, motivo: 'No era candidata.' });
    else if (!(HALLAZGOS_IDEA as readonly string[]).includes(r.eleccion))
      invalidas.push({ cita: r.id, eleccion: r.eleccion, motivo: 'Opción desconocida.' });
  }
  for (const c of candidatos) {
    const n = vistas.get(c.ref) ?? 0;
    if (n === 0) invalidas.push({ cita: c.ref, eleccion: '', motivo: 'Sin respuesta.' });
    if (n > 1) invalidas.push({ cita: c.ref, eleccion: '', motivo: `${n} respuestas.` });
  }
  return invalidas;
}

export async function registrarEvaluaciones(
  s: Servicios,
  proyectoId: string,
  evaluaciones: EvaluacionCalculada[],
): Promise<void> {
  await guardarEnCache(
    s.db,
    evaluaciones.map((e) => e.aGuardar),
  );
  for (const e of evaluaciones) {
    await ejecutarComando(s, {
      comando: 'idea_assessment.record',
      actor: ACTUALIZADOR,
      proyectoId,
      datos: {
        propuesta_id: e.propuestaId,
        hallazgos: e.hallazgos,
        invalidas: e.invalidas,
        version_grafo: e.version,
        clasificador: s.clasificador.id,
        input_hash: e.hash,
      },
    });
  }
}

/** Si la evaluación falla tras sus reintentos, cada idea sin evaluar queda con el error registrado. */
export async function registrarFalloDeEvaluacion(s: Servicios, loteId: string, proyectoId: string, e: unknown): Promise<void> {
  const sinEvaluar = await s.db
    .selectFrom('proposals')
    .leftJoin('idea_assessments', 'idea_assessments.proposal_id', 'proposals.id')
    .select('proposals.id')
    .where('proposals.batch_id', '=', loteId)
    .where('proposals.type', 'in', ['decision', 'exploracion', 'fdr'])
    .where('idea_assessments.id', 'is', null)
    .execute();
  for (const p of sinEvaluar) {
    await ejecutarComando(s, {
      comando: 'idea_assessment.record',
      actor: ACTUALIZADOR,
      proyectoId,
      datos: {
        propuesta_id: p.id,
        hallazgos: [],
        error: `No se pudo evaluar la idea: ${String(e).slice(0, 1000)}`,
        version_grafo: 0,
        clasificador: s.clasificador.id,
        input_hash: '',
      },
    });
  }
}

async function flujoEvaluar(loteId: string, proyectoId: string): Promise<number> {
  try {
    const evaluaciones = await DBOS.runStep(() => calcularEvaluaciones(serviciosDelMotor(), loteId, proyectoId), {
      name: 'evaluar',
      ...REINTENTOS,
    });
    await DBOS.runStep(() => registrarEvaluaciones(serviciosDelMotor(), proyectoId, evaluaciones), {
      name: 'registrar',
      ...REINTENTOS,
    });
    return evaluaciones.length;
  } catch (e) {
    // Una evaluación fallida no se queda pendiente para siempre: queda registrado el error.
    await DBOS.runStep(() => registrarFalloDeEvaluacion(serviciosDelMotor(), loteId, proyectoId, e), {
      name: 'registrar-fallo',
      ...REINTENTOS,
    });
    return 0;
  }
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
    // Lotes de agentes externos y de ejecuciones (también los paquetes de design_proposal).
    .where((eb) => eb.or([eb('proposal_batches.kind', '=', 'agent'), eb('proposal_batches.run_id', 'is not', null)]))
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
