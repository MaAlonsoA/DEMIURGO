// DEMIURGO v2 server startup.
//   DEMIURGO_DATABASE_URL=postgres://… node packages/api/src/main.ts
// Never on port 8000 (v1): the config rejects it.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startCore, readConfig, consoleLogger } from '@demiurgo/core';
import { createServer } from './server.ts';

const config = readConfig();
// The web build (pnpm --filter @demiurgo/web build) is served from the same origin when it exists.
const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
const core = await startCore(config, consoleLogger);
const app = await createServer({
  services: core.services,
  databaseUrl: config.databaseUrl,
  sessionHours: config.sessionHours,
  allowedOrigins: config.allowedOrigins,
  allowedHosts: [`${config.host}:${config.port}`, `localhost:${config.port}`, `127.0.0.1:${config.port}`],
  ...(existsSync(webRoot) ? { webRoot } : {}),
});
await app.listen({ host: config.host, port: config.port });
consoleLogger.info('DEMIURGO v2 listening', {
  url: `http://${config.host}:${config.port}`,
  agent: config.agent,
  classifier: config.classifier,
  web: existsSync(webRoot) ? webRoot : null,
});

async function shutdown(): Promise<void> {
  await app.close();
  await core.stop();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
