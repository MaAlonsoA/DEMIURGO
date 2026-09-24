// Runtime of the API process: the core lives behind stable references (services with getters and
// a broadcaster that reconnects on demand), so the dev tools can stop it, swap the database and
// start it again without closing the HTTP server. Requests that arrive meanwhile wait at ready().

import { type Config, type Logger, type Services, consoleLogger, startCore } from '@demiurgo/core';
import { DomainError } from '@demiurgo/domain';
import { type Broadcaster, createBroadcaster } from './broadcaster.ts';

export type Runtime = {
  services: Services;
  broadcaster: Broadcaster;
  /** Resolves when no restart is in progress. */
  ready(): Promise<void>;
  /** Stops the core (and the LISTEN connection), runs the operation and starts the core again, even if it fails. */
  restart<T>(op: () => Promise<T>): Promise<T>;
  stop(): Promise<void>;
};

export async function startRuntime(config: Config, logger: Logger = consoleLogger): Promise<Runtime> {
  let core = await startCore(config, logger);
  let idle: Promise<void> = Promise.resolve();
  let restarting = false;
  const broadcaster = createBroadcaster(config.databaseUrl);
  const services: Services = {
    get db() {
      return core.services.db;
    },
    get clock() {
      return core.services.clock;
    },
    get agent() {
      return core.services.agent;
    },
    get classifier() {
      return core.services.classifier;
    },
    get engine() {
      return core.services.engine;
    },
    get logger() {
      return core.services.logger;
    },
  };
  return {
    services,
    broadcaster,
    ready: () => idle,
    async restart(op) {
      if (restarting) throw new DomainError('conflict', 'The API is already restarting.');
      restarting = true;
      const gate = Promise.withResolvers<void>();
      idle = gate.promise;
      try {
        await broadcaster.close();
        await core.stop();
        try {
          return await op();
        } finally {
          core = await startCore(config, logger);
        }
      } finally {
        restarting = false;
        gate.resolve();
      }
    },
    async stop() {
      await idle;
      await broadcaster.close();
      await core.stop();
    },
  };
}
