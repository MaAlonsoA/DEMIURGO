// Difusor de eventos: una sola conexión LISTEN a Postgres reparte los avisos del diario a las
// conexiones SSE abiertas. El contenido se lee siempre del diario, nunca del aviso.

import { EventEmitter } from 'node:events';
import { Client } from 'pg';

export type Broadcaster = {
  /** Resuelve cuando el LISTEN está activo: después se puede leer el atraso sin perder avisos. */
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
          // Aviso ilegible: se ignora; el cliente volverá a leer el diario en el siguiente.
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
