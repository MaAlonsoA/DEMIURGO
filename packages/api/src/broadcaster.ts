// Event broadcaster: a single LISTEN connection to Postgres fans the event log's warnings out
// to the open SSE connections. The content is always read from the event log, never from the
// warning.

import { EventEmitter } from 'node:events';
import { Client } from 'pg';

export type Broadcaster = {
  /** Resolves once LISTEN is active: after that, the backlog can be read without missing warnings. */
  subscribe(projectId: string, f: () => void): Promise<() => void>;
  close(): Promise<void>;
};

export function createBroadcaster(url: string): Broadcaster {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  let client: Client | null = null;
  let startup: Promise<void> | null = null;

  async function ensure(): Promise<void> {
    if (client) return;
    startup ??= (async () => {
      const c = new Client({ connectionString: url });
      c.on('error', () => undefined);
      await c.connect();
      c.on('notification', (n) => {
        try {
          const warning = JSON.parse(n.payload ?? '{}') as { project?: string };
          if (warning.project) emitter.emit(warning.project);
        } catch {
          // Unreadable warning: ignored; the client will re-read the event log on the next one.
        }
      });
      await c.query('listen demiurgo_events');
      client = c;
    })();
    await startup;
  }

  return {
    async subscribe(projectId, f) {
      await ensure();
      emitter.on(projectId, f);
      return () => emitter.off(projectId, f);
    },
    async close() {
      emitter.removeAllListeners();
      const c = client;
      client = null;
      startup = null;
      await c?.end().catch(() => undefined);
    },
  };
}
