// Flujos durables del conocimiento: «Actualizar conocimiento» en una cola en serie (una
// actualización tras otra, en orden) y la evaluación de ideas de cada lote de un agente.

import { DBOS, WorkflowQueue } from '@dbos-inc/dbos-sdk';
import {
  type Candidate,
  IDEA_FINDINGS,
  type ItemChoice,
  type ChoiceResponse,
  ideaCandidates,
  fingerprint,
} from '@demiurgo/domain';
import { executeCommand } from '../bus/bus.ts';
import type { Services } from '../services.ts';
import {
  registerUpdateStarter,
  registerAssessmentStarter,
  registerReconciler,
  engineServices,
} from '../engine/registry.ts';
import { UPDATER } from './commands.ts';
import { type ToSave, saveToCache, applyStep, classifyStep, rejectOnError, respondWithCache } from './update.ts';
import { loadGraph } from './graph-pg.ts';

const RETRIES = { retriesAllowed: true, maxAttempts: 3, intervalSeconds: 1 } as const;

// Una sola actualización a la vez: el grafo avanza en el orden de los eventos de autoridad.
const queue = new WorkflowQueue('demiurgo-conocimiento', { globalConcurrency: 1, minPollingIntervalMs: 100 });

export async function pendingFor(s: Services, projectId: string): Promise<string[]> {
  const rows = await s.db
    .selectFrom('knowledge_updates')
    .select('id')
    .where('project_id', '=', projectId)
    .where('state', 'in', ['queued', 'classifying', 'verifying'])
    .orderBy('trigger_seq')
    .orderBy('id')
    .execute();
  return rows.map((f) => f.id);
}

async function drainWorkflow(projectId: string): Promise<number> {
  let processed = 0;
  for (let round = 0; round < 100; round++) {
    const pending = await DBOS.runStep(() => pendingFor(engineServices(), projectId), { name: 'pending' });
    if (pending.length === 0) break;
    for (const id of pending) {
      // Si clasificar o aplicar fallan tras sus reintentos, la actualización queda rechazada:
      // nunca se queda en curso bloqueando la frescura.
      try {
        const r = await DBOS.runStep(() => classifyStep(engineServices(), id, projectId), {
          name: 'classify',
          ...RETRIES,
        });
        await DBOS.runStep(() => applyStep(engineServices(), id, projectId, r), { name: 'apply', ...RETRIES });
      } catch (e) {
        await DBOS.runStep(() => rejectOnError(engineServices(), id, projectId, e), { name: 'reject', ...RETRIES });
      }
      processed++;
    }
  }
  return processed;
}

const registeredDrain = DBOS.registerWorkflow(drainWorkflow, { name: 'demiurgo.knowledge' });

/**
 * Intento de una actualización: cuántas veces ha empezado a clasificarse. Da el id de su flujo,
 * así que un reintento (que la devuelve a la cola) arranca un flujo nuevo.
 */
async function attemptOf(s: Services, updateId: string): Promise<number> {
  const r = await s.db
    .selectFrom('events')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('entity_id', '=', updateId)
    .where('command', '=', 'knowledge_update.classify')
    .executeTakeFirst();
  return Number(r?.n ?? 0);
}

// Un flujo por intento: el mismo id no arranca dos veces (DBOS) y un reintento tiene id propio.
registerUpdateStarter(async (updateId, projectId) => {
  const attempt = await attemptOf(engineServices(), updateId);
  await DBOS.startWorkflow(registeredDrain, { workflowID: `conocimiento:${updateId}:${attempt}`, queueName: queue.name })(
    projectId,
  );
});

