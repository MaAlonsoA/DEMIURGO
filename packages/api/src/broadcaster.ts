// Difusor de eventos: una sola conexión LISTEN a Postgres reparte los avisos del diario a las
// conexiones SSE abiertas. El contenido se lee siempre del diario, nunca del aviso.

import { EventEmitter } from 'node:events';
import { Client } from 'pg';

export type Difusor = {
  /** Resuelve cuando el LISTEN está activo: después se puede leer el atraso sin perder avisos. */
  suscribir(proyectoId: string, f: () => void): Promise<() => void>;
  cerrar(): Promise<void>;
};

export function crearDifusor(url: string): Difusor {
  const emisor = new EventEmitter();
  emisor.setMaxListeners(0);
  let cliente: Client | null = null;
  let arranque: Promise<void> | null = null;

  async function asegurar(): Promise<void> {
    if (cliente) return;
    arranque ??= (async () => {
      const c = new Client({ connectionString: url });
      c.on('error', () => undefined);
      await c.connect();
      c.on('notification', (n) => {
        try {
          const aviso = JSON.parse(n.payload ?? '{}') as { proyecto?: string };
          if (aviso.proyecto) emisor.emit(aviso.proyecto);
        } catch {
          // Aviso ilegible: se ignora; el cliente volverá a leer el diario en el siguiente.
        }
      });
      await c.query('listen demiurgo_eventos');
      cliente = c;
    })();
    await arranque;
  }

  return {
    async suscribir(proyectoId, f) {
      await asegurar();
      emisor.on(proyectoId, f);
      return () => emisor.off(proyectoId, f);
    },
    async cerrar() {
      emisor.removeAllListeners();
      const c = cliente;
      cliente = null;
      arranque = null;
      await c?.end().catch(() => undefined);
    },
  };
}
