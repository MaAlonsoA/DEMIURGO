// Agent channel through the API with a token: reading, conversation with its name, sources and
// proposals. Everything else, 403 (allowed list generated from the matrix).

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
  explorationId = (await asPerson('exploration.open', { purpose: 'Guests at events' })).entity_id;
  const t = await asPerson('agent_token.issue', { name: 'claude-code' });
  token = String(t.result.token);
  tokenId = t.entity_id;
});

describe('agent channel through the API', () => {
  it('AC-DIS-001-02 with a token, an agent reads, converses with its name, registers a source and proposes; the person accepts', async () => {
    const agent = api().agent(token);
    expect((await agent.request('GET', `/api/projects/${projectId}/state`)).statusCode).toBe(200);
    expect((await agent.request('GET', `/api/projects/${projectId}/explorations/${explorationId}`)).statusCode).toBe(200);

    const m = await agent.request('POST', `/api/projects/${projectId}/commands/message.post`, {
      data: { exploration_id: explorationId, text: 'I propose limiting guests to two per member.' },
    });
    expect(m.statusCode).toBe(200);
    const detail = await agent.request('GET', `/api/projects/${projectId}/explorations/${explorationId}`);
    const messages = detail.json<{ messages: { author: string; body: string }[] }>().messages;
    expect(messages.at(-1)?.author).toBe(`agent:claude-code:${tokenId}`);

    const f = await agent.request('POST', `/api/projects/${projectId}/commands/source.register`, {
      data: { name: 'bylaws.md', content: 'Every member may bring guests to open events.' },
    });
    expect(f.statusCode).toBe(200);

    const batch = await agent.request('POST', `/api/projects/${projectId}/commands/batch.submit`, {
      data: {
        proposals: [
          {
            type: 'decision',
            payload: {
              title: 'Two guests per member',
              context: 'Limited capacity.',
              decision: 'Two guests maximum.',
              consequences: 'They must be counted.',
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

    // The agent cannot accept its own proposal; the person can.
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

  it.each(notAllowed)('AC-DIS-001-05 with an agent token, %s returns 403', async (command) => {
    const r = await api()
      .agent(token)
      .request('POST', `/api/projects/${projectId}/commands/${command}`, { entity_id: randomUUID(), data: {} });
    expect(r.statusCode).toBe(403);
  });

  it('AC-DIS-001-05 with an agent token, forbidden queries, another project and creating projects return 403', async () => {
    const agent = api().agent(token);
    expect((await agent.request('GET', '/api/projects')).statusCode).toBe(403);
    expect((await agent.request('GET', `/api/projects/${projectId}/tokens`)).statusCode).toBe(403);
    expect((await agent.request('POST', '/api/projects', { name: 'From agent' })).statusCode).toBe(403);
    const another = (await api().person.request('POST', '/api/projects', { name: 'Other' })).json<{ project_id: string }>()
      .project_id;
    expect((await agent.request('GET', `/api/projects/${another}/state`)).statusCode).toBe(403);
    expect((await agent.request('POST', `/api/projects/${another}/commands/message.post`, { data: {} })).statusCode).toBe(403);
  });

  it('AC-DIS-001-15 an agent token does not get a human session', async () => {
    const r = await api().agent(token).request('POST', '/api/session', { username: 'ana', password: 'long-test-password' });
    expect(r.statusCode).toBe(403);
    expect(r.cookies).toHaveLength(0);
  });

  it('a revoked token stops working', async () => {
    const t = await asPerson('agent_token.issue', { name: 'ephemeral' });
    await asPerson('agent_token.revoke', {}, t.entity_id);
    const r = await api().agent(String(t.result.token)).request('GET', `/api/projects/${projectId}/state`);
    expect(r.statusCode).toBe(401);
  });

  it('AC-ESQ-001-13 with an agent token, an actor header or a person cookie do not change the actor', async () => {
    const agent = api().agent(token);
    const r = await agent.request(
      'POST',
      `/api/projects/${projectId}/commands/message.post`,
      { actor: 'human:ana', data: { exploration_id: explorationId, text: 'Message with fake headers' } },
      { 'x-actor': 'human:ana', cookie: `demiurgo_session=${api().person.cookie}`, 'x-demiurgo-csrf': api().person.csrf },
    );
    expect(r.statusCode).toBe(200);
    const last = await api()
      .environment.services.db.selectFrom('events')
      .select('actor')
      .where('project_id', '=', projectId)
      .orderBy('seq', 'desc')
      .executeTakeFirstOrThrow();
    expect(last.actor).toBe(`agent:claude-code:${tokenId}`);
    // And with an agent token a person's command does not run even if the cookie is sent.
    const decisive = await agent.request(
      'POST',
      `/api/projects/${projectId}/commands/exploration.open`,
      { data: { purpose: 'x' } },
      {
        cookie: `demiurgo_session=${api().person.cookie}`,
        'x-demiurgo-csrf': api().person.csrf,
      },
    );
    expect(decisive.statusCode).toBe(403);
  });

  it('the name "run" is reserved for agent tokens', async () => {
    const r = await api().person.request('POST', `/api/projects/${projectId}/commands/agent_token.issue`, {
      data: { name: 'run' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ reasons: string[] }>().reasons.join(' ')).toMatch(/reserved/);
  });
});
