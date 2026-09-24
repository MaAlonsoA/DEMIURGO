// Inline engine for tests without DBOS: processes knowledge and idea assessment on the spot,
// right after committing, with the same functions as the durable workflows. Agent runs and
// responses are only recorded (those tests use the durable engine).

import { applyStep, classifyStep, rejectOnError } from '../knowledge/update.ts';
import { calculateEvaluations, pendingFor, registerEvaluations, registerEvaluationFailure } from '../knowledge/workflows.ts';
import type { WorkflowEngine, Services } from '../services.ts';

export type InlineEngine = WorkflowEngine & { runs: string[]; responses: string[] };

export function createInlineEngine(services: () => Services): InlineEngine {
  const runs: string[] = [];
  const responses: string[] = [];
  return {
    runs,
    responses,
    startRun: async (id) => {
      runs.push(id);
    },
    cancelRun: async () => undefined,
    startResponse: async (id) => {
      responses.push(id);
    },
    async startUpdate(_id, projectId) {
      const s = services();
      for (let round = 0; round < 100; round++) {
        const pending = await pendingFor(s, projectId);
        if (pending.length === 0) return;
        for (const id of pending) {
          try {
            await applyStep(s, id, projectId, await classifyStep(s, id, projectId));
          } catch (e) {
            await rejectOnError(s, id, projectId, e);
          }
        }
      }
    },
    async startEvaluation(batchId, projectId) {
      const s = services();
      try {
        await registerEvaluations(s, projectId, await calculateEvaluations(s, batchId, projectId));
      } catch (e) {
        await registerEvaluationFailure(s, batchId, projectId, e);
      }
    },
  };
}
