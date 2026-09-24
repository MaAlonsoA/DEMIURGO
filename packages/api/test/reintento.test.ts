// Reintento con el mismo context pack (I7) y procedencia de los lotes de una ejecución.

import { esperarRun } from '@demiurgo/core';
import { crearAgenteSimulado } from '../../core/src/agentes/simulado.ts';
import { GUIONES_POR_DEFECTO } from '../../core/src/agentes/simulado.ts';
import { describe, expect, it } from 'vitest';
import { usarApi } from './soporte/api.ts';

// La primera invocación de cada pack devuelve una salida inválida; las siguientes, la normal.
const vistos = new Set<string>();
const api = usarApi({
  durable: true,
  agente: () =>
    crearAgenteSimulado({
      guiones: {
        exploration_chat: (p) => {
          if (!vistos.has(p.contexto.hash)) {
            vistos.add(p.contexto.hash);
            return { reply: 7 };
          }
          return GUIONES_POR_DEFECTO.exploration_chat(p);
        },
      },
    }),
});

async function comando(proyectoId: string, nombre: string, datos: unknown, entidadId?: string) {
  const r = await api().persona.pedir('POST', `/api/proyectos/${proyectoId}/comandos/${nombre}`, {
    ...(entidadId ? { entidad_id: entidadId } : {}),
    datos,
  });
  if (r.statusCode !== 200) throw new Error(`${nombre}: ${r.body}`);
  return r.json<{ entidad_id: string; resultado: Record<string, unknown> }>();
}

describe('reintento', () => {
  it('AC-DIS-001-07 el context pack del reintento coincide con el del envío (mismo hash)', async () => {
    const proyectoId = (await api().persona.pedir('POST', '/api/proyectos', { nombre: 'Reintento' })).json<{
      proyecto_id: string;
    }>().proyecto_id;
    const e = await comando(proyectoId, 'exploration.open', { proposito: 'Cuotas de socios' });
    await comando(proyectoId, 'message.post', { exploracion_id: e.entidad_id, texto: 'Quiero cuotas anuales', responder: false });
    const envio = await comando(proyectoId, 'run.request', {
      accion: 'exploration_chat',
      alcance: { tipo: 'exploration', id: e.entidad_id },
    });
    expect(await esperarRun(envio.entidad_id)).toBe('failed');
    const fallida = (await api().persona.pedir('GET', `/api/proyectos/${proyectoId}/runs/${envio.entidad_id}`)).json<{
      failure_kind: string;
      context_pack: { hash: string };
    }>();
    expect(fallida.failure_kind).toBe('invalid_output');

    // Entre medias cambia la conversación: el reintento no reconstruye el contexto.
    await comando(proyectoId, 'message.post', { exploracion_id: e.entidad_id, texto: 'Mejor mensuales', responder: false });
    const reintento = await comando(proyectoId, 'run.retry', { run_id: envio.entidad_id });
    expect(await esperarRun(reintento.entidad_id)).toBe('completed');
    const segundo = (await api().persona.pedir('GET', `/api/proyectos/${proyectoId}/runs/${reintento.entidad_id}`)).json<{
      retry_of: string;
      context_pack: { hash: string };
    }>();
    expect(segundo.retry_of).toBe(envio.entidad_id);
    expect(segundo.context_pack.hash).toBe(fallida.context_pack.hash);

    // Procedencia: el lote de la ejecución guarda su run y su context pack.
    const lotes = await api()
      .entorno.servicios.db.selectFrom('proposal_batches')
      .selectAll()
      .where('project_id', '=', proyectoId)
      .execute();
    expect(lotes).toHaveLength(1);
    const run = await api()
      .entorno.servicios.db.selectFrom('ai_runs')
      .select('context_pack_id')
      .where('id', '=', reintento.entidad_id)
      .executeTakeFirstOrThrow();
    expect(lotes[0]).toMatchObject({
      run_id: reintento.entidad_id,
      context_pack_id: run.context_pack_id,
      producer: `agent:run:${reintento.entidad_id}`,
    });
  });

  it('AC-DIS-001-20 cada lote de una ejecución guarda la ejecución y el context pack que lo produjeron', async () => {
    const lotes = await api()
      .entorno.servicios.db.selectFrom('proposal_batches')
      .select(['run_id', 'context_pack_id', 'producer'])
      .execute();
    expect(lotes.length).toBeGreaterThan(0);
    for (const l of lotes) {
      expect(l.run_id).not.toBeNull();
      expect(l.context_pack_id).not.toBeNull();
      expect(l.producer).toBe(`agent:run:${l.run_id}`);
    }
  });
});
