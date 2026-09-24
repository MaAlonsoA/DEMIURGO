import { ErrorDominio, humano, sistema } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { ejecutarComando, enTransaccion } from '../src/bus/bus.ts';
import { usarEntorno } from './soporte/entorno.ts';

const entorno = usarEntorno();
const ana = humano('ana');

async function eventos(proyectoId: string) {
  return entorno().servicios.db.selectFrom('events').selectAll().where('project_id', '=', proyectoId).orderBy('seq').execute();
}

describe('bus de comandos', () => {
  it('AC-ESQ-001-01 un comando permitido cambia el estado y deja exactamente un evento completo', async () => {
    const s = entorno().servicios;
    const creado = await ejecutarComando(s, { comando: 'project.create', actor: ana, datos: { nombre: 'Socios' } });
    expect(creado.estado).toBe('active');
    let ev = await eventos(creado.proyectoId);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      seq: '1',
      actor: 'human:ana',
      command: 'project.create',
      entity_type: 'project',
      entity_id: creado.proyectoId,
      state_before: null,
      state_after: 'active',
    });
    expect(ev[0]?.cause).toHaveProperty('correlacion');

    const archivado = await ejecutarComando(s, {
      comando: 'project.archive',
      actor: ana,
      proyectoId: creado.proyectoId,
      entidadId: creado.proyectoId,
      datos: { motivo: 'Prueba' },
    });
    expect(archivado.estado).toBe('archived');
    ev = await eventos(creado.proyectoId);
    expect(ev).toHaveLength(2);
    expect(ev[1]).toMatchObject({ seq: '2', state_before: 'active', state_after: 'archived', after: { motivo: 'Prueba' } });
    const p = await s.db.selectFrom('projects').select('state').where('id', '=', creado.proyectoId).executeTakeFirstOrThrow();
    expect(p.state).toBe('archived');
  });

  it('AC-ESQ-001-01 si falla algo en la transacción no queda ni el cambio ni el evento', async () => {
    const s = entorno().servicios;
    const creado = await ejecutarComando(s, { comando: 'project.create', actor: ana, datos: { nombre: 'Atómico' } });
    const antes = await eventos(creado.proyectoId);
    await expect(
      enTransaccion(s, async (ejecutar) => {
        await ejecutar({
          comando: 'project.archive',
          actor: ana,
          proyectoId: creado.proyectoId,
          entidadId: creado.proyectoId,
          datos: {},
        });
        // Segundo comando inválido en la misma transacción: el primero también se deshace.
        await ejecutar({ comando: 'project.archive', actor: ana, proyectoId: creado.proyectoId, entidadId: creado.proyectoId });
      }),
    ).rejects.toBeInstanceOf(ErrorDominio);
    expect(await eventos(creado.proyectoId)).toEqual(antes);
    const p = await s.db.selectFrom('projects').select('state').where('id', '=', creado.proyectoId).executeTakeFirstOrThrow();
    expect(p.state).toBe('active');
  });

  it('valida los datos antes de tocar nada (422)', async () => {
    const s = entorno().servicios;
    await expect(ejecutarComando(s, { comando: 'project.create', actor: ana, datos: { nombre: '' } })).rejects.toMatchObject({
      tipo: 'validacion',
    });
  });

  it('un proyecto archivado no admite cambios', async () => {
    const s = entorno().servicios;
    const { proyectoId } = await ejecutarComando(s, { comando: 'project.create', actor: ana, datos: { nombre: 'Viejo' } });
    await ejecutarComando(s, { comando: 'project.archive', actor: ana, proyectoId, entidadId: proyectoId, datos: {} });
    await expect(
      ejecutarComando(s, {
        comando: 'run.request',
        actor: ana,
        proyectoId,
        datos: { accion: 'eco', alcance: { tipo: 'proyecto' } },
      }),
    ).rejects.toMatchObject({ tipo: 'transicion_invalida' });
  });

  it('run.request construye un context pack y el reintento reutiliza el mismo', async () => {
    const s = entorno().servicios;
    const { proyectoId } = await ejecutarComando(s, { comando: 'project.create', actor: ana, datos: { nombre: 'Packs' } });
    const r = await ejecutarComando(s, {
      comando: 'run.request',
      actor: ana,
      proyectoId,
      datos: { accion: 'eco', alcance: { tipo: 'proyecto' }, entrada: { texto: 'hola' } },
    });
    const run = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', r.entidadId).executeTakeFirstOrThrow();
    expect(run).toMatchObject({ state: 'queued', action: 'eco', method: 'eco@v1', requested_by: 'human:ana' });
    await ejecutarComando(s, {
      comando: 'run.fail',
      actor: sistema('motor'),
      proyectoId,
      entidadId: r.entidadId,
      datos: { failure_kind: 'agent_error', error: 'x' },
    });
    const reintento = await ejecutarComando(s, { comando: 'run.retry', actor: ana, proyectoId, datos: { run_id: r.entidadId } });
    const nuevo = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', reintento.entidadId).executeTakeFirstOrThrow();
    expect(nuevo.context_pack_id).toBe(run.context_pack_id);
    expect(nuevo.retry_of).toBe(run.id);
    const packs = await s.db.selectFrom('context_packs').select('id').where('project_id', '=', proyectoId).execute();
    expect(packs).toHaveLength(1);
  });
});
