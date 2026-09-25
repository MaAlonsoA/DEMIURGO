// DEMIURGO v2 server startup.
//   DEMIURGO_DATABASE_URL=postgres://… node packages/api/src/main.ts
// Never on port 8000 (v1): the config rejects it. DEMIURGO_DEV_TOOLS=1 adds /api/dev (snapshots, reset).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readConfig, consoleLogger } from '@demiurgo/core';
import { createDevTools } from './dev-tools.ts';
import { startRuntime } from './runtime.ts';
import { createServer } from './server.ts';

const config = readConfig();
// The web build (pnpm --filter @demiurgo/web build) is served from the same origin when it exists.
const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
const runtime = await startRuntime(config, consoleLogger);
const app = await createServer({
  services: runtime.services,
  broadcaster: runtime.broadcaster,
  databaseUrl: config.databaseUrl,
  sessionHours: config.sessionHours,
  allowedOrigins: config.allowedOrigins,
  allowedHosts: [`${config.host}:${config.port}`, `localhost:${config.port}`, `127.0.0.1:${config.port}`],
  ...(existsSync(webRoot) ? { webRoot } : {}),
  ...(config.devTools ? { devTools: createDevTools(runtime, config.databaseUrl) } : {}),
});
await app.listen({ host: config.host, port: config.port });
consoleLogger.info('DEMIURGO v2 listening', {
  url: `http://${config.host}:${config.port}`,
  web: existsSync(webRoot) ? webRoot : null,
  dev_tools: config.devTools,
  observe: config.observe.mode === 'off' ? 'off' : config.observe.endpoint,
  environment: config.observe.environment,
});

async function shutdown(): Promise<void> {
  await app.close();
  await runtime.stop();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
