// The project's glossary: a person fixes the English term the records use for a word; the latest
// change of a word is the one in force, and it reaches the agents that write records and the
// translator.

import { human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { projectGlossary } from '../src/commands/glossary.ts';
import { buildContext } from '../src/context/build.ts';
import { readingTranslation } from '../src/translation/index.ts';
import { useEnvironment } from './support/env.ts';

const inputs: string[] = [];
const environment = useEnvironment({ providers: () => [createSimulatedProvider({ onInvoke: (i) => inputs.push(i.input ?? '') })] });
const ana = human('ana');
let projectId = '';
let thread = '';

const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data });

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Glossary' } })).projectId;
  thread = (await cmd('exploration.open', { purpose: 'Guests at the partners events' })).entityId;
});

describe('project glossary', () => {
  it('the latest change of each word is in force, and a removal drops it', async () => {
    await cmd('glossary.set', { term: 'socio', english: 'member' });
    await cmd('glossary.set', { term: 'Socio', english: 'partner', note: 'Not "member": they own a share.' });
    await cmd('glossary.set', { term: 'cuota', english: 'fee' });
    await cmd('glossary.set', { term: 'evento', english: 'event' });
    await cmd('glossary.remove', { term: 'evento' });
    const g = await projectGlossary(environment().services.db, projectId);
    expect(g.map((e) => [e.term, e.english])).toEqual([
      ['cuota', 'fee'],
      ['Socio', 'partner'],
    ]);
    expect(g.find((e) => e.english === 'partner')).toMatchObject({
      note: 'Not "member": they own a share.',
      set_by: 'human:ana',
    });
  });

  it('each change leaves its event in the journal', async () => {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from events where project_id = ${projectId} and command like 'glossary.%'`.execute(
      environment().services.db,
    );
    expect(rows[0]?.n).toBe(5);
  });

  it('only a person fixes a term (403 for the system)', async () => {
    await expect(
      executeCommand(environment().services, {
        command: 'glossary.set',
        actor: { type: 'system', component: 'test', version: '1' },
        projectId,
        data: { term: 'x', english: 'y' },
      }),
    ).rejects.toMatchObject({ type: 'forbidden' });
  });

  it('the agents that write records get the glossary in their pack; the others do not', async () => {
    const db = environment().services.db;
    const chat = await db
      .transaction()
      .execute((trx) => buildContext(trx, projectId, 'exploration_chat', { type: 'exploration', id: thread }, {}, 0));
    expect((chat.pack.content as { glossary?: unknown }).glossary).toEqual([
      { term: 'cuota', english: 'fee' },
      { term: 'Socio', english: 'partner' },
    ]);
    expect(chat.manifest.fragments.filter((f) => f.section === 'glossary')).toHaveLength(1);
    const echo = await db
      .transaction()
      .execute((trx) => buildContext(trx, projectId, 'echo', { type: 'project' }, { text: 'hi' }, 0));
    expect((echo.pack.content as { glossary?: unknown }).glossary).toBeUndefined();
  });

  it('the translator receives the glossary with the texts', async () => {
    inputs.length = 0;
    const r = await readingTranslation(environment().services, { projectId, subject: 'exploration', id: thread, lang: 'es' });
    expect(r.translated).toBe(true);
    expect(inputs.at(-1)).toContain('"english": "partner"');
  });
});