/** Espera a que el conocimiento de un proyecto esté al día (pruebas y CLI). */
export async function waitForKnowledge(s: Services, projectId: string, maxMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if ((await pendingFor(s, projectId)).length === 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('El conocimiento no se puso al día a tiempo.');
}

// Evaluación de ideas (§7.7): cada propuesta de un agente se compara con el conocimiento.

type Finding = { finding: string; citation: string; epistemic_status: string; confidence: number; justification: string };
type InvalidResponse = { citation: string; choice: string; reason: string };

function textOfIdea(type: string, payload: Record<string, unknown>): string {
  const t = (k: string): string => {
    const v = payload[k];
    return typeof v === 'string' ? v : '';
  };
  if (type === 'decision') return `${t('title')}. ${t('decision')} ${t('context')}`;
  if (type === 'exploration') return t('purpose');
  if (type === 'fdr') return `${t('title')}. ${t('goal')} ${t('behavior')}`;
  return '';
}

function itemsForIdea(idea: string, candidates: readonly Candidate[]): ItemChoice[] {
  return candidates.map((c) => ({
    id: c.ref,
    state: { task: 'idea', idea: { text: idea }, node: { ref: c.ref, type: c.type, title: c.label, text: c.text } },
    question:
      '¿Qué relación tiene la idea con este conocimiento: la duplica, lo contradice, es incoherente, se relaciona o ninguna?',
    options: IDEA_FINDINGS,
  }));
}

type CalculatedAssessment = {
  proposalId: string;
  findings: Finding[];
  invalid: InvalidResponse[];
  version: number;
  hash: string;
  /** Solo si todas las respuestas se verificaron: lo inválido no entra en la caché. */
  toSave: ToSave | null;
};

export async function calculateEvaluations(s: Services, batchId: string, projectId: string): Promise<CalculatedAssessment[]> {
  const proposals = await s.db
    .selectFrom('proposals')
    .select(['id', 'type', 'payload'])
    .where('batch_id', '=', batchId)
    .where('type', 'in', ['decision', 'exploration', 'fdr'])
    .orderBy('position')
    .execute();
  const graph = await loadGraph(s.db, projectId);
  const result: CalculatedAssessment[] = [];
  for (const p of proposals) {
    const idea = textOfIdea(p.type, p.payload as Record<string, unknown>);
    const candidates = ideaCandidates(graph, idea);
    const hash = fingerprint({
      classifier: s.classifier.id,
      idea,
      candidates: candidates.map((c) => ({ ref: c.ref, text: c.text })),
    });
    const r = await respondWithCache(s.db, s.classifier, hash, itemsForIdea(idea, candidates));
    // Verificación determinista: una respuesta por candidato y con una opción válida. Lo que no
    // se verifica se registra (nunca se filtra en silencio) y no se guarda en la caché.
    const invalid = reasonsForIdea(candidates, r.responses);
    const faulty = new Set(invalid.map((i) => i.citation));
    const epistemic = new Map(graph.nodes.filter((n) => n.until === null).map((n) => [n.ref, n.epistemic]));
    const findings = r.responses
      .filter((x) => !faulty.has(x.id) && x.choice !== 'none')
      .map((x) => ({
        finding: x.choice,
        citation: x.id,
        epistemic_status: epistemic.get(x.id) ?? 'unknown',
        confidence: x.confidence,
        justification: x.justification,
      }));
    result.push({
      proposalId: p.id,
      findings,
      invalid,
      version: graph.version,
      hash,
      toSave: invalid.length === 0 ? r.toSave : null,
    });
  }
  return result;
}

/** Respuestas que no se verifican: cita que no era candidata, opción desconocida, repetidas o ausentes. */
function reasonsForIdea(candidates: readonly Candidate[], responses: readonly ChoiceResponse[]): InvalidResponse[] {
  const invalid: InvalidResponse[] = [];
  const visited = new Map<string, number>();
  for (const r of responses) {
    visited.set(r.id, (visited.get(r.id) ?? 0) + 1);
    if (!candidates.some((c) => c.ref === r.id))
      invalid.push({ citation: r.id, choice: r.choice, reason: 'No era candidata.' });
    else if (!(IDEA_FINDINGS as readonly string[]).includes(r.choice))
      invalid.push({ citation: r.id, choice: r.choice, reason: 'Opción desconocida.' });
  }
  for (const c of candidates) {
    const n = visited.get(c.ref) ?? 0;
    if (n === 0) invalid.push({ citation: c.ref, choice: '', reason: 'Sin respuesta.' });
    if (n > 1) invalid.push({ citation: c.ref, choice: '', reason: `${n} respuestas.` });
  }
  return invalid;
}

export async function registerEvaluations(
  s: Services,
  projectId: string,
  assessments: CalculatedAssessment[],
): Promise<void> {
  await saveToCache(
    s.db,
    assessments.map((e) => e.toSave),
  );
  for (const e of assessments) {
    await executeCommand(s, {
      command: 'idea_assessment.record',
      actor: UPDATER,
      projectId,
      data: {
        proposal_id: e.proposalId,
        findings: e.findings,
        invalid: e.invalid,
        graph_version: e.version,
        classifier: s.classifier.id,
        input_hash: e.hash,
      },
    });
  }
}

/** Si la evaluación falla tras sus reintentos, cada idea sin evaluar queda con el error registrado. */
export async function registerEvaluationFailure(s: Services, batchId: string, projectId: string, e: unknown): Promise<void> {
  const unevaluated = await s.db
    .selectFrom('proposals')
    .leftJoin('idea_assessments', 'idea_assessments.proposal_id', 'proposals.id')
    .select('proposals.id')
    .where('proposals.batch_id', '=', batchId)
    .where('proposals.type', 'in', ['decision', 'exploration', 'fdr'])
    .where('idea_assessments.id', 'is', null)
    .execute();
  for (const p of unevaluated) {
    await executeCommand(s, {
      command: 'idea_assessment.record',
      actor: UPDATER,
      projectId,
      data: {
        proposal_id: p.id,
        findings: [],
        error: `No se pudo evaluar la idea: ${String(e).slice(0, 1000)}`,
        graph_version: 0,
        classifier: s.classifier.id,
        input_hash: '',
      },
    });
  }
}

async function assessWorkflow(batchId: string, projectId: string): Promise<number> {
  try {
    const assessments = await DBOS.runStep(() => calculateEvaluations(engineServices(), batchId, projectId), {
      name: 'assess',
      ...RETRIES,
    });
    await DBOS.runStep(() => registerEvaluations(engineServices(), projectId, assessments), {
      name: 'register',
      ...RETRIES,
    });
    return assessments.length;
  } catch (e) {
    // Una evaluación fallida no se queda pendiente para siempre: queda registrado el error.
    await DBOS.runStep(() => registerEvaluationFailure(engineServices(), batchId, projectId, e), {
      name: 'registrar-fallo',
      ...RETRIES,
    });
    return 0;
  }
}

const assessRegistered = DBOS.registerWorkflow(assessWorkflow, { name: 'demiurgo.ideas' });

registerAssessmentStarter(async (batchId, projectId) => {
  await DBOS.startWorkflow(assessRegistered, { workflowID: `ideas:${batchId}` })(batchId, projectId);
});

// Al arrancar: actualizaciones sin flujo y lotes de agentes sin evaluar (corte entre confirmar y arrancar).
registerReconciler(async (s) => {
  const pending = await s.db
    .selectFrom('knowledge_updates')
    .select(['id', 'project_id'])
    .where('state', 'in', ['queued', 'classifying', 'verifying'])
    .execute();
  for (const u of pending) await s.engine.startUpdate(u.id, u.project_id);
  const unevaluated = await s.db
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .leftJoin('idea_assessments', 'idea_assessments.proposal_id', 'proposals.id')
    .select(['proposal_batches.id as batchId', 'proposal_batches.project_id as projectId'])
    // Lotes de agentes externos y de ejecuciones (también los paquetes de design_proposal).
    .where((eb) => eb.or([eb('proposal_batches.kind', '=', 'agent'), eb('proposal_batches.run_id', 'is not', null)]))
    .where('proposals.type', 'in', ['decision', 'exploration', 'fdr'])
    .where('idea_assessments.id', 'is', null)
    .groupBy(['proposal_batches.id', 'proposal_batches.project_id'])
    .execute();
  for (const l of unevaluated) await s.engine.startEvaluation(l.batchId, l.projectId);
});

/** Espera la evaluación de las ideas de un lote (pruebas). */
export async function waitForEvaluation(batchId: string): Promise<void> {
  await DBOS.retrieveWorkflow(`ideas:${batchId}`).getResult();
}
