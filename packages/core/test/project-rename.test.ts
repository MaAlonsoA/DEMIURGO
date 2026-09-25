// Renaming a project: a person's act with its event (the old and the new name); an agent cannot.

import { externalAgent, human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { useEnvironment } from './support/env.ts';

const ana = human('ana');
const environment = useEnvironment();

describe('project.rename', () => {
  it('renames the project and records the old and the new name in its event', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Club Activities' } });
    await executeCommand(s, {
      command: 'project.rename',
      actor: ana,
      projectId,
      entityId: projectId,
      data: { name: 'Club Life' },
    });
    const { rows } = await sql<{ name: string }>`select name from projects where id = ${projectId}::uuid`.execute(s.db);
    expect(rows[0]?.name).toBe('Club Life');
    const { rows: events } = await sql<{ before: { name: string }; after: { name: string } }>`
      select before, after from events where command = 'project.rename' and entity_id = ${projectId}::uuid`.execute(s.db);
    expect(events).toEqual([{ before: { name: 'Club Activities' }, after: { name: 'Club Life' } }]);
  });

  it('refuses an empty name', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Keep me' } });
    await expect(
      executeCommand(s, { command: 'project.rename', actor: ana, projectId, entityId: projectId, data: { name: '  ' } }),
    ).rejects.toMatchObject({ type: 'validation' });
  });

  it('is not for an external agent', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Mine' } });
    await expect(
      executeCommand(s, {
        command: 'project.rename',
        actor: externalAgent('claude-code', 'session'),
        projectId,
        entityId: projectId,
        data: { name: 'Theirs' },
      }),
    ).rejects.toMatchObject({ type: 'forbidden' });
  });
});
