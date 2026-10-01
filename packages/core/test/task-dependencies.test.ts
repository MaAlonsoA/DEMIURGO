// Task dependencies are data the build engine enforces: a task is not ready while a task it depends on
// is not merged or a feature it waits for is not built, and the queue orders tasks by them.

import { dependencyReasons, human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { buildQueue } from '../src/build/queue.ts';
import { versionReadiness } from '../src/queries/read.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');
let projectId = '';
const s = () => environment().services;
const db = () => s().db;
type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string) =>
  executeCommand(s(), { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

type Made = { recordId: string; versionId: string; code: string };
type Link = { type: string; target: { code: string; version: number } };

const SECTIONS = [
  { title: 'Goal', content: 'Do it.' },
  { title: 'Scope', content: 'Just that.' },
  { title: 'Out of scope', content: 'Nothing else.' },
  { title: 'Behavior', content: 'The person does it and sees the result.' },
];
const CRITERION = {
  carry: 'new',
  title: 'a',
  statement: 'Given a person, when she does it, then she sees the result.',
  verification: 'automatic',
  check: 'E2E.',
};

async function feature(domain: string): Promise<Made> {
  const r = await cmd('record.create', {
    type: 'fdr',
    domain,
    title: `Feature ${domain}`,
    sections: SECTIONS,
    criteria: [CRITERION],
    links: [],
  });
  const made = r.result as Made;
  await cmd('record_version.approve', {}, made.versionId);
  return made;
}

async function task(feat: Made, title: string, links: Link[] = []): Promise<Made> {
  const r = await cmd('record.create', {
    type: 'task',
    domain: feat.code.slice(4, 7).toLowerCase(),
    title,
    sections: SECTIONS.slice(0, 2),
    size: 'S',
    criteria: [],
    links: [{ type: 'based_on', target: { code: feat.code, version: 1 } }, ...links],
  });
  const made = r.result as Made;
  await cmd('record_version.approve', {}, made.versionId);
  return made;
}

/** A merged pull request: a done build request on the task's approved version. */
async function merge(t: Made) {
  const request = await db()
    .insertInto('build_requests')
    .values({
      project_id: projectId,
      task_id: t.recordId,
      task_version_id: t.versionId,
      feature_version_id: null,
      brief: `Build ${t.code}.`,
      requested_by: 'human:ana',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db()
    .updateTable('build_requests')
    .set({ state: 'done', done_by: 'system:build@1', done_at: new Date() })
    .where('id', '=', request.id)
    .execute();
}

const waits = async (t: Made) =>
  (await versionReadiness(db(), projectId, t.versionId)).reasons.filter(
    (r) => r.startsWith('Waits for') || r.startsWith('Dependency cycle'),
  );

beforeAll(async () => {
  projectId = (await executeCommand(s(), { command: 'project.create', actor: ana, data: { name: 'Dependencies' } })).projectId;
});

describe('task dependencies', () => {
  it('a task waits for the task it depends on until it is merged, and for a feature until all its tasks are merged', async () => {
    const f1 = await feature('zulu');
    const f2 = await feature('alpha');
    const t1 = await task(f1, 'Base task');
    const t2 = await task(f1, 'Second task', [{ type: 'depends_on', target: { code: t1.code, version: 1 } }]);
    const t3 = await task(f2, 'Task of another feature', [{ type: 'depends_on', target: { code: f1.code, version: 1 } }]);
    const noTasks = await feature('mike');
    const t4 = await task(f2, 'Waits for a feature without tasks', [
      { type: 'depends_on', target: { code: noTasks.code, version: 1 } },
    ]);

    expect(await waits(t1)).toEqual([]);
    expect(await waits(t2)).toEqual([`Waits for ${t1.code} Base task (not merged yet).`]);
    expect(await waits(t3)).toEqual([`Waits for ${f1.code} Feature zulu (not built yet).`]);
    expect(await waits(t4)).toEqual([`Waits for ${noTasks.code} Feature mike (not built yet).`]);

    await merge(t1);
    expect(await waits(t2)).toEqual([]);
    // The feature still has a task that is not merged.
    expect(await waits(t3)).toEqual([`Waits for ${f1.code} Feature zulu (not built yet).`]);
    await merge(t2);
    expect(await waits(t3)).toEqual([]);
    expect(await waits(t4)).toHaveLength(1);

    // What the Build page shows: every unmet dependency is a reason of the waiting task.
    const queue = await buildQueue(db(), projectId);
    const reasons = queue.waiting.find((w) => w.code === t4.code)?.reasons ?? [];
    expect(reasons).toContain(`Waits for ${noTasks.code} Feature mike (not built yet).`);
    expect(queue.ready.map((r) => r.code)).not.toContain(t4.code);
  });

  it('the queue orders tasks by their dependencies, and a task waiting for a feature goes after that feature’s tasks', async () => {
    const early = await feature('bravo');
    const late = await feature('yankee');
    const a = await task(early, 'Depends on the later one');
    const b = await task(early, 'Created after, built first');
    const c = await task(late, 'Late feature task');
    const w = await task(early, 'Waits for the late feature');
    // The dependency is added later, in a new version of the first task (it carries the other links).
    const v = await cmd('record_version.create', {
      record_id: a.recordId,
      title: 'Depends on the later one',
      sections: SECTIONS.slice(0, 2),
      criteria: [],
      links: [
        { type: 'based_on', target: { code: early.code, version: 1 } },
        { type: 'depends_on', target: { code: b.code, version: 1 } },
      ],
      change_note: 'Waits for the second task.',
    });
    await cmd('record_version.approve', {}, v.entityId);
    const v2 = await cmd('record_version.create', {
      record_id: w.recordId,
      title: 'Waits for the late feature',
      sections: SECTIONS.slice(0, 2),
      criteria: [],
      links: [
        { type: 'based_on', target: { code: early.code, version: 1 } },
        { type: 'depends_on', target: { code: late.code, version: 1 } },
      ],
      change_note: 'Waits for the late feature.',
    });
    await cmd('record_version.approve', {}, v2.entityId);

    const queue = await buildQueue(db(), projectId);
    const order = [...queue.ready, ...queue.waiting].map((x) => x.code);
    const at = (t: Made) => order.indexOf(t.code);
    expect(at(b)).toBeGreaterThanOrEqual(0);
    expect(at(b)).toBeLessThan(at(a));
    expect(at(c)).toBeLessThan(at(w));
    // Ties keep the current order: the first task stayed before the one that waits for a feature.
    expect(at(a)).toBeLessThan(at(w));
  });

  it('a dependency cycle makes the tasks in it not ready and never hangs the queue', async () => {
    const f = await feature('delta');
    const a = await task(f, 'Cycle A');
    const b = await task(f, 'Cycle B', [{ type: 'depends_on', target: { code: a.code, version: 1 } }]);
    const v = await cmd('record_version.create', {
      record_id: a.recordId,
      title: 'Cycle A',
      sections: SECTIONS.slice(0, 2),
      criteria: [],
      links: [
        { type: 'based_on', target: { code: f.code, version: 1 } },
        { type: 'depends_on', target: { code: b.code, version: 1 } },
      ],
      change_note: 'Closes the cycle.',
    });
    await cmd('record_version.approve', {}, v.entityId);
    const currentA = (
      await db()
        .selectFrom('record_versions')
        .select('id')
        .where('record_id', '=', a.recordId)
        .where('n', '=', 2)
        .executeTakeFirstOrThrow()
    ).id;
    const reasons = (await versionReadiness(db(), projectId, currentA)).reasons;
    expect(reasons).toContain(`Dependency cycle with ${b.code}.`);
    const queue = await buildQueue(db(), projectId);
    expect(queue.waiting.map((x) => x.code)).toEqual(expect.arrayContaining([a.code, b.code]));
  });

  it('dependencyReasons names each unmet dependency in the words of the Build page', () => {
    expect(
      dependencyReasons({
        cycle: null,
        tasks: [
          { code: 'TSK-AAA-001', title: 'One', merged: true },
          { code: 'TSK-AAA-002', title: 'Two', merged: false },
        ],
        features: [{ code: 'FDR-BBB-001', title: 'Other', built: false }],
      }),
    ).toEqual(['Waits for TSK-AAA-002 Two (not merged yet).', 'Waits for FDR-BBB-001 Other (not built yet).']);
  });
});
