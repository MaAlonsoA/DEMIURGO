// A build request keeps its snapshot immutable; adopting newer approved versions is appended to
// build_request_bases and the latest row is the effective basis.

import { human } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { effectiveBasis, withEffectiveBasis } from '../src/build/basis.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');

describe('build_request_bases', () => {
  it('is append-only and the latest row is the effective basis, while the snapshot stays immutable', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Bases' } });
    const thread = (await executeCommand(s, { command: 'exploration.open', actor: ana, projectId, data: { purpose: 'Bases' } })).entityId;
    const versionOf = async (title: string) => {
      const made = await executeCommand(s, {
        command: 'record.create',
        actor: ana,
        projectId,
        data: {
          type: 'fdr',
          domain: 'bases',
          title,
          sections: [
            { title: 'Goal', content: 'A goal.' },
            { title: 'Scope', content: 'Scope.' },
            { title: 'Out of scope', content: 'Nothing.' },
            { title: 'Behavior', content: '1. It works.' },
          ],
          criteria: [{ carry: 'new', title: 'One', statement: 'Given a, when b, then c.', verification: 'automatic', check: 'A test.' }],
          origin: { type: 'exploration', id: thread },
        },
      });
      return { recordId: made.entityId, versionId: (made.result as { versionId: string }).versionId };
    };
    // Any record versions do: the table only references them.
    const first = await versionOf('First');
    const second = await versionOf('Second');
    const request = await s.db
      .insertInto('build_requests')
      .values({
        project_id: projectId,
        task_id: first.recordId,
        task_version_id: first.versionId,
        feature_version_id: null,
        brief: 'old brief',
        requested_by: 'human:ana',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    expect(await effectiveBasis(s.db, request.id)).toEqual({ task_version_id: first.versionId, feature_version_id: null, brief: 'old brief' });

    await s.db
      .insertInto('build_request_bases')
      .values({ project_id: projectId, build_request_id: request.id, task_version_id: second.versionId, feature_version_id: first.versionId, brief: 'new brief', adopted_by: 'human:ana', attempt: 2 })
      .execute();
    expect(await effectiveBasis(s.db, request.id)).toEqual({ task_version_id: second.versionId, feature_version_id: first.versionId, brief: 'new brief' });
    const [row] = await withEffectiveBasis(s.db, [{ id: request.id, task_version_id: first.versionId, feature_version_id: null, brief: 'old brief' }]);
    expect(row).toMatchObject({ task_version_id: second.versionId, brief: 'new brief' });

    // The snapshot is still immutable and the history cannot be changed.
    await expect(s.db.updateTable('build_requests').set({ brief: 'x' }).where('id', '=', request.id).execute()).rejects.toThrow(/immutable/);
    await expect(s.db.updateTable('build_request_bases').set({ brief: 'x' }).where('build_request_id', '=', request.id).execute()).rejects.toThrow(/append-only/);
    await expect(s.db.deleteFrom('build_request_bases').where('build_request_id', '=', request.id).execute()).rejects.toThrow(/append-only/);
  });
});
