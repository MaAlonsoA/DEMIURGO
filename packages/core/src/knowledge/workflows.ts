// Durable knowledge workflows: "Update knowledge" runs as a serial queue (one update after
// another, in order), plus the idea assessment for each agent batch.

import { DBOS, WorkflowQueue } from '@dbos-inc/dbos-sdk';
import {
  IDEA_QUESTION,
  type Candidate,
  IDEA_FINDINGS,
  type ItemChoice,
  type ChoiceResponse,
  ideaCandidates,
  fingerprint,
} from '@demiurgo/domain';
import { executeCommand } from '../bus/bus.ts';
import type { Services } from '../services.ts';
import { registerUpdateStarter, registerAssessmentStarter, registerReconciler, engineServices } from '../engine/registry.ts';
import { UPDATER } from './commands.ts';
import { type ToSave, saveToCache, applyStep, classifyStep, rejectOnError, respondWithCache } from './update.ts';
import { loadGraph } from './graph-pg.ts';

const RETRIES = { retriesAllowed: true, maxAttempts: 3, intervalSeconds: 1 } as const;

// One update at a time: the graph advances in the order of authority events.
const queue = new WorkflowQueue('demiurgo-knowledge', { globalConcurrency: 1, minPollingIntervalMs: 100 });

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
      // If classify or apply fail after their retries, the update is rejected: it never stays
      // in progress blocking freshness.
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
 * Attempt number for an update: how many times it has started classifying. It drives the
 * workflow id, so a retry (which sends the update back to the queue) starts a new workflow.
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

// One workflow per attempt: the same id never starts twice (DBOS) and a retry has its own id.
registerUpdateStarter(async (updateId, projectId) => {
  const attempt = await attemptOf(engineServices(), updateId);
  await DBOS.startWorkflow(registeredDrain, { workflowID: `knowledge:${updateId}:${attempt}`, queueName: queue.name })(projectId);
});

/** Waits for a project's knowledge to be up to date (tests and CLI). */
export async function waitForKnowledge(s: Services, projectId: string, maxMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if ((await pendingFor(s, projectId)).length === 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Knowledge did not become up to date in time.');
}

// Idea assessment (§7.7): each agent proposal is compared against the knowledge.

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
    question: IDEA_QUESTION,
    options: IDEA_FINDINGS,
  }));
}

type CalculatedAssessment = {
  proposalId: string;
  findings: Finding[];
  invalid: InvalidResponse[];
  version: number;
  hash: string;
  /** Only if every response was verified: invalid ones do not enter the cache. */
  toSave: ToSave | null;
};

export async function calculateAssessments(s: Services, batchId: string, projectId: string): Promise<CalculatedAssessment[]> {
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
    // Deterministic verification: one response per candidate, with a valid option. Whatever
    // fails verification is recorded (never silently dropped) and is not saved to the cache.
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

/** Responses that fail verification: a citation that was not a candidate, an unknown option, or duplicate or missing responses. */
function reasonsForIdea(candidates: readonly Candidate[], responses: readonly ChoiceResponse[]): InvalidResponse[] {
  const invalid: InvalidResponse[] = [];
  const visited = new Map<string, number>();
  for (const r of responses) {
    visited.set(r.id, (visited.get(r.id) ?? 0) + 1);
    if (!candidates.some((c) => c.ref === r.id)) invalid.push({ citation: r.id, choice: r.choice, reason: 'Not a candidate.' });
    else if (!(IDEA_FINDINGS as readonly string[]).includes(r.choice))
      invalid.push({ citation: r.id, choice: r.choice, reason: 'Unknown option.' });
  }
  for (const c of candidates) {
    const n = visited.get(c.ref) ?? 0;
    if (n === 0) invalid.push({ citation: c.ref, choice: '', reason: 'No response.' });
    if (n > 1) invalid.push({ citation: c.ref, choice: '', reason: `${n} responses.` });
  }
  return invalid;
}

export async function recordAssessments(s: Services, projectId: string, assessments: CalculatedAssessment[]): Promise<void> {
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

/** If the assessment fails after its retries, each unassessed idea is left with the error recorded. */
export async function recordAssessmentFailure(s: Services, batchId: string, projectId: string, e: unknown): Promise<void> {
  const unassessed = await s.db
    .selectFrom('proposals')
    .leftJoin('idea_assessments', 'idea_assessments.proposal_id', 'proposals.id')
    .select('proposals.id')
    .where('proposals.batch_id', '=', batchId)
    .where('proposals.type', 'in', ['decision', 'exploration', 'fdr'])
    .where('idea_assessments.id', 'is', null)
    .execute();
  for (const p of unassessed) {
    await executeCommand(s, {
      command: 'idea_assessment.record',
      actor: UPDATER,
      projectId,
      data: {
        proposal_id: p.id,
        findings: [],
        error: `Could not assess the idea: ${String(e).slice(0, 1000)}`,
        graph_version: 0,
        classifier: s.classifier.id,
        input_hash: '',
      },
    });
  }
}

async function assessWorkflow(batchId: string, projectId: string): Promise<number> {
  try {
    const assessments = await DBOS.runStep(() => calculateAssessments(engineServices(), batchId, projectId), {
      name: 'assess',
      ...RETRIES,
    });
    await DBOS.runStep(() => recordAssessments(engineServices(), projectId, assessments), {
      name: 'register',
      ...RETRIES,
    });
    return assessments.length;
  } catch (e) {
    // A failed assessment does not stay pending forever: the error gets recorded.
    await DBOS.runStep(() => recordAssessmentFailure(engineServices(), batchId, projectId, e), {
      name: 'register-failure',
      ...RETRIES,
    });
    return 0;
  }
}

const assessRegistered = DBOS.registerWorkflow(assessWorkflow, { name: 'demiurgo.ideas' });

registerAssessmentStarter(async (batchId, projectId) => {
  await DBOS.startWorkflow(assessRegistered, { workflowID: `ideas:${batchId}` })(batchId, projectId);
});

// On startup: updates without a workflow and agent batches without an assessment (the gap between confirm and start).
registerReconciler(async (s) => {
  const pending = await s.db
    .selectFrom('knowledge_updates')
    .select(['id', 'project_id'])
    .where('state', 'in', ['queued', 'classifying', 'verifying'])
    .execute();
  for (const u of pending) await s.engine.startUpdate(u.id, u.project_id);
  const unassessed = await s.db
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .leftJoin('idea_assessments', 'idea_assessments.proposal_id', 'proposals.id')
    .select(['proposal_batches.id as batchId', 'proposal_batches.project_id as projectId'])
    // Batches from external agents and from runs (also design_proposal packages).
    .where((eb) => eb.or([eb('proposal_batches.kind', '=', 'agent'), eb('proposal_batches.run_id', 'is not', null)]))
    .where('proposals.type', 'in', ['decision', 'exploration', 'fdr'])
    .where('idea_assessments.id', 'is', null)
    .groupBy(['proposal_batches.id', 'proposal_batches.project_id'])
    .execute();
  for (const l of unassessed) await s.engine.startAssessment(l.batchId, l.projectId);
});

/** Waits for a batch's idea assessment (tests). */
export async function waitForAssessment(batchId: string): Promise<void> {
  await DBOS.retrieveWorkflow(`ideas:${batchId}`).getResult();
}
