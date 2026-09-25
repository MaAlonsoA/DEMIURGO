// Core startup from the configuration: migrated database, the providers this process runs, the
// knowledge classifier per project (whatever engine the person assigned), and the durable engine
// running. The providers' catalogs are discovered again in the background, without spending quota.

import { seedDefaultEngines } from './assignments/defaults.ts';
import { system } from '@demiurgo/domain';
import { createSimulatedProvider } from './agents/simulated.ts';
import { refreshCatalogs } from './assignments/catalogs.ts';
import { agentClassifiers } from './assignments/classifiers.ts';
import type { Config } from './config.ts';
import { type Connection, connect } from './db/connection.ts';
import { migrate } from './db/migrator.ts';
import { type StartedEngine, startEngine } from './engine/engine.ts';
import { engineServices } from './engine/registry.ts';
import { createClaudeProvider } from './providers/claude.ts';
import { createCodexProvider } from './providers/codex.ts';
import { createOpenCodeProvider } from './providers/opencode.ts';
import { type ProviderRegistry, createProviderRegistry } from './providers/registry.ts';
import { type Logger, consoleLogger } from './services.ts';

/** Claude, Codex and the local models of OpenCode; the simulated provider only with the dev tools. */
export function createProviders(config: Config): ProviderRegistry {
  return createProviderRegistry([
    createClaudeProvider(),
    createCodexProvider(),
    createOpenCodeProvider({ configPath: config.openCodeConfig }),
    ...(config.devTools ? [createSimulatedProvider()] : []),
  ]);
}

export type Core = StartedEngine & { connection: Connection };

export async function startCore(config: Config, logger: Logger = consoleLogger): Promise<Core> {
  const connection = connect(config.databaseUrl);
  const applied = await migrate(connection.pool);
  if (applied.length) logger.info('Migrations applied', { applied });
  const seeded = await seedDefaultEngines(connection.db);
  if (seeded.length) logger.info('Default engines assigned', { agents: seeded });
  const providers = createProviders(config);
  const engine = await startEngine(
    {
      db: connection.db,
      clock: () => new Date(),
      providers,
      // The engine's services exist before DBOS resumes workflows and the reconcilers run.
      classifierFor: agentClassifiers(engineServices),
      agentSessionsDir: config.agentSessionsDir,
      logger,
    },
    config.databaseUrl,
  );
  void refreshCatalogs({ db: connection.db, providers }, system('providers'))
    .then((catalogs) =>
      logger.info('Providers discovered', {
        providers: catalogs.map((c) => `${c.provider}: ${c.ready ? `${c.models.length} models` : (c.message ?? 'not ready')}`),
      }),
    )
    .catch((e: unknown) => logger.error('Provider discovery failed', { error: String(e) }));
  return {
    ...engine,
    connection,
    async stop() {
      await engine.stop();
      await connection.close();
    },
  };
}
