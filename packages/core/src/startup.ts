// Core startup from the configuration: migrated database, agent and classifier per the
// configuration, and durable engine running.

import type { Classifier, AgentPort } from '@demiurgo/domain';
import { createClaudeCliAgent } from './agents/claude-cli.ts';
import { createSimulatedAgent } from './agents/simulated.ts';
import { createCascadeClassifier } from './classifier/cascade.ts';
import { createJevClassifier } from './classifier/jev.ts';
import { createClaudeReferenceClassifier } from './classifier/claude-reference.ts';
import { createSimulatedClassifier } from './classifier/simulated.ts';
import type { Config } from './config.ts';
import { type Connection, connect } from './db/connection.ts';
import { migrate } from './db/migrator.ts';
import { type StartedEngine, startEngine } from './engine/engine.ts';
import { type Logger, consoleLogger } from './services.ts';

export function createAgent(config: Config): AgentPort {
  return config.agent === 'claude' ? createClaudeCliAgent({ model: config.agentModel }) : createSimulatedAgent();
}

function baseClassifier(config: Config): Classifier {
  if (config.classifier === 'reference') return createClaudeReferenceClassifier({ model: config.classifierModel });
  if (config.classifier === 'jev') return createJevClassifier();
  return createSimulatedClassifier();
}

/** Configured classifier; with a reviewer, cascaded: medium confidence is reviewed by another model. */
export function createClassifier(config: Config): Classifier {
  const base = baseClassifier(config);
  if (config.reviewer === 'none') return base;
  return createCascadeClassifier(base, createClaudeReferenceClassifier({ model: config.reviewerModel }));
}

export type Core = StartedEngine & { connection: Connection };

export async function startCore(config: Config, record: Logger = consoleLogger): Promise<Core> {
  const connection = connect(config.baseUrl);
  const applied = await migrate(connection.pool);
  if (applied.length) record.info('Migrations applied', { applied });
  const engine = await startEngine(
    { db: connection.db, clock: () => new Date(), agent: createAgent(config), classifier: createClassifier(config), record },
    config.baseUrl,
  );
  return {
    ...engine,
    connection,
    async stop() {
      await engine.stop();
      await connection.close();
    },
  };
}
