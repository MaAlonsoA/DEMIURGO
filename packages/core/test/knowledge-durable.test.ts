// "Update knowledge" with the durable engine (DBOS): retrying a rejected update starts a new
// workflow, and a classification failure never leaves an update in progress.

import { randomUUID } from 'node:crypto';
import { type Actor, human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForKnowledge } from '../src/knowledge/workflows.ts';
import { compareRebuild } from '../src/knowledge/rebuild.ts';
import type { Services } from '../src/services.ts';
import { createScriptedClassifier } from './support/scripted-classifier.ts';
import { useEnvironment } from './support/env.ts';

const script = createScriptedClassifier();
const environment = useEnvironment({ durable: true, classifier: () => script });
const ana = human('ana');
let s: Services;

beforeAll(() => {
  s = environment().services;
});

const unique = () => randomUUID().slice(0, 8);
const cmd = (
  projectId: string,
  command: Parameters<typeof executeCommand>[1]['command'],
  data: unknown,
  entityId?: string,
  actor: Actor = ana,
) => executeCommand(s, { command, actor, projectId, data, ...(entityId ? { entityId } : {}) });

async function newProject(name: string): Promise<string> {
  return (await executeCommand(s, { command: 'project.create', actor: ana, data: { name } })).projectId;
}

async function decision(p: string, title: string, text: string) {
  const r = await cmd(p, 'record.create', {
    type: 'decision',
    domain: 'socios',
    title,
    sections: [
      { title: 'Context', content: `Contexto de ${title}.` },
      { title: 'Decision', content: text },
      { title: 'Consequences', content: 'Hay que diseñarlo.' },
    ],
  });
  const res = r.result as { recordId: string; versionId: string; code: string };
  await cmd(p, 'record_version.approve', {}, res.versionId);
  await waitForKnowledge(s, p);
  return res;
}

const states = async (p: string) =>
  (
    await s.db
      .selectFrom('knowledge_updates')
      .select(['id', 'state'])
      .where('project_id', '=', p)
      .orderBy('trigger_seq')
      .orderBy('id')
      .execute()
  ).map((u) => u.state);

describe('knowledge with the durable engine', () => {
  it('AC-CON-001-07 retrying a rejected update starts a new workflow and unblocks freshness', async () => {
    script.reset();
    const p = await newProject('Durable retry');
    const t = unique();
    await decision(p, `Invitados ${t}`, `Cada socio puede traer invitados ${t}.`);
    script.scripts.verdict = () => [];
    const d2 = await decision(p, `Invitados limitados ${t}`, `Cada socio puede traer dos invitados ${t}.`);
    expect(await states(p)).toEqual(['applied', 'rejected']);
    script.reset();
    const rejected = (
      await s.db
        .selectFrom('knowledge_updates')
        .select('id')
        .where('project_id', '=', p)
        .where('state', '=', 'rejected')
        .executeTakeFirstOrThrow()
    ).id;
    await cmd(p, 'knowledge_update.retry', {}, rejected);
    await waitForKnowledge(s, p, 10_000);
    expect(await states(p)).toEqual(['applied', 'applied']);
    // With everything applied, requesting a run no longer collides with the freshness gate.
    await expect(
      cmd(p, 'run.request', { action: 'design_proposal', scope: { type: 'record_version', id: d2.versionId } }),
    ).resolves.toMatchObject({ state: 'queued' });
    expect(await compareRebuild(s.db, p)).toMatchObject({ equal: true });
  });

  it('AC-CON-001-07 a persistent classification failure leaves the update rejected, never in progress', async () => {
    script.reset();
    const p = await newProject('Classification failure');
    const t = unique();
    await decision(p, `One ${t}`, `One ${t}.`);
    // A trigger that makes derivation fail on every attempt (like a persistent database failure).
    const { rows } = await sql<{ id: string }>`insert into knowledge_updates (project_id, trigger, trigger_seq, state)
      values (${p}::uuid, ${JSON.stringify({ type: 'record_version', id: 'not-a-uuid', version: 1 })}::jsonb, 1000, 'queued') returning id`.execute(
      s.db,
    );
    await s.engine.startUpdate(rows[0]?.id ?? '', p);
    await waitForKnowledge(s, p, 15_000);
    expect(await states(p)).toEqual(['applied', 'rejected']);
    const u = await s.db
      .selectFrom('knowledge_updates')
      .select('failure')
      .where('id', '=', rows[0]?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(u.failure).toMatch(/Could not classify the change/);
    // The queue continues: the next authority event gets applied.
    await decision(p, `Two ${t}`, `Two ${t}.`);
    // (The injected trigger carries trigger_seq 1000: it sorts last.)
    expect(await states(p)).toEqual(['applied', 'applied', 'rejected']);
  });
});
