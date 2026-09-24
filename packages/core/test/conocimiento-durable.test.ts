// «Actualizar conocimiento» con el motor durable (DBOS): el reintento de una actualización
// rechazada arranca un flujo nuevo y un fallo al clasificar nunca deja una actualización en curso.

import { randomUUID } from 'node:crypto';
import { type Actor, humano } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { ejecutarComando } from '../src/bus/bus.ts';
import { esperarConocimiento } from '../src/conocimiento/flujos.ts';
import { compararReconstruccion } from '../src/conocimiento/reconstruir.ts';
import type { Servicios } from '../src/servicios.ts';
import { crearClasificadorGuionizado } from './soporte/clasificador-guion.ts';
import { usarEntorno } from './soporte/entorno.ts';

const guion = crearClasificadorGuionizado();
const entorno = usarEntorno({ durable: true, clasificador: () => guion });
const ana = humano('ana');
let s: Servicios;

beforeAll(() => {
  s = entorno().servicios;
});

const unico = () => randomUUID().slice(0, 8);
const cmd = (
  proyectoId: string,
  comando: Parameters<typeof ejecutarComando>[1]['comando'],
  datos: unknown,
  entidadId?: string,
  actor: Actor = ana,
) => ejecutarComando(s, { comando, actor, proyectoId, datos, ...(entidadId ? { entidadId } : {}) });

async function nuevoProyecto(nombre: string): Promise<string> {
  return (await ejecutarComando(s, { comando: 'project.create', actor: ana, datos: { nombre } })).proyectoId;
}

async function decision(p: string, titulo: string, texto: string) {
  const r = await cmd(p, 'record.create', {
    tipo: 'decision',
    dominio: 'socios',
    titulo,
    secciones: [
      { titulo: 'Contexto', contenido: `Contexto de ${titulo}.` },
      { titulo: 'Decisión', contenido: texto },
      { titulo: 'Consecuencias', contenido: 'Hay que diseñarlo.' },
    ],
  });
  const res = r.resultado as { recordId: string; versionId: string; codigo: string };
  await cmd(p, 'record_version.approve', {}, res.versionId);
  await esperarConocimiento(s, p);
  return res;
}

const estados = async (p: string) =>
  (
    await s.db
      .selectFrom('knowledge_updates')
      .select(['id', 'state'])
      .where('project_id', '=', p)
      .orderBy('trigger_seq')
      .orderBy('id')
      .execute()
  ).map((u) => u.state);

describe('conocimiento con el motor durable', () => {
  it('AC-CON-001-07 reintentar una actualización rechazada arranca un flujo nuevo y desbloquea la frescura', async () => {
    guion.reiniciar();
    const p = await nuevoProyecto('Reintento durable');
    const t = unico();
    await decision(p, `Invitados ${t}`, `Cada socio puede traer invitados ${t}.`);
    guion.guiones.veredicto = () => [];
    const d2 = await decision(p, `Invitados limitados ${t}`, `Cada socio puede traer dos invitados ${t}.`);
    expect(await estados(p)).toEqual(['applied', 'rejected']);
    guion.reiniciar();
    const rechazada = (
      await s.db
        .selectFrom('knowledge_updates')
        .select('id')
        .where('project_id', '=', p)
        .where('state', '=', 'rejected')
        .executeTakeFirstOrThrow()
    ).id;
    await cmd(p, 'knowledge_update.retry', {}, rechazada);
    await esperarConocimiento(s, p, 10_000);
    expect(await estados(p)).toEqual(['applied', 'applied']);
    // Con todo aplicado, pedir una ejecución ya no choca con el gate de frescura.
    await expect(
      cmd(p, 'run.request', { accion: 'design_proposal', alcance: { tipo: 'record_version', id: d2.versionId } }),
    ).resolves.toMatchObject({ estado: 'queued' });
    expect(await compararReconstruccion(s.db, p)).toMatchObject({ iguales: true });
  });

  it('AC-CON-001-07 un fallo persistente al clasificar deja la actualización rechazada, nunca en curso', async () => {
    guion.reiniciar();
    const p = await nuevoProyecto('Fallo al clasificar');
    const t = unico();
    await decision(p, `Uno ${t}`, `Uno ${t}.`);
    // Un disparo que hace fallar la derivación en cada intento (como un fallo persistente de la base).
    const { rows } = await sql<{ id: string }>`insert into knowledge_updates (project_id, trigger, trigger_seq, state)
      values (${p}::uuid, ${JSON.stringify({ tipo: 'record_version', id: 'no-es-uuid', version: 1 })}::jsonb, 1000, 'queued') returning id`.execute(
      s.db,
    );
    await s.motor.iniciarActualizacion(rows[0]?.id ?? '', p);
    await esperarConocimiento(s, p, 15_000);
    expect(await estados(p)).toEqual(['applied', 'rejected']);
    const u = await s.db
      .selectFrom('knowledge_updates')
      .select('failure')
      .where('id', '=', rows[0]?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(u.failure).toMatch(/No se pudo clasificar el cambio/);
    // La cola sigue: el siguiente evento de autoridad se aplica.
    await decision(p, `Dos ${t}`, `Dos ${t}.`);
    // (El disparo inyectado lleva trigger_seq 1000: se ordena el último.)
    expect(await estados(p)).toEqual(['applied', 'applied', 'rejected']);
  });
});
