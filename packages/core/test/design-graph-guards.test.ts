// Guards on the design graph outside task_plan: approval needs a basis, a task covers only its
// feature's criteria, dependencies by title that match nothing are refused, links that close a cycle are
// refused, and approving a feature others wait for (with no task plan) says so.

import { cycleClosedBy, human, missingBasisReason, system } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import type { Services } from '../src/services.ts';
import { useEnvironment } from './support/env.ts';
import { newDecision, newExploration } from './support/recipes.ts';

const environment = useEnvironment();
const ana = human('ana');
let s: Services;
let projectId = '';
let basis: { code: string };
let n = 0;

const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string) =>
  executeCommand(s, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

beforeAll(async () => {
  s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Guards' } })).projectId;
  for (const [position, stage] of [
    [3, 'architecture'],
    [4, 'security'],
  ] as const) {
    await s.db
      .insertInto('stages')
      .values({
        project_id: projectId,
        stage,
        position,
        exploration_id: await newExploration(s, projectId),
        state: 'passed',
        opened_by: 'system:test',
        passed_by: 'human:ana',
      })
      .execute();
  }
  basis = await newDecision(s, projectId, true);
});

type Made = { recordId: string; versionId: string; code: string };
const link = (type: string, code: string) => ({ type, target: { code, version: 1 } });

async function feature(links: unknown[] | null = null): Promise<Made> {
  n += 1;
  const r = await cmd('record.create', {
    type: 'fdr',
    domain: 'guards',
    title: `Feature ${n}`,
    sections: [
      { title: 'Goal', content: 'Goal.' },
      { title: 'Scope', content: 'Scope.' },
      { title: 'Out of scope', content: 'Nothing.' },
      { title: 'Behavior', content: 'The person does it and sees it.' },
    ],
    criteria: [
      {
        carry: 'new',
        title: 'It works',
        statement: 'Given a person, when they do it, then they see the result.',
        verification: 'manual',
        check: 'Look at it.',
      },
    ],
    links: links ?? [link('based_on', basis.code)],
  });
  return r.result as Made;
}

async function task(featureCode: string, extra: Record<string, unknown> = {}, links: unknown[] = []): Promise<Made> {
  n += 1;
  const r = await cmd('record.create', {
    type: 'task',
    domain: 'guards',
    title: `Task ${n}`,
    sections: [
      { title: 'Goal', content: 'Goal.' },
      { title: 'Scope', content: 'Scope.' },
    ],
    criteria: [],
    size: 'S',
    links: [link('based_on', featureCode), ...links],
    ...extra,
  });
  return r.result as Made;
}

const criterionOf = async (versionId: string) =>
  (await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', versionId).executeTakeFirstOrThrow()).code;

describe('approval needs a basis', () => {
  it('shares its words with readiness', () => {
    expect(missingBasisReason('fdr', 0)).toContain('not based on');
    expect(missingBasisReason('fdr', 1)).toBeNull();
  });

  it('refuses a feature with no based_on link (409) and leaves it a draft', async () => {
    const f = await feature([]);
    await expect(cmd('record_version.approve', {}, f.versionId)).rejects.toMatchObject({ type: 'conflict' });
    const row = await s.db.selectFrom('record_versions').select('state').where('id', '=', f.versionId).executeTakeFirstOrThrow();
    expect(row.state).toBe('draft');
  });

  it('refuses a task with no basis and approves one that has it', async () => {
    const bare = await cmd('record.create', {
      type: 'task',
      domain: 'guards',
      title: 'Bare task',
      sections: [
        { title: 'Goal', content: 'Goal.' },
        { title: 'Scope', content: 'Scope.' },
      ],
      criteria: [],
      size: 'S',
      links: [],
    });
    await expect(cmd('record_version.approve', {}, (bare.result as Made).versionId)).rejects.toMatchObject({ type: 'conflict' });
    const f = await feature();
    await cmd('record_version.approve', {}, f.versionId);
    const ok = await task(f.code);
    await cmd('record_version.approve', {}, ok.versionId);
  });
});

describe('covers belongs to the task feature', () => {
  it('refuses a criterion of another feature, naming it (422), and accepts its own', async () => {
    const a = await feature();
    const b = await feature();
    const own = await criterionOf(a.versionId);
    const foreign = await criterionOf(b.versionId);
    await expect(task(a.code, { covers: [foreign] })).rejects.toMatchObject({ type: 'validation', message: expect.stringContaining(foreign) });
    await task(a.code, { covers: [own] });
  });
});

describe('cycles', () => {
  it('refuses a task depends_on link that closes a cycle (409)', async () => {
    const f = await feature();
    await cmd('record_version.approve', {}, f.versionId);
    const t1 = await task(f.code);
    await cmd('record_version.approve', {}, t1.versionId);
    const t2 = await task(f.code, {}, [link('depends_on', t1.code)]);
    await cmd('record_version.approve', {}, t2.versionId);
    // A new version of t1 that depends on t2 closes the cycle.
    await expect(
      cmd('record_version.create', {
        record_id: t1.recordId,
        title: 'Task one again',
        sections: [
          { title: 'Goal', content: 'Goal.' },
          { title: 'Scope', content: 'Scope.' },
        ],
        criteria: [],
        change_note: 'Now it waits for the second.',
        links: [link('based_on', f.code), link('depends_on', t2.code)],
      }),
    ).rejects.toMatchObject({ type: 'conflict', message: expect.stringContaining('cycle') });
  });

  it('refuses a feature need that closes a cycle (409)', async () => {
    const a = await feature();
    await cmd('record_version.approve', {}, a.versionId);
    const b = await feature([link('based_on', basis.code), link('based_on', a.code)]);
    await cmd('record_version.approve', {}, b.versionId);
    await expect(
      cmd('record_version.create', {
        record_id: a.recordId,
        title: 'Feature a again',
        sections: [
          { title: 'Goal', content: 'Goal.' },
          { title: 'Scope', content: 'Scope.' },
          { title: 'Out of scope', content: 'Nothing.' },
          { title: 'Behavior', content: 'The person does it and sees it.' },
        ],
        criteria: [{ carry: 'kept', code: await criterionOf(a.versionId) }],
        change_note: 'Needs b.',
        links: [link('based_on', basis.code), link('based_on', b.code)],
      }),
    ).rejects.toMatchObject({ type: 'conflict', message: expect.stringContaining('cycle') });
  });

  it('finds the cycle in the pure helper', () => {
    const graph = new Map([['a', ['b']]]);
    expect(cycleClosedBy(graph, 'b', 'a')).toEqual(['b', 'a']);
    expect(cycleClosedBy(graph, 'a', 'c')).toBeNull();
    expect(cycleClosedBy(graph, 'a', 'a')).toEqual(['a']);
  });
});

describe('depends_on_titles that match nothing', () => {
  const taskProposal = async (f: Made, title: string, titles: string[]) => {
    const r = await executeCommand(s, {
      command: 'batch.submit',
      actor: system('test'),
      projectId,
      data: {
        batch_type: 'agent',
        resolution: 'item',
        proposals: [
          {
            type: 'design_record',
            payload: {
              record_type: 'task',
              title,
              sections: [
                { title: 'Goal', content: 'Goal.' },
                { title: 'Scope', content: 'Scope.' },
              ],
              criteria: [],
              based_on: { code: f.code, version: 1 },
              size: 'S',
              size_reason: 'Small.',
              depends_on_titles: titles,
            },
          },
        ],
      },
    });
    return r;
  };

  it('refuses a title that is no task and no pending proposal (422), naming it', async () => {
    const f = await feature();
    await cmd('record_version.approve', {}, f.versionId);
    const r = (await taskProposal(f, 'Needs a ghost', ['Ghost task'])) as { result?: { proposals: string[] } };
    const id = r.result?.proposals[0];
    expect(id).toBeTruthy();
    await expect(cmd('proposal.accept', {}, id as string)).rejects.toMatchObject({
      type: 'validation',
      message: expect.stringContaining('Ghost task'),
    });
  });

  it('warns, visibly on the proposal, when the title is another pending task proposal', async () => {
    const f = await feature();
    await cmd('record_version.approve', {}, f.versionId);
    await taskProposal(f, 'Sibling pending', []);
    const r = (await taskProposal(f, 'Waits for sibling', ['Sibling pending'])) as { result: { proposals: string[] } };
    const accepted = await cmd('proposal.accept', {}, r.result.proposals[0]);
    const effect = accepted.result as { warnings?: string[] };
    expect(effect.warnings?.[0]).toContain('Sibling pending');
    const row = await s.db.selectFrom('proposals').select('resolution').where('id', '=', r.result.proposals[0] as string).executeTakeFirstOrThrow();
    expect(JSON.stringify(row.resolution)).toContain('Sibling pending');
  });
});

describe('approving a feature others wait for', () => {
  it('carries the notice when others wait for it and it has no task plan', async () => {
    const a = await feature();
    const b = await feature([link('based_on', basis.code), link('based_on', a.code)]);
    await cmd('record_version.approve', {}, a.versionId).then((r) => {
      expect(r.result).toMatchObject({ waiting_without_plan: 1 });
      expect((r.result as { notice: string }).notice).toContain('1 item waits for this feature and it has no task plan yet');
    });
    expect(b.code).toBeTruthy();
  });

  it('has no notice when nobody waits, or when it already has tasks', async () => {
    const lone = await feature();
    expect((await cmd('record_version.approve', {}, lone.versionId)).result).toBeUndefined();
    const a = await feature();
    await cmd('record_version.approve', {}, a.versionId);
    await task(a.code);
    await feature([link('based_on', basis.code), link('based_on', a.code)]);
    const second = await cmd('record_version.create', {
      record_id: a.recordId,
      title: 'Feature a v2',
      sections: [
        { title: 'Goal', content: 'Goal.' },
        { title: 'Scope', content: 'Scope.' },
        { title: 'Out of scope', content: 'Nothing.' },
        { title: 'Behavior', content: 'The person does it and sees it.' },
      ],
      criteria: [{ carry: 'kept', code: await criterionOf(a.versionId) }],
      change_note: 'Again.',
      links: [link('based_on', basis.code)],
    });
    const done = await cmd('record_version.approve', {}, (second.result as { versionId: string }).versionId);
    expect(done.result).toBeUndefined();
  });
});
