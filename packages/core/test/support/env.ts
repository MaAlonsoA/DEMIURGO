// Entorno de pruebas del núcleo: base efímera + servicios con agente simulado.

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
  /** Lanza DBOS sobre la base efímera; si no, el motor es inerte. */
  durable?: boolean;
  agent?: () => AgentPort;
  classifier?: () => Classifier;
};

/** Registra, para el archivo de prueba, una base efímera y los servicios del núcleo. */
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
      record: silentLogger,
    };
    if (options.durable) {
      started = await startEngine(common, url);
      environment = { services: started.services, connection, url, engine: started.services.engine };
    } else {
      // Sin DBOS: el conocimiento y las evaluaciones se procesan en el acto; las ejecuciones solo se anotan.
      const services: Services = { ...common, engine: createInlineEngine(() => services) };
      environment = { services, connection, url, engine: services.engine };
    }
  });
  afterAll(async () => {
    await started?.stop();
    await environment?.connection.close();
  });
  return () => {
    if (!environment) throw new Error('El entorno aún no está listo.');
    return environment;
  };
}
