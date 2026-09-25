// Core test environment: ephemeral database + services with the simulated provider, and every agent
// assigned to it (as a person would leave Models & providers).

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Classifier, Provider } from '@demiurgo/domain';
import { afterAll, beforeAll } from 'vitest';
import { createSimulatedProvider } from '../../src/agents/simulated.ts';
import { type Connection, connect } from '../../src/db/connection.ts';
import { type EngineOptions, type StartedEngine, startEngine } from '../../src/engine/engine.ts';
import { createSimulatedClassifier } from '../../src/classifier/simulated.ts';
import { createInlineEngine } from '../../src/engine/inline.ts';
import { createProviderRegistry } from '../../src/providers/registry.ts';
import { type WorkflowEngine, type Services, silentLogger } from '../../src/services.ts';
import { useEphemeralDatabase } from './ephemeral-db.ts';
import { classifierNotConfigured } from './null-classifier.ts';
import { seedSimulated } from './seed.ts';

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
  /** Providers this process runs (the simulated one by default). */
  providers?: () => Provider[];
  classifier?: () => Classifier;
  /** Assigns every agent to the simulated provider (true by default). */
  seedAssignments?: boolean;
  /** Options of the durable engine (its test hooks). */
  engineOptions?: EngineOptions;
};

/** Registers, for the test file, an ephemeral database and the core services. */
export function useEnvironment(options: Options = {}): () => Environment {
  const base = useEphemeralDatabase();
  let environment: Environment | undefined;
  let started: StartedEngine | undefined;
  beforeAll(async () => {
    const url = base().url;
    const connection = connect(url);
    if (options.seedAssignments !== false) await seedSimulated(connection.db);
    const classifier = (options.classifier ?? (() => createSimulatedClassifier()))();
    const common = {
      db: connection.db,
      clock: () => new Date(),
      providers: createProviderRegistry((options.providers ?? (() => [createSimulatedProvider()]))()),
      classifierFor: async () => classifier,
      agentSessionsDir: mkdtempSync(join(tmpdir(), 'dmg-sessions-')),
      logger: silentLogger,
    };
    if (options.durable) {
      started = await startEngine(common, url, options.engineOptions);
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
