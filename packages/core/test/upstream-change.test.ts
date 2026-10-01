// A review thread about a suspect record carries `upstream_change`: what the upstream record changed
// between the version it rests on and the current one, with each criterion's full statement.

import { human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { buildContext } from '../src/context/build.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');
let projectId = '';
const s = () => environment().services;
type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string) =>
  executeCommand(s(), { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

const FDR = (behavior: string) => [
  { title: 'Goal', content: 'Members sign up.' },
  { title: 'Scope', content: 'Name and email.' },
  { title: 'Out of scope', content: 'Payments.' },
  { title: 'Behavior', content: behavior },
];
const DECISION = [
  { title: 'Context', content: 'c' },
  { title: 'Decision', content: 'd' },
  { title: 'Consequences', content: 'k' },
];

beforeAll(async () => {
  projectId = (await executeCommand(s(), { command: 'project.create', actor: ana, data: { name: 'Upstream' } })).projectId;
});

describe('upstream_change in a suspect review thread', () => {
  it('lists the modified criterion with its statement, the changed section and what the record covers', async () => {
    const f = (
      await cmd('record.create', {
        type: 'fdr',
        domain: 'socios',
        title: 'Sign up',
        sections: FDR('The person fills in the form.'),
        criteria: [
          { carry: 'new', title: 'Flaky', statement: 'Given a form, when it is sent, then it works.', verification: 'automatic', check: 'E2E.' },
          { carry: 'new', title: 'Stable', statement: 'Given a member, when she signs up, then she is listed.', verification: 'automatic', check: 'E2E.' },
        ],
      })
    ).result as { recordId: string; versionId: string; code: string };
    await cmd('record_version.approve', {}, f.versionId);
    const adr = (
      await cmd('record.create', {
        type: 'decision',
        domain: 'socios',
        title: 'Use a form',
        sections: DECISION,
        links: [{ type: 'based_on', target: { code: f.code, version: 1 } }],
      })
    ).result as { recordId: string; versionId: string; code: string };
    await cmd('record_version.approve', {}, adr.versionId);

    const v2 = await cmd('record_version.create', {
      record_id: f.recordId,
      title: 'Sign up',
      sections: FDR('The person fills in the form and sees a confirmation.'),
      criteria: [
        {
          carry: 'modified',
          derived_from: `${f.code.replace('FDR', 'AC')}-01`,
          title: 'Deterministic',
          statement: 'Given a form, when it is sent, then the result is deterministic.',
          verification: 'automatic',
          check: 'Seeded E2E.',
        },
        { carry: 'kept', code: `${f.code.replace('FDR', 'AC')}-02` },
      ],
      change_note: 'Deterministic test.',
    });
    await cmd('record_version.approve', {}, v2.entityId);

    const thread = await cmd('exploration.open', {
      purpose: `Review ${adr.code} v1: ${f.code} changed from v1 to v2`,
      origin: { type: 'record_version', id: adr.versionId, version: 1 },
    });
    const pack = await s()
      .db.transaction()
      .execute((trx) => buildContext(trx, projectId, 'exploration_chat', { type: 'exploration', id: thread.entityId }, {}, 0));
    const change = (pack.pack.content as { upstream_change?: Record<string, unknown> }).upstream_change;
    expect(change).toMatchObject({
      upstream: f.code,
      from_version: 1,
      to_version: 2,
      covered_criteria: [],
      changed_sections: [{ title: 'Behavior', change: 'modified', after: 'The person fills in the form and sees a confirmation.' }],
      changed_criteria: [
        {
          change: 'modified',
          before: { statement: 'Given a form, when it is sent, then it works.' },
          after: { title: 'Deterministic', statement: 'Given a form, when it is sent, then the result is deterministic.', verification: 'automatic', check: 'Seeded E2E.' },
        },
      ],
    });
    expect((change?.changed_criteria as unknown[]).length).toBe(1);
  });
});
