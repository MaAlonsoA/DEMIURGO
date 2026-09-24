import { DomainError, human, system } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { executeCommand, inTransaction } from '../src/bus/bus.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');

async function events(projectId: string) {
  return environment().services.db.selectFrom('events').selectAll().where('project_id', '=', projectId).orderBy('seq').execute();
}

describe('bus de comandos', () => {
  it('AC-ESQ-001-01 un comando permitido cambia el estado y deja exactamente un evento completo', async () => {
    const s = environment().services;
    const created = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Socios' } });
    expect(created.state).toBe('active');
    let ev = await events(created.projectId);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      seq: '1',
      actor: 'human:ana',
      command: 'project.create',
      entity_type: 'project',
      entity_id: created.projectId,
      state_before: null,
      state_after: 'active',
    });
    expect(ev[0]?.cause).toHaveProperty('correlation');

    const archived = await executeCommand(s, {
      command: 'project.archive',
      actor: ana,
      projectId: created.projectId,
      entityId: created.projectId,
      data: { reason: 'Test' },
    });
    expect(archived.state).toBe('archived');
    ev = await events(created.projectId);
    expect(ev).toHaveLength(2);
    expect(ev[1]).toMatchObject({ seq: '2', state_before: 'active', state_after: 'archived', after: { reason: 'Test' } });
    const p = await s.db.selectFrom('projects').select('state').where('id', '=', created.projectId).executeTakeFirstOrThrow();
    expect(p.state).toBe('archived');
  });

  it('AC-ESQ-001-01 si falla algo en la transacción no queda ni el cambio ni el evento', async () => {
    const s = environment().services;
    const created = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Atómico' } });
    const before = await events(created.projectId);
    await expect(
      inTransaction(s, async (execute) => {
        await execute({
          command: 'project.archive',
          actor: ana,
          projectId: created.projectId,
          entityId: created.projectId,
          data: {},
        });
        // Segundo comando inválido en la misma transacción: el primero también se deshace.
        await execute({ command: 'project.archive', actor: ana, projectId: created.projectId, entityId: created.projectId });
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(await events(created.projectId)).toEqual(before);
    const p = await s.db.selectFrom('projects').select('state').where('id', '=', created.projectId).executeTakeFirstOrThrow();
    expect(p.state).toBe('active');
  });

  it('valida los datos antes de tocar nada (422)', async () => {
    const s = environment().services;
    await expect(executeCommand(s, { command: 'project.create', actor: ana, data: { name: '' } })).rejects.toMatchObject({
      type: 'validation',
    });
  });

  it('un proyecto archivado no admite cambios', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Old' } });
    await executeCommand(s, { command: 'project.archive', actor: ana, projectId, entityId: projectId, data: {} });
    await expect(
      executeCommand(s, {
        command: 'run.request',
        actor: ana,
        projectId,
        data: { action: 'echo', scope: { type: 'project' } },
      }),
    ).rejects.toMatchObject({ type: 'invalid_transition' });
  });

  it('run.request construye un context pack y el reintento reutiliza el mismo', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Packs' } });
    const r = await executeCommand(s, {
      command: 'run.request',
      actor: ana,
      projectId,
      data: { action: 'echo', scope: { type: 'project' }, input: { text: 'hello' } },
    });
    const run = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
    expect(run).toMatchObject({ state: 'queued', action: 'echo', method: 'eco@v1', requested_by: 'human:ana' });
    await executeCommand(s, {
      command: 'run.fail',
      actor: system('engine'),
      projectId,
      entityId: r.entityId,
      data: { failure_kind: 'agent_error', error: 'x' },
    });
    const retry = await executeCommand(s, { command: 'run.retry', actor: ana, projectId, data: { run_id: r.entityId } });
    const fresh = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', retry.entityId).executeTakeFirstOrThrow();
    expect(fresh.context_pack_id).toBe(run.context_pack_id);
    expect(fresh.retry_of).toBe(run.id);
    const packs = await s.db.selectFrom('context_packs').select('id').where('project_id', '=', projectId).execute();
    expect(packs).toHaveLength(1);
  });
});
