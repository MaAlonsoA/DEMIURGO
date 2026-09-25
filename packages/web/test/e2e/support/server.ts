// E2E server: an ephemeral database (dmg_t_*, never one in use), the durable engine with the
// simulated provider (every agent assigned to it) and classifier, a test person, and the web build
// served from the API on the same origin. Run by Playwright's webServer:
//   node packages/web/test/e2e/support/server.ts
//
// The simulated provider obeys markers in its context so the tests can provoke each run state:
//   [slow]       the run keeps working until it is cancelled;
//   [fail-once]  the first run with a context pack fails; its retry (same pack) succeeds;
//   [invalid]    the output does not match the schema (invalid_output, no effects).
// And the simulated classifier obeys one marker in what it classifies:
//   [classifier-fails]  the classifier fails the first three calls about the text that carries
//                       the marker: each call is one attempt of its knowledge update, which is
//                       rejected; the fourth attempt (the third retry) goes through.
//   [slow-knowledge]    each classifier call about the text that carries it takes 8 s, so an
//                       answer waits for knowledge long enough to be seen catching up.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPerson, createServer } from '@demiurgo/api';
import type { Classifier, Provider } from '@demiurgo/domain';
import {
  connect,
  createProviderRegistry,
  createSimulatedClassifier,
  createSimulatedProvider,
  migrate,
  silentLogger,
  startEngine,
} from '@demiurgo/core';
import { seedSimulated } from '../../../../core/test/support/seed.ts';

const port = Number(process.env.E2E_PORT ?? 8310);
const adminUrl = process.env.DEMIURGO_TEST_DB_URL ?? 'postgres://demiurgo:demiurgo-dev@127.0.0.1:55432/postgres';
export const E2E_USER = 'ana';
export const E2E_PASSWORD = 'long-test-password';

const webRoot = fileURLToPath(new URL('../../../dist', import.meta.url));
if (!existsSync(webRoot)) throw new Error(`There is no web build in ${webRoot}: run the web build first.`);

function databaseUrl(name: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  return u.toString();
}

const name = `dmg_t_${Math.floor(Date.now() / 1000)}_${randomBytes(4).toString('hex')}`;
const admin = connect(adminUrl, 1);
await admin.pool.query(`create database "${name}"`);
await admin.close();
const url = databaseUrl(name);
const connection = connect(url);
await migrate(connection.pool);
await seedSimulated(connection.db);

const error = (failureKind: 'agent_error' | 'cancelled', message: string) => ({
  state: 'error' as const,
  failureKind,
  message,
  rawEvents: '',
  provider: 'simulated',
  model: 'simulated',
});

function scriptedProvider(): Provider {
  const base = createSimulatedProvider();
  const failedOnce = new Set<string>();
  return {
    ...base,
    async run(p) {
      const context = p.task?.context ?? { hash: '', content: {} };
      const text = JSON.stringify(context.content);
      if (text.includes('[slow]')) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 10 * 60_000);
          p.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            resolve();
          });
        });
        if (p.signal?.aborted) return error('cancelled', 'Cancelled.');
      }
      if (text.includes('[fail-once]') && !failedOnce.has(context.hash)) {
        failedOnce.add(context.hash);
        return error('agent_error', 'The simulated agent failed on purpose.');
      }
      if (text.includes('[invalid]')) {
        return {
          state: 'ok',
          rawOutput: { unexpected: true },
          usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
          rawEvents: '{}',
          provider: 'simulated',
          model: 'simulated',
        };
      }
      return base.run(p);
    },
  };
}

function scriptedClassifier(): Classifier {
  const base = createSimulatedClassifier();
  const failures = new Map<string, number>();
  return {
    ...base,
    id: base.id,
    async choice(items) {
      const text = JSON.stringify(items);
      if (text.includes('[slow-knowledge]')) await new Promise((r) => setTimeout(r, 8000));
      // Counted by the marked text itself: the rest of the input changes as the graph grows.
      const marked = /"[^"]*\[classifier-fails\][^"]*"/.exec(text)?.[0];
      if (marked) {
        const n = failures.get(marked) ?? 0;
        if (n < 3) {
          failures.set(marked, n + 1);
          throw new Error('The simulated classifier failed on purpose.');
        }
      }
      return base.choice(items);
    },
  };
}

const classifier = scriptedClassifier();
const engine = await startEngine(
  {
    db: connection.db,
    clock: () => new Date(),
    providers: createProviderRegistry([scriptedProvider()]),
    classifierFor: async () => classifier,
    agentSessionsDir: tmpdir(),
    logger: silentLogger,
  },
  url,
);
await createPerson(connection.db, E2E_USER, E2E_PASSWORD);
const origin = `http://127.0.0.1:${port}`;
const app = await createServer({
  services: engine.services,
  databaseUrl: url,
  sessionHours: 2,
  allowedOrigins: [origin, `http://localhost:${port}`],
  webRoot,
});
await app.listen({ host: '127.0.0.1', port });
console.log(JSON.stringify({ e2e: origin, database: name }));

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await app.close();
    await engine.stop();
    await connection.close();
    const a = connect(adminUrl, 1);
    await a.pool.query(`drop database if exists "${name}" with (force)`);
    await a.close();
  } finally {
    process.exit(0);
  }
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
