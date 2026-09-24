// Core test environment: ephemeral database + services with a simulated agent.

import type { Classifier, AgentPort } from '@demiurgo/domain';
import { afterAll, beforeAll } from 'vitest';
import { createSimulatedAgent } from '../../src/agents/simulated.ts';
import { type Connection, connect } from '../../src/db/connection.ts';
import { type StartedEngine, startEngine } from '../../src/engine/engine.ts';
import { createSimulatedClassifier } from '../../src/classifier/simulated.ts';
import { createInlineEngine } from '../../src/engine/inline.ts';
import { type WorkflowEngine, type Services, silentLogger } from '../../src/services.ts';
import { useEphemeralDatabase } from './ephemeral-db.ts';
import { classifierNotConfigured } from './null-classifier.ts';

export { classifierNotConfigured };

export type Environment = {
  services: Services;
  connection: Connection;
  url: string;
  engine: WorkflowEngine;
};

type Options = {
  /** Starts DBOS on the ephemeral database; otherwise, the engine is inert. */
  durable?: boolean;
  agent?: () => AgentPort;
  classifier?: () => Classifier;
  /** Assigns every agent to the simulated provider (true by default). */
  seedAssignments?: boolean;
};

/** Registers, for the test file, an ephemeral database and the core services. */
export function useEnvironment(options: Options = {}): () => Environment {
  const base = useEphemeralDatabase();
  let environment: Environment | undefined;
  let started: StartedEngine | undefined;
  beforeAll(async () => {
    const url = base().url;
    const connection = connect(url);
    const common = {
      db: connection.db,
      clock: () => new Date(),
      agent: (options.agent ?? (() => createSimulatedAgent()))(),
      classifier: (options.classifier ?? (() => createSimulatedClassifier()))(),
      logger: silentLogger,
    };
    if (options.durable) {
      started = await startEngine(common, url);
      environment = { services: started.services, connection, url, engine: started.services.engine };
    } else {
      // Without DBOS: knowledge updates and assessments are processed in place; runs are only recorded.
      const services: Services = { ...common, engine: createInlineEngine(() => services) };
      environment = { services, connection, url, engine: services.engine };
    }
  });
  afterAll(async () => {
    await started?.stop();
    await environment?.connection.close();
  });
  return () => {
    if (!environment) throw new Error('The environment is not ready yet.');
    return environment;
  };
}
