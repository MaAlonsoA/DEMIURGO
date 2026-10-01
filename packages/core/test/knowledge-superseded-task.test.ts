// A task that is built and merged is a historical record: a later task that changes the same thing
// supersedes it (ADR «Superseded by», Nygard 2011; convención nuestra). It is recorded in the update's
// operations and never raised as a review that would make the queue rebuild merged work.

import { randomUUID } from 'node:crypto';
import { human, system } from '@demiurgo/domain';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { inbox } from '../src/queries/read.ts';
import type { Services } from '../src/services.ts';
import { createScriptedClassifier, response } from './support/scripted-classifier.ts';
import { useEnvironment } from './support/env.ts';

const script = createScriptedClassifier();
const environment = useEnvironment({ classifier: () => script });
const ana = human('ana');
let s: Services;

beforeAll(() => {
  s = environment().services;
});
beforeEach(() => script.reset());

const unique = () => randomUUID().slice(0, 8);
const cmd = (projectId: string, command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string) =>
  executeCommand(s, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

type Made = { recordId: string; versionId: string; code: string };

/** A record that stands in for a task: only its `type` and, when built, its done build request matter here. */
async function record(
  projectId: string,
  type: 'task' | 'decision',
  title: string,
  text: string,
  opts: { approve: boolean; built?: boolean; basis?: Made },
) {
  const r = await cmd(projectId, 'record.create', {
    type,
    ...(type === 'task' ? { size: 'S' } : {}),
    domain: 'socios',
    title,
    ...(type === 'task' ? { criteria: [], links: opts.basis ? [{ type: 'based_on', target: { code: opts.basis.code, version: 1 } }] : [] } : {}),
    sections:
      type === 'task'
        ? [
            { title: 'Goal', content: `Goal of ${title}.` },
            { title: 'Scope', content: text },
          ]
        : [
            { title: 'Context', content: `Contexto de ${title}.` },
            { title: 'Decision', content: text },
            { title: 'Consequences', content: 'Hay que diseñarlo.' },
          ],
  });
  const made = r.result as Made;
  if (opts.built)
    await s.db
      .insertInto('build_requests')
      .values({
        project_id: projectId,
        task_id: made.recordId,
        task_version_id: made.versionId,
        brief: 'b',
        requested_by: 'human:ana',
        state: 'done',
      })
      .execute();
  if (opts.approve) await cmd(projectId, 'record_version.approve', {}, made.versionId);
  return made;
}

const conflicting = (t: string) => (items: readonly { id: string }[]) =>
  items.map((i) => response(i.id, 'update', 0.98, `Change: "CI runs only on main ${t}" Candidate: "CI runs on every push ${t}"`));

async function setup(oldBuilt: boolean, changeType: 'task' | 'decision') {
  const p = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: `Superseded ${unique()}` } })).projectId;
  const t = unique();
  // Sibling tasks rest on the same decision: that is how knowledge compares a task with another task.
  const adr = (
    await cmd(p, 'record.create', {
      type: 'adr',
      domain: 'socios',
      title: `CI policy ${t}`,
      sections: [
        { title: 'Context', content: 'Merges need a signal.' },
        { title: 'Options', content: 'Every push, or only main.' },
        { title: 'Decision', content: 'Run CI.' },
        { title: 'Consequences', content: 'Feedback.' },
      ],
      criteria: [],
      links: [],
    })
  ).result as Made;
  await cmd(p, 'record_version.approve', {}, adr.versionId);
  const old = await record(p, 'task', `CI on every push ${t}`, `CI runs on every push ${t}.`, { approve: true, built: oldBuilt, basis: adr });
  script.scripts.verdict = conflicting(t);
  await record(p, changeType, `CI only on main ${t}`, `CI runs only on main ${t}.`, { approve: true, basis: adr });
  return { p, old };
}

const reviewsOf = async (p: string) => (await inbox(s.db, p)).batches.filter((b) => b.type === 'knowledge').flatMap((b) => b.proposals);

describe('A later task supersedes a built task', () => {
  it('a task change does not raise a review on a built task: it records the supersession', async () => {
    const { p, old } = await setup(true, 'task');
    expect(await reviewsOf(p)).toHaveLength(0);
    const us = await s.db.selectFrom('knowledge_updates').select(['state', 'operations']).where('project_id', '=', p).orderBy('trigger_seq').execute();
    expect(us.at(-1)?.state).toBe('applied');
    expect(us.at(-1)?.operations).toMatchObject({ superseded: [{ record: old.code, version: 1 }] });
  });

  it('a task change still raises the review on a task that is not built', async () => {
    const { p, old } = await setup(false, 'task');
    expect(await reviewsOf(p)).toMatchObject([{ type: 'review', payload: { record: { code: old.code, version: 1 }, verdict: 'update' } }]);
  });

  it('a non-task change still raises the review on a built task', async () => {
    const { p, old } = await setup(true, 'decision');
    expect(await reviewsOf(p)).toMatchObject([{ type: 'review', payload: { record: { code: old.code, version: 1 } } }]);
  });
});

describe('The explorer never recommends rebuilding merged work', () => {
  it('its instructions put «Keep it as built» first for a built and merged task', async () => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(new URL('../agents/explorer/AGENT.md', import.meta.url), 'utf8');
    expect(text).toContain('built_and_merged');
    expect(text).toContain('Keep it as built: a new task does the change');
    expect(text).toContain('Nygard');
    expect(text).toContain('convención nuestra');
  });
});

void system;
