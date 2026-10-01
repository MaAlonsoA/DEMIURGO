// Deterministic impact (suspect links): approving a new version of a record puts what rests on the older
// version under review, until the person says it still holds («Still valid»: link.revalidate).

import { human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { inbox, recordDetail, versionReadiness } from '../src/queries/read.ts';
import { suspectRecords } from '../src/queries/impact.ts';
import { useEnvironment } from './support/env.ts';
import { newDecision } from './support/recipes.ts';

const environment = useEnvironment();
const ana = human('ana');
let projectId = '';
const s = () => environment().services;
const db = () => s().db;
type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string) =>
  executeCommand(s(), { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

const SECTIONS = [
  { title: 'Context', content: 'c2' },
  { title: 'Decision', content: 'd2' },
  { title: 'Consequences', content: 'k2' },
];
const FDR = [
  { title: 'Goal', content: 'Members sign up.' },
  { title: 'Scope', content: 'Name and email.' },
  { title: 'Out of scope', content: 'Payments.' },
  { title: 'Behavior', content: 'The person fills in the form and sees the confirmation.' },
];

async function newDecisionVersion(recordId: string) {
  const v = await cmd('record_version.create', { record_id: recordId, title: 'Revised', sections: SECTIONS, change_note: 'Change.' });
  await cmd('record_version.approve', {}, v.entityId);
}

beforeAll(async () => {
  projectId = (await executeCommand(s(), { command: 'project.create', actor: ana, data: { name: 'Impact' } })).projectId;
});

describe('suspect links', () => {
  it('a new approved version of the basis makes what rests on the old one suspect, until «Still valid»', async () => {
    const d = await newDecision(s(), projectId, true);
    const created = await cmd('record.create', {
      type: 'fdr',
      domain: 'socios',
      title: 'Sign up',
      sections: FDR,
      criteria: [
        { carry: 'new', title: 'a', statement: 'Given a member, when she submits, then she sees the confirmation.', verification: 'automatic', check: 'E2E.' },
      ],
      links: [{ type: 'based_on', target: { code: d.code, version: 1 } }],
    });
    const f = created.result as { recordId: string; versionId: string; code: string };
    await cmd('record_version.approve', {}, f.versionId);
    expect(await suspectRecords(db(), projectId)).toEqual([]);
    expect((await recordDetail(db(), projectId, f.code)).suspect).toEqual([]);

    await newDecisionVersion(d.recordId);

    const [one, ...rest] = await suspectRecords(db(), projectId);
    expect(rest).toEqual([]);
    expect(one).toMatchObject({ from_code: f.code, from_n: 1, suspect: { upstream: d.code, from: 1, to: 2 } });
    const detail = await recordDetail(db(), projectId, f.code);
    expect(detail.suspect).toMatchObject([{ upstream: d.code, from: 1, to: 2 }]);
    const incoming = (await recordDetail(db(), projectId, d.code)).incoming;
    expect(incoming).toMatchObject([{ from_code: f.code, suspect: { from: 1, to: 2 } }]);
    expect((await versionReadiness(db(), projectId, f.versionId)).reasons).toContain(
      `It is based on ${d.code} v1, which is now v2: review it against the change.`,
    );
    expect((await inbox(db(), projectId)).suspect_records).toMatchObject([{ from_code: f.code }]);

    await cmd('link.revalidate', {}, one!.link_id);
    expect(await suspectRecords(db(), projectId)).toEqual([]);
    expect((await recordDetail(db(), projectId, d.code)).incoming).toMatchObject([{ suspect: null }]);
    // Nothing newer to confirm against: refused, no effect.
    await expect(cmd('link.revalidate', {}, one!.link_id)).rejects.toMatchObject({ type: 'conflict' });

    // A later version suspects it again.
    await newDecisionVersion(d.recordId);
    expect(await suspectRecords(db(), projectId)).toMatchObject([{ suspect: { upstream: d.code, from: 1, to: 3 } }]);
  });
});
