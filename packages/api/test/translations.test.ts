// Reading translations through the API: records stay in English and a person reads them in their
// language. The server loads the source, caches the translation by the source's fingerprint and
// never touches the record or the journal.

import { beforeAll, describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../../core/src/agents/simulated.ts';
import { useApi } from './support/api.ts';

const api = useApi({ providers: () => [createSimulatedProvider()] });
let projectId = '';
let explorationId = '';

async function asPerson(command: string, data: unknown) {
  const r = await api().person.request('POST', `/api/projects/${projectId}/commands/${command}`, { data });
  if (r.statusCode !== 200) throw new Error(`${command}: ${r.body}`);
  return r.json<{ entity_id: string; result: Record<string, unknown> }>();
}

const translation = (subject: string, id: string, lang = 'es') =>
  api().person.request('GET', `/api/projects/${projectId}/translations/${subject}/${id}?lang=${lang}`);

beforeAll(async () => {
  projectId = (await api().person.request('POST', '/api/projects', { name: 'Translations' })).json<{ project_id: string }>()
    .project_id;
  explorationId = (await asPerson('exploration.open', { purpose: 'The person can revoke the token of an external agent.' }))
    .entity_id;
});

describe('reading translations API', () => {
  it('without a model for the translator, it asks to choose one (409)', async () => {
    expect((await api().person.request('DELETE', '/api/agents/translator/assignment')).statusCode).toBe(200);
    const r = await translation('exploration', explorationId);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ message: string }>().message).toMatch(/Choose a model for translator/);
  });

  it('translates a record into the person language once and serves it from the cache after', async () => {
    const engine = { provider: 'simulated', model: 'simulated', effort: null };
    expect((await api().person.request('PUT', '/api/agents/translator/assignment', engine)).statusCode).toBe(200);
    const first = await translation('exploration', explorationId);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      subject: 'exploration',
      lang: 'es',
      translated: true,
      by: 'simulated/simulated',
      source: { purpose: 'The person can revoke the token of an external agent.' },
      fields: { purpose: '[es] The person can revoke the token of an external agent.' },
    });
    const db = api().environment.services.db;
    const calls = async () =>
      (await db.selectFrom('agent_calls').select('id').where('agent', '=', 'translator').execute()).length;
    const before = await calls();
    expect((await translation('exploration', explorationId)).json()).toMatchObject({ translated: true });
    expect(await calls()).toBe(before);
    // The record itself is untouched: still in English.
    const e = await db.selectFrom('explorations').select('purpose').where('id', '=', explorationId).executeTakeFirstOrThrow();
    expect(e.purpose).toBe('The person can revoke the token of an external agent.');
  });

  it('a changed source is translated again', async () => {
    await asPerson('exploration.revise_purpose', { purpose: 'The person can revoke any agent token at any time.' }).catch(
      async () => {
        // Only the system revises the purpose: change it as the thread would.
        const db = api().environment.services.db;
        await db
          .updateTable('explorations')
          .set({ purpose: 'The person can revoke any agent token at any time.' })
          .where('id', '=', explorationId)
          .execute();
      },
    );
    const r = (await translation('exploration', explorationId)).json<{ fields: Record<string, string> }>();
    expect(r.fields.purpose).toBe('[es] The person can revoke any agent token at any time.');
  });

  it('English, or a text already in the language, needs no translation', async () => {
    expect((await translation('exploration', explorationId, 'en')).json()).toMatchObject({ translated: false, by: null });
    const spanish = (await asPerson('exploration.open', { purpose: 'La persona puede revocar el token de un agente externo.' }))
      .entity_id;
    expect((await translation('exploration', spanish)).json()).toMatchObject({
      translated: false,
      fields: { purpose: 'La persona puede revocar el token de un agente externo.' },
    });
  });

  it('only a person reads translations, only of this project, only in a known language', async () => {
    const token = String((await asPerson('agent_token.issue', { name: 'bot' })).result.token);
    const agent = api().agent(token);
    const url = `/api/projects/${projectId}/translations/exploration/${explorationId}?lang=es`;
    expect((await agent.request('GET', url)).statusCode).toBe(403);
    expect((await translation('exploration', explorationId, 'fr')).statusCode).toBe(422);
    expect((await translation('nothing', explorationId)).statusCode).toBe(404);
    expect((await translation('exploration', '01a0e7b3-cf6b-7324-b128-f435268b1b3f')).statusCode).toBe(404);
    const other = (await api().person.request('POST', '/api/projects', { name: 'Other' })).json<{ project_id: string }>()
      .project_id;
    const r = await api().person.request('GET', `/api/projects/${other}/translations/exploration/${explorationId}?lang=es`);
    expect(r.statusCode).toBe(404);
  });

  it('the person chooses the language they read in; the session says it', async () => {
    const person = api().person;
    expect((await person.request('GET', '/api/session')).json()).toMatchObject({ locale: null });
    expect((await person.request('PUT', '/api/session/locale', { locale: 'es' })).statusCode).toBe(200);
    expect((await person.request('GET', '/api/session')).json()).toMatchObject({ locale: 'es' });
    expect((await person.request('PUT', '/api/session/locale', { locale: 'fr' })).statusCode).toBe(422);
    expect((await person.request('PUT', '/api/session/locale', { locale: null })).statusCode).toBe(200);
    const token = String((await asPerson('agent_token.issue', { name: 'bot2' })).result.token);
    expect((await api().agent(token).request('PUT', '/api/session/locale', { locale: 'es' })).statusCode).toBe(403);
  });
});
