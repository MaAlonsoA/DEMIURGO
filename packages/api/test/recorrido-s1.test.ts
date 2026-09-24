// Recorrido de S1 por la API con agentes simulados y el motor durable: de la intención a
// «Listo para construir», con la bandeja vacía al final.

import { esperarConocimiento, esperarRun } from '@demiurgo/core';
import { describe, expect, it } from 'vitest';
import { usarApi } from './soporte/api.ts';

const api = usarApi({ durable: true });

type Respuesta = { entidad_id: string; estado: string; resultado: Record<string, unknown> | null };

async function comando(proyectoId: string, nombre: string, datos: unknown, entidadId?: string): Promise<Respuesta> {
  const r = await api().persona.pedir('POST', `/api/proyectos/${proyectoId}/comandos/${nombre}`, {
    ...(entidadId ? { entidad_id: entidadId } : {}),
    datos,
  });
  if (r.statusCode !== 200) throw new Error(`${nombre}: ${r.statusCode} ${r.body}`);
  return r.json<Respuesta>();
}

async function leer<T>(url: string): Promise<T> {
  const r = await api().persona.pedir('GET', url);
  if (r.statusCode !== 200) throw new Error(`${url}: ${r.statusCode} ${r.body}`);
  return r.json<T>();
}

/** Espera a que terminen las ejecuciones del proyecto (la respuesta al mensaje llega tras confirmar). */
async function esperarEjecuciones(proyectoId: string, minimo: number): Promise<string[]> {
  const db = api().entorno.servicios.db;
  for (let i = 0; i < 200; i++) {
    const runs = await db.selectFrom('ai_runs').select(['id', 'state']).where('project_id', '=', proyectoId).execute();
    if (runs.length >= minimo) {
      for (const r of runs) await esperarRun(r.id);
      return runs.map((r) => r.id);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('No llegaron las ejecuciones esperadas.');
}

type Bandeja = {
  total: number;
  lotes: {
    id: string;
    tipo: string;
    productor: string;
    resolucion: string;
    propuestas: { id: string; tipo: string; estado_epistemico: string }[];
  }[];
};

describe('recorrido S1', () => {
  it('AC-DIS-001-01 intención → decisión aceptada y aprobada → FDR con 2 AC → «Listo para construir» y bandeja vacía', async () => {
    const { persona, entorno } = api();
    const p = await persona.pedir('POST', '/api/proyectos', { nombre: 'Asociación' });
    const proyectoId = p.json<{ proyecto_id: string }>().proyecto_id;

    // 1. Intención: una exploración y un mensaje de la persona. El agente de exploración responde.
    const exploracion = await comando(proyectoId, 'exploration.open', { proposito: 'Gestionar los socios de una asociación' });
    await comando(proyectoId, 'message.post', {
      exploracion_id: exploracion.entidad_id,
      texto: 'Quiero que cada socio pueda darse de alta con su nombre y su correo',
    });
    const [runChat] = await esperarEjecuciones(proyectoId, 1);

    // 2. La bandeja tiene un lote del agente con una propuesta de decisión, visible como propuesta.
    let bandeja = await leer<Bandeja>(`/api/proyectos/${proyectoId}/bandeja`);
    expect(bandeja.total).toBe(1);
    const lote = bandeja.lotes[0];
    expect(lote).toMatchObject({ tipo: 'agent', resolucion: 'item', productor: `agent:run:${runChat}` });
    expect(lote?.propuestas[0]).toMatchObject({ tipo: 'decision', estado_epistemico: 'propuesto' });

    // 3. «Aceptar y aprobar» la decisión (acción humana).
    const aceptada = await comando(proyectoId, 'proposal.accept', { aprobar: true }, lote?.propuestas[0]?.id);
    const decision = aceptada.resultado as { codigo: string; versionId: string };
    expect(decision.codigo).toMatch(/^DEC-PRO-\d{3}$/);

    // 4. Propuesta de diseño sobre la decisión aprobada: un paquete con la FDR y sus 2 AC.
    // El gate de frescura exige que el conocimiento haya proyectado la aprobación.
    await esperarConocimiento(entorno.servicios, proyectoId);
    await comando(proyectoId, 'run.request', {
      accion: 'design_proposal',
      alcance: { tipo: 'record_version', id: decision.versionId },
    });
    await esperarEjecuciones(proyectoId, 2);
    bandeja = await leer<Bandeja>(`/api/proyectos/${proyectoId}/bandeja`);
    const paquete = bandeja.lotes.find((l) => l.tipo === 'system_package');
    expect(paquete).toMatchObject({ resolucion: 'package' });
    expect(paquete?.propuestas).toHaveLength(1);

    // 5. La persona acepta el paquete en un paso y aprueba la FDR.
    const aceptacion = await comando(proyectoId, 'batch.accept_package', {}, paquete?.id);
    const efecto = (aceptacion.resultado as { efectos: { codigo: string; versionId: string }[] }).efectos[0];
    const fdr = await leer<{ versiones: { criterios: unknown[]; readiness: { listo: boolean; motivos: string[] } }[] }>(
      `/api/proyectos/${proyectoId}/registros/${efecto?.codigo}`,
    );
    expect(fdr.versiones[0]?.criterios).toHaveLength(2);
    expect(fdr.versiones[0]?.readiness.listo).toBe(false);
    expect(fdr.versiones[0]?.readiness.motivos).toContain('La versión 1 no está aprobada.');
    await comando(proyectoId, 'record_version.approve', {}, efecto?.versionId);

    // 6. «Listo para construir» y bandeja vacía.
    const readiness = await leer<{ listo: boolean; motivos: string[] }>(
      `/api/proyectos/${proyectoId}/versiones/${efecto?.versionId}/readiness`,
    );
    expect(readiness).toMatchObject({ listo: true, motivos: [] });
    const estado = await leer<{ listos_para_construir: string[]; bandeja: { total: number } }>(
      `/api/proyectos/${proyectoId}/estado`,
    );
    expect(estado.listos_para_construir).toEqual([efecto?.codigo]);
    expect(estado.bandeja.total).toBe(0);

    // Todo lo decisivo lo hizo la persona; los agentes solo propusieron.
    const decisivos = await entorno.servicios.db
      .selectFrom('events')
      .select(['command', 'actor'])
      .where('project_id', '=', proyectoId)
      .where('command', 'in', ['proposal.accept', 'record_version.approve', 'batch.accept_package'])
      .execute();
    expect(decisivos.length).toBeGreaterThanOrEqual(4);
    expect(decisivos.every((e) => e.actor === 'human:ana')).toBe(true);
  });

  it('AC-DIS-001-12 AC-DIS-001-13 el estado del producto muestra versión vigente, estado, readiness y estado epistémico', async () => {
    const { persona } = api();
    const p = await persona.pedir('POST', '/api/proyectos', { nombre: 'Estado' });
    const proyectoId = p.json<{ proyecto_id: string }>().proyecto_id;
    const d = await comando(proyectoId, 'record.create', {
      tipo: 'decision',
      dominio: 'socios',
      titulo: 'Alta de socios',
      secciones: [
        { titulo: 'Contexto', contenido: 'c' },
        { titulo: 'Decisión', contenido: 'd' },
        { titulo: 'Consecuencias', contenido: 'k' },
      ],
    });
    const estado = await leer<{
      decisiones: { codigo: string; vigente: number | null; ultima: { estado: string }; estado_epistemico: string }[];
      bandeja: { total: number };
    }>(`/api/proyectos/${proyectoId}/estado`);
    expect(estado.decisiones).toEqual([
      expect.objectContaining({
        codigo: (d.resultado as { codigo: string }).codigo,
        vigente: null,
        ultima: { n: 1, estado: 'draft' },
        estado_epistemico: 'propuesto',
      }),
    ]);
    await comando(proyectoId, 'record_version.approve', {}, (d.resultado as { versionId: string }).versionId);
    const despues = await leer<{ decisiones: { vigente: number | null; estado_epistemico: string }[] }>(
      `/api/proyectos/${proyectoId}/estado`,
    );
    expect(despues.decisiones[0]).toMatchObject({ vigente: 1, estado_epistemico: 'confirmado' });
    expect(estado.bandeja.total).toBe(0);
  });
});
