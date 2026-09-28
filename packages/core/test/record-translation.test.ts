// The English versions of older records: DEMIURGO proposes, the person decides. A record written
// in Spanish gets a proposed English version (same structure, criteria carried over as modified,
// links kept); nothing changes until the person accepts it, and only DEMIURGO proposes it.

import { human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { TRANSLATION_ACTOR, proposeEnglishVersions } from '../src/translation/records.ts';
import { useEnvironment } from './support/env.ts';

// The simulated translator marks each text with the target language ("[en] …").
const environment = useEnvironment({ providers: () => [createSimulatedProvider()] });
const ana = human('ana');
let projectId = '';
let spanish = { recordId: '', code: '', versionId: '' };
let englishCode = '';

const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

async function fdr(title: string, text: string, criterion: string) {
  const r = await cmd('record.create', {
    type: 'fdr',
    domain: 'test',
    title,
    sections: [
      { title: 'Goal', content: text },
      { title: 'Scope', content: text },
      { title: 'Out of scope', content: text },
      { title: 'Behavior', content: text },
    ],
    criteria: [{ carry: 'new', title: criterion, statement: criterion, verification: 'automatic', check: criterion }],
  });
  const res = r.result as { recordId: string; versionId: string; code: string };
  await cmd('record_version.approve', {}, res.versionId);
  return res;
}

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Old records' } })).projectId;
  spanish = await fdr(
    'Revocar los tokens de los agentes',
    'La persona puede revocar en cualquier momento el token de un agente externo y las propuestas que ya envió se conservan.',
    'Cuando la persona revoca el token, el agente ya no puede enviar propuestas con él.',
  );
  englishCode = (
    await fdr(
      'Agent panel',
      'The panel lists the external agents with their name and the date of their last proposal.',
      'An agent without proposals shows that it has no activity.',
    )
  ).code;
});

describe('English versions of older records', () => {
  it('proposes the English version of the records that are not in English, and only those', async () => {
    const r = await proposeEnglishVersions(environment().services, projectId);
    expect(r.proposed).toEqual([{ code: spanish.code, version: 1 }]);
    expect(r.proposed.map((p) => p.code)).not.toContain(englishCode);
    expect(r.batchIds).toHaveLength(1);
    const p = await environment()
      .services.db.selectFrom('proposals')
      .selectAll()
      .where('batch_id', '=', r.batchIds[0] as string)
      .executeTakeFirstOrThrow();
    expect(p).toMatchObject({ type: 'record_translation', state: 'pending' });
    const payload = p.payload as { record: unknown; title: string; sections: { title: string; content: string }[] };
    expect(payload.record).toEqual({ code: spanish.code, version: 1 });
    expect(payload.title).toBe('[en] Revocar los tokens de los agentes');
    expect(payload.sections.map((s) => s.title)).toEqual(['Goal', 'Scope', 'Out of scope', 'Behavior']);
    // Nothing changed in the record.
    const v = await environment()
      .services.db.selectFrom('record_versions')
      .select(['n', 'title'])
      .where('record_id', '=', spanish.recordId)
      .execute();
    expect(v).toEqual([{ n: 1, title: 'Revocar los tokens de los agentes' }]);
  });

  it("doesn't propose it twice while it waits for the person", async () => {
    const r = await proposeEnglishVersions(environment().services, projectId);
    expect(r.proposed).toEqual([]);
    expect(r.skipped).toEqual([{ code: spanish.code, reason: 'Its English version is already waiting for you.' }]);
  });

  it('accepting and approving it creates the English version, with its criteria carried over as modified', async () => {
    const db = environment().services.db;
    const p = await db
      .selectFrom('proposals')
      .select('id')
      .where('project_id', '=', projectId)
      .where('type', '=', 'record_translation')
      .executeTakeFirstOrThrow();
    await cmd('proposal.accept', { approve: true }, p.id);
    const versions = await db
      .selectFrom('record_versions')
      .select(['id', 'n', 'title', 'state', 'change_note'])
      .where('record_id', '=', spanish.recordId)
      .orderBy('n')
      .execute();
    expect(versions.map((v) => [v.n, v.state])).toEqual([
      [1, 'superseded'],
      [2, 'approved'],
    ]);
    expect(versions[1]?.title).toBe('[en] Revocar los tokens de los agentes');
    expect(versions[1]?.change_note).toMatch(/^English version of v1/);
    const criteria = await db
      .selectFrom('criteria')
      .select(['carry', 'derived_from', 'statement', 'verification'])
      .where('record_version_id', '=', versions[1]?.id as string)
      .execute();
    expect(criteria).toEqual([
      {
        carry: 'modified',
        derived_from: expect.any(String),
        statement: '[en] Cuando la persona revoca el token, el agente ya no puede enviar propuestas con él.',
        verification: 'automatic',
      },
    ]);
  });

  it('only DEMIURGO proposes an English version (a person or an agent cannot)', async () => {
    const proposal = {
      type: 'record_translation',
      payload: {
        record: { code: spanish.code, version: 1 },
        title: 'x',
        sections: [{ title: 'Goal', content: 'x' }],
        criteria: [],
      },
    };
    await expect(
      executeCommand(environment().services, {
        command: 'batch.submit',
        actor: { type: 'agent_external', name: 'bot', session: 's1' },
        projectId,
        data: { proposals: [proposal] },
      }),
    ).rejects.toMatchObject({ type: 'guard' });
    const ok = await executeCommand(environment().services, {
      command: 'batch.submit',
      actor: TRANSLATION_ACTOR,
      projectId,
      data: { batch_type: 'system_package', resolution: 'item', proposals: [proposal] },
    });
    expect(ok.entityId).toBeTruthy();
  });
});
