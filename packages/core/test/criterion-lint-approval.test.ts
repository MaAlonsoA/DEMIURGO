// Approving a feature whose automatic criteria look like they need the deployed candidate is refused
// (409) unless the person gives a reason, which is kept in the event.

import { human } from '@demiurgo/domain';
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

const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string) =>
  executeCommand(s, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

beforeAll(async () => {
  s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Lint' } })).projectId;
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

async function feature(statement: string, verification: 'automatic' | 'release', domain: string) {
  const r = await cmd('record.create', {
    type: 'fdr',
    domain,
    title: `Feature ${domain}`,
    sections: [
      { title: 'Goal', content: 'Search meals quickly.' },
      { title: 'Scope', content: 'Search.' },
      { title: 'Out of scope', content: 'Sharing.' },
      { title: 'Behavior', content: 'The person types and sees results.' },
    ],
    criteria: [{ carry: 'new', title: 'Search speed', statement, verification, check: 'Measure it.' }],
    links: [{ type: 'based_on', target: { code: basis.code, version: 1 } }],
  });
  return (r.result as { versionId: string }).versionId;
}

describe('criterion lint blocks approval', () => {
  const slow =
    'Given five years of meal records on a mobile connection, when the person searches, then results appear within 2 seconds in 95 % of the cases.';

  it('refuses approval without a reason (409) and leaves the version a draft', async () => {
    const id = await feature(slow, 'automatic', 'lintone');
    await expect(cmd('record_version.approve', {}, id)).rejects.toMatchObject({ type: 'conflict' });
    const row = await s.db.selectFrom('record_versions').select('state').where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.state).toBe('draft');
  });

  it('accepts approval with a reason and stores it in the event', async () => {
    const id = await feature(slow, 'automatic', 'linttwo');
    await cmd('record_version.approve', { override_reason: 'The budget is checked by a synthetic benchmark in CI.' }, id);
    const ev = await s.db
      .selectFrom('events')
      .selectAll()
      .where('command', '=', 'record_version.approve')
      .where('entity_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(ev)).toContain('synthetic benchmark');
  });

  it('approves without a reason when the criterion is already release', async () => {
    const id = await feature(slow, 'release', 'lintthree');
    await cmd('record_version.approve', {}, id);
    const row = await s.db.selectFrom('record_versions').select('state').where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.state).toBe('approved');
  });
});
