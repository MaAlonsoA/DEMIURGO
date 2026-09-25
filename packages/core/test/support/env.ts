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
import { type MemoryObserver, createMemoryObserver } from '../../src/observe/memory.ts';
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
  /** What the core emitted: every span and log record, as the OTLP exporter would send them. */
  observer: MemoryObserver;
};

type Options = {
  /** Starts DBOS on the ephemeral database; otherwise, the engine is inert. */
  durable?: boolean;
  /** Providers this process runs (the simulated one by default). */
  providers?: () => Provider[];
  classifier?: () => Classifier;
  /** The classifier per project, built over the services (e.g. `agentClassifiers`); wins over `classifier`. */
  classifierFor?: (services: () => Services) => Services['classifierFor'];
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
    const observer = createMemoryObserver();
    const current = (): Services => {
      if (!environment) throw new Error('The environment is not ready yet.');
      return environment.services;
    };
    const common = {
      db: connection.db,
      clock: () => new Date(),
      providers: createProviderRegistry((options.providers ?? (() => [createSimulatedProvider()]))()),
      classifierFor: options.classifierFor ? options.classifierFor(current) : async () => classifier,
      agentSessionsDir: mkdtempSync(join(tmpdir(), 'dmg-sessions-')),
      logger: silentLogger,
      observer,
    };
    if (options.durable) {
      started = await startEngine(common, url, options.engineOptions);
      environment = { services: started.services, connection, url, engine: started.services.engine, observer };
    } else {
      // Without DBOS: knowledge updates and assessments are processed in place; runs are only recorded.
      const services: Services = { ...common, engine: createInlineEngine(() => services) };
      environment = { services, connection, url, engine: services.engine, observer };
    }
  });
  afterAll(async () => {
    await started?.stop();
    await environment?.observer.shutdown(1000);
    await environment?.connection.close();
  });
  return () => {
    if (!environment) throw new Error('The environment is not ready yet.');
    return environment;
  };
}
