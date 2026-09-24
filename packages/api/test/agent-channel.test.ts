// Canal de agentes por la API con token: lectura, conversación con su nombre, fuentes y
// propuestas. Todo lo demás, 403 (lista de permitidos generada desde la matriz).

import { randomUUID } from 'node:crypto';
import { COMMAND_NAMES, commandDefinition } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { useApi } from './support/api.ts';

const api = useApi();
let projectId = '';
let explorationId = '';
let token = '';
let tokenId = '';

async function asPerson(name: string, data: unknown, entityId?: string) {
  const r = await api().person.request('POST', `/api/projects/${projectId}/commands/${name}`, {
    ...(entityId ? { entity_id: entityId } : {}),
    data,
  });
  if (r.statusCode !== 200) throw new Error(`${name}: ${r.body}`);
  return r.json<{ entity_id: string; result: Record<string, unknown> }>();
}

beforeAll(async () => {
  const p = await api().person.request('POST', '/api/projects', { name: 'Channel' });
  projectId = p.json<{ project_id: string }>().project_id;
  explorationId = (await asPerson('exploration.open', { purpose: 'Invitados a los eventos' })).entity_id;
  const t = await asPerson('agent_token.issue', { name: 'claude-code' });
  token = String(t.result.token);
  tokenId = t.entity_id;
});

