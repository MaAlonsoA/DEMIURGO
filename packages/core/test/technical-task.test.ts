// A technical task (an enabler: CI, tests, infrastructure) is based on a decision, a quality requirement or
// the product definition instead of a feature: it can be readied, queued and requested to build without one.

import { human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { computeRequestBasis } from '../src/build/basis.ts';
import { buildQueue } from '../src/build/queue.ts';
import { versionReadiness } from '../src/queries/read.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');
let projectId = '';
const s = () => environment().services;
type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string) =>
  executeCommand(s(), { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

type Made = { recordId: string; versionId: string; code: string; n?: number };

beforeAll(async () => {
  projectId = (await executeCommand(s(), { command: 'project.create', actor: ana, data: { name: 'Technical' } })).projectId;
});

async function decision(): Promise<Made> {
  const r = await cmd('record.create', {
    type: 'adr',
    domain: 'ci',
    title: 'Run CI on every pull request',
    sections: [
      { title: 'Context', content: 'Merges need a quick signal.' },
      { title: 'Options', content: 'Run all tests, or only the affected ones.' },
      { title: 'Decision', content: 'Run the affected tests.' },
      { title: 'Consequences', content: 'Faster feedback.' },
    ],
    criteria: [{ carry: 'new', title: 'Fast', statement: 'Given a pull request, when CI runs, then it finishes quickly.', verification: 'manual', check: 'Watch a run.' }],
    links: [],
  });
  const made = r.result as Made;
  await cmd('record_version.approve', {}, made.versionId);
  return made;
}

async function technicalTask(basis: Made, title: string): Promise<Made> {
  const r = await cmd('record.create', {
    type: 'task',
    domain: 'ci',
    title,
    sections: [
      { title: 'Goal', content: 'Make CI fast.' },
      { title: 'Scope', content: 'The workflow file.' },
    ],
    size: 'S',
    criteria: [],
    links: [{ type: 'based_on', target: { code: basis.code, version: 1 } }],
  });
  const made = r.result as Made;
  await cmd('record_version.approve', {}, made.versionId);
  return made;
}

describe('technical task', () => {
  it('a task based on a decision is ready, queued under no feature and can be requested to build', async () => {
    const adr = await decision();
    const task = await technicalTask(adr, 'Fast CI');

    const readiness = await versionReadiness(s().db, projectId, task.versionId);
    expect(readiness.reasons.filter((r) => /feature|based on/i.test(r))).toEqual([]);

    const queue = await buildQueue(s().db, projectId);
    const line = queue.ready.find((t) => t.code === task.code);
    expect(line).toBeDefined();
    expect(line?.feature).toBeNull();
    expect(line?.epic).toBeNull();
    expect(line?.technical).toEqual({ code: adr.code, title: 'Run CI on every pull request', type: 'adr' });

    const basis = await s().db.transaction().execute((trx) => computeRequestBasis(trx, projectId, { id: task.recordId, code: task.code }));
    expect(basis.feature).toBeNull();
    expect(basis.brief).toContain(`technical task`);
    expect(basis.brief).toContain(adr.code);

    await cmd('build_request.request', { task: task.code });
    const request = await s().db.selectFrom('build_requests').select(['feature_version_id']).where('task_id', '=', task.recordId).executeTakeFirstOrThrow();
    expect(request.feature_version_id).toBeNull();
  });

  it('a task based on nothing is not ready and says what it can rest on', async () => {
    const r = await cmd('record.create', {
      type: 'task',
      domain: 'ci',
      title: 'Orphan',
      sections: [
        { title: 'Goal', content: 'g' },
        { title: 'Scope', content: 's' },
      ],
      size: 'S',
      criteria: [],
      links: [],
    });
    const made = r.result as Made;
    await cmd('record_version.approve', {}, made.versionId);
    const readiness = await versionReadiness(s().db, projectId, made.versionId);
    expect(readiness.reasons).toContain('It is not based on any feature, decision, quality requirement or the product definition.');
  });

  it('a new version of a feature task can move its basis to a decision', async () => {
    const SECTIONS = [
      { title: 'Goal', content: 'Do it.' },
      { title: 'Scope', content: 'Just that.' },
      { title: 'Out of scope', content: 'Nothing else.' },
      { title: 'Behavior', content: 'The person does it and sees the result.' },
    ];
    const f = await cmd('record.create', {
      type: 'fdr',
      domain: 'meal',
      title: 'Record a meal',
      sections: SECTIONS,
      criteria: [{ carry: 'new', title: 'a', statement: 'Given a person, when she does it, then she sees the result.', verification: 'automatic', check: 'E2E.' }],
      links: [],
    });
    const feature = f.result as Made;
    await cmd('record_version.approve', {}, feature.versionId);
    const adr = await decision();
    const created = await cmd('record.create', {
      type: 'task',
      domain: 'ci',
      title: 'Affected e2e',
      sections: SECTIONS.slice(0, 2),
      size: 'S',
      criteria: [],
      links: [{ type: 'based_on', target: { code: feature.code, version: 1 } }],
    });
    const task = created.result as Made;
    await cmd('record_version.approve', {}, task.versionId);
    const before = await buildQueue(s().db, projectId);
    expect([...before.ready, ...before.waiting].find((t) => t.code === task.code)?.feature?.code).toBe(feature.code);

    const next = await cmd('record_version.create', {
      record_id: task.recordId,
      change_note: 'It is a technical task: based on a decision, not a feature.',
      title: 'Affected e2e',
      sections: SECTIONS.slice(0, 2),
      criteria: [],
      links: [{ type: 'based_on', target: { code: adr.code, version: 1 } }],
    });
    await cmd('record_version.approve', {}, (next.result as Made).versionId);
    const line = (await buildQueue(s().db, projectId)).ready.find((t) => t.code === task.code);
    expect(line?.feature).toBeNull();
    expect(line?.technical?.code).toBe(adr.code);
  });
});
