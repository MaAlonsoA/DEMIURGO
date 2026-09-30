// Injected dependencies of the core. No global state outside here.

import type { Classifier } from '@demiurgo/domain';
import type { Db } from './db/connection.ts';
import type { Observer } from './observe/observer.ts';
import type { ProviderRegistry } from './providers/registry.ts';

export type WorkflowEngine = {
  startRun(runId: string, projectId: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  startUpdate(updateId: string, projectId: string): Promise<void>;
  startAssessment(batchId: string, projectId: string): Promise<void>;
  /** The durable GitHub build of a build request (one workflow per attempt). */
  startBuild(buildRequestId: string, projectId: string, attempt: number): Promise<void>;
  startResponse(messageId: string, projectId: string, explorationId: string, questionId?: string, agent?: string): Promise<void>;
};

export type Logger = {
  info(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
};

export type Services = {
  db: Db;
  clock: () => Date;
  /** The engines this process can run: each run resolves its own (FDR-AGE-002). */
  providers: ProviderRegistry;
  /**
   * The knowledge classifier of a project: the engine assigned to knowledge_classifier. `strong`
   * asks for the reviewer's engine directly: finding contradictions needs its judgment, which the
   * quick engine does not have.
   */
  classifierFor(projectId: string, use?: 'strong'): Promise<Classifier>;
  /** Where conversations with a provider session keep their stable folder. */
  agentSessionsDir: string;
  engine: WorkflowEngine;
  logger: Logger;
  /** Observation notes (spans and log records); never throws, off with `DEMIURGO_OBSERVE=off`. */
  observer: Observer;
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
  builds: string[];
} {
  const runs: string[] = [];
  const updates: string[] = [];
  const assessments: string[] = [];
  const responses: string[] = [];
  const builds: string[] = [];
  return {
    builds,
    startBuild: async (id, _p, attempt) => {
      builds.push(`${id}:${attempt}`);
    },
    runs,
    updates,
    assessments,
    responses,
    startResponse: async (id) => {
      responses.push(id);
    },
    startAssessment: async (id) => {
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