describe('canal de agentes por la API', () => {
  it('AC-DIS-001-02 con token, un agente lee, conversa con su nombre, registra una fuente y propone; la persona acepta', async () => {
    const agent = api().agent(token);
    expect((await agent.request('GET', `/api/projects/${projectId}/state`)).statusCode).toBe(200);
    expect((await agent.request('GET', `/api/projects/${projectId}/explorations/${explorationId}`)).statusCode).toBe(200);

    const m = await agent.request('POST', `/api/projects/${projectId}/commands/message.post`, {
      data: { exploration_id: explorationId, text: 'Propongo limitar los invitados a dos por socio.' },
    });
    expect(m.statusCode).toBe(200);
    const detail = await agent.request('GET', `/api/projects/${projectId}/explorations/${explorationId}`);
    const messages = detail.json<{ messages: { author: string; body: string }[] }>().messages;
    expect(messages.at(-1)?.author).toBe(`agent:claude-code:${tokenId}`);

    const f = await agent.request('POST', `/api/projects/${projectId}/commands/source.register`, {
      data: { name: 'reglamento.md', content: 'Cada socio puede traer invitados a los eventos abiertos.' },
    });
    expect(f.statusCode).toBe(200);

    const batch = await agent.request('POST', `/api/projects/${projectId}/commands/batch.submit`, {
      data: {
        proposals: [
          {
            type: 'decision',
            payload: {
              title: 'Dos invitados por socio',
              context: 'Aforo limitado.',
              decision: 'Máximo dos invitados.',
              consequences: 'Hay que contarlos.',
            },
          },
        ],
      },
    });
    expect(batch.statusCode).toBe(200);
    const inbox = await api().person.request('GET', `/api/projects/${projectId}/inbox`);
    const batches = inbox.json<{ batches: { producer: string; resolution: string; proposals: { id: string }[] }[] }>().batches;
    const fromAgent = batches.find((l) => l.producer === `agent:claude-code:${tokenId}`);
    expect(fromAgent?.resolution).toBe('item');

    // El agente no puede aceptar su propia propuesta; la persona sí.
    const proposal = fromAgent?.proposals[0]?.id ?? '';
    const attempt = await agent.request('POST', `/api/projects/${projectId}/commands/proposal.accept`, {
      entity_id: proposal,
      data: {},
    });
    expect(attempt.statusCode).toBe(403);
    const accepted = await asPerson('proposal.accept', {}, proposal);
    const code = String(accepted.result.code);
    const events = await api()
      .environment.services.db.selectFrom('events')
      .select(['command', 'actor'])
      .where('project_id', '=', projectId)
      .where('command', '=', 'record.create')
      .execute();
    expect(events).toEqual([{ command: 'record.create', actor: 'human:ana' }]);
    expect((await agent.request('GET', `/api/projects/${projectId}/records/${code}`)).statusCode).toBe(200);
  });

  const notAllowed = COMMAND_NAMES.filter((c) => !commandDefinition(c).allowed.includes('agent_external'));

  it.each(notAllowed)('AC-DIS-001-05 con token de agente, %s devuelve 403', async (command) => {
    const r = await api()
      .agent(token)
      .request('POST', `/api/projects/${projectId}/commands/${command}`, { entity_id: randomUUID(), data: {} });
    expect(r.statusCode).toBe(403);
  });

  it('AC-DIS-001-05 con token de agente, las consultas vedadas, otro proyecto y crear proyectos devuelven 403', async () => {
    const agent = api().agent(token);
    expect((await agent.request('GET', '/api/projects')).statusCode).toBe(403);
    expect((await agent.request('GET', `/api/projects/${projectId}/tokens`)).statusCode).toBe(403);
    expect((await agent.request('POST', '/api/projects', { name: 'Del agente' })).statusCode).toBe(403);
    const another = (await api().person.request('POST', '/api/projects', { name: 'Other' })).json<{ project_id: string }>()
      .project_id;
    expect((await agent.request('GET', `/api/projects/${another}/state`)).statusCode).toBe(403);
    expect((await agent.request('POST', `/api/projects/${another}/commands/message.post`, { data: {} })).statusCode).toBe(403);
  });

  it('AC-DIS-001-15 un token de agente no obtiene una sesión humana', async () => {
    const r = await api().agent(token).request('POST', '/api/session', { username: 'ana', key: 'clave-de-prueba-larga' });
    expect(r.statusCode).toBe(403);
    expect(r.cookies).toHaveLength(0);
  });

  it('un token revocado deja de valer', async () => {
    const t = await asPerson('agent_token.issue', { name: 'ephemeral' });
    await asPerson('agent_token.revoke', {}, t.entity_id);
    const r = await api().agent(String(t.result.token)).request('GET', `/api/projects/${projectId}/state`);
    expect(r.statusCode).toBe(401);
  });

  it('AC-ESQ-001-13 con token de agente, una cabecera de actor o una cookie de persona no cambian el actor', async () => {
    const agent = api().agent(token);
    const r = await agent.request(
      'POST',
      `/api/projects/${projectId}/commands/message.post`,
      { actor: 'human:ana', data: { exploration_id: explorationId, text: 'Mensaje con cabeceras falsas' } },
      { 'x-actor': 'human:ana', cookie: `demiurgo_sesion=${api().person.cookie}`, 'x-demiurgo-csrf': api().person.csrf },
    );
    expect(r.statusCode).toBe(200);
    const last = await api()
      .environment.services.db.selectFrom('events')
      .select('actor')
      .where('project_id', '=', projectId)
      .orderBy('seq', 'desc')
      .executeTakeFirstOrThrow();
    expect(last.actor).toBe(`agent:claude-code:${tokenId}`);
    // Y con token de agente no se ejecuta un comando de persona aunque vaya la cookie.
    const decisive = await agent.request(
      'POST',
      `/api/projects/${projectId}/commands/exploration.open`,
      { data: { purpose: 'x' } },
      {
        cookie: `demiurgo_sesion=${api().person.cookie}`,
        'x-demiurgo-csrf': api().person.csrf,
      },
    );
    expect(decisive.statusCode).toBe(403);
  });

  it('el nombre «run» está reservado para los tokens de agente', async () => {
    const r = await api().person.request('POST', `/api/projects/${projectId}/commands/agent_token.issue`, {
      data: { name: 'run' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ reasons: string[] }>().reasons.join(' ')).toMatch(/reservado/);
  });
});
