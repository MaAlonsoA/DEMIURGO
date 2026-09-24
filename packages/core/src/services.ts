// Injected dependencies of the core. No global state outside here.

import type { Classifier, AgentPort } from '@demiurgo/domain';
import type { Db } from './db/connection.ts';

export type WorkflowEngine = {
  startRun(runId: string, projectId: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  startUpdate(updateId: string, projectId: string): Promise<void>;
  startEvaluation(batchId: string, projectId: string): Promise<void>;
  startResponse(messageId: string, projectId: string, explorationId: string, questionId?: string): Promise<void>;
};

export type Logger = {
  info(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
};

export type Services = {
  db: Db;
  clock: () => Date;
  agent: AgentPort;
  classifier: Classifier;
  engine: WorkflowEngine;
  record: Logger;
};

export const silentLogger: Logger = { info: () => undefined, error: () => undefined };

export const consoleLogger: Logger = {
  info: (m, d) => console.log(JSON.stringify({ level: 'info', m, ...d })),
  error: (m, d) => console.error(JSON.stringify({ level: 'error', m, ...d })),
};

/** Engine that runs nothing: for bus tests without durable workflows. */
export function inertEngine(): WorkflowEngine & {
  runs: string[];
  updates: string[];
  assessments: string[];
  responses: string[];
} {
  const runs: string[] = [];
  const updates: string[] = [];
  const assessments: string[] = [];
  const responses: string[] = [];
  return {
    runs,
    updates,
    assessments,
    responses,
    startResponse: async (id) => {
      responses.push(id);
    },
    startEvaluation: async (id) => {
      assessments.push(id);
    },
    startRun: async (id) => {
      runs.push(id);
    },
    cancelRun: async () => undefined,
    startUpdate: async (id) => {
      updates.push(id);
    },
  };
}
