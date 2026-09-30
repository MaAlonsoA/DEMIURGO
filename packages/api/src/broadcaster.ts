// Event broadcaster: a single LISTEN connection to Postgres fans the event log's notifications out
// to the open SSE connections. The content is always read from the event log, never from the
// notification. If Postgres drops the connection, it reconnects with backoff (1 s → 30 s) and then
// wakes every subscriber with an empty notification, so each stream re-reads the log from its last
// sent id and nothing that happened while it was deaf is lost.

import { EventEmitter } from 'node:events';
import { Client } from 'pg';

/** What a notification says: a new event of the log, or progress of a run (`progress` is its id). */
export type Notification = { id?: string; progress?: string };

export type Broadcaster = {
  /** Resolves once LISTEN is active: after that, the backlog can be read without missing notifications. */
  subscribe(projectId: string, f: (n: Notification) => void): Promise<() => void>;
  close(): Promise<void>;
};

const MIN_DELAY = 1_000;
const MAX_DELAY = 30_000;

export function createBroadcaster(url: string): Broadcaster {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  let client: Client | null = null;
  let startup: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = MIN_DELAY;
  // Bumped by close(): a connection or retry from before it is discarded.
  let generation = 0;

  function drop(c: Client): void {
    if (client !== c) return;
    client = null;
    startup = null;
    c.removeAllListeners('notification');
    void c.end().catch(() => undefined);
    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    // Nobody listening: the next subscribe connects on its own.
    if (timer || emitter.eventNames().length === 0) return;
    const gen = generation;
    timer = setTimeout(() => {
      timer = undefined;
      if (gen !== generation) return;
      ensure().then(
        () => {
          delay = MIN_DELAY;
          // Catch-up: an empty notification makes each stream re-read the log since its last id.
          for (const project of emitter.eventNames()) emitter.emit(project, {});
        },
        () => {
          delay = Math.min(delay * 2, MAX_DELAY);
          scheduleReconnect();
        },
      );
    }, delay);
  }

  async function ensure(): Promise<void> {
    if (client) return;
    startup ??= (async () => {
      const gen = generation;
      const c = new Client({ connectionString: url });
      c.on('error', () => drop(c));
      c.on('end', () => drop(c));
      try {
        await c.connect();
        c.on('notification', (n) => {
          try {
            const notification = JSON.parse(n.payload ?? '{}') as { project?: string; id?: string | number; progress?: string };
            if (notification.project) {
              emitter.emit(notification.project, {
                ...(notification.id === undefined ? {} : { id: String(notification.id) }),
                ...(notification.progress === undefined ? {} : { progress: notification.progress }),
              });
            }
          } catch {
            // Unreadable notification: ignored; the client will re-read the event log on the next one.
          }
        });
        await c.query('listen demiurgo_events');
        if (gen !== generation) throw new Error('The broadcaster was closed while connecting.');
      } catch (error) {
        if (gen === generation) startup = null;
        c.removeAllListeners('notification');
        await c.end().catch(() => undefined);
        throw error;
      }
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
      generation += 1;
      if (timer) clearTimeout(timer);
      timer = undefined;
      delay = MIN_DELAY;
      emitter.removeAllListeners();
      const c = client;
      client = null;
      startup = null;
      await c?.end().catch(() => undefined);
    },
  };
}
