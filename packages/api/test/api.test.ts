import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { COOKIE_SESSION } from '../src/credentials.ts';
import { createServer } from '../src/server.ts';
import { PASSWORD, useApi } from './support/api.ts';

const api = useApi();

async function createProject(name: string): Promise<string> {
  const r = await api().person.request('POST', '/api/projects', { name });
  expect(r.statusCode).toBe(200);
  return r.json<{ project_id: string }>().project_id;
}

async function actorOfLastEvent(projectId: string): Promise<string> {
  const e = await api()
    .environment.services.db.selectFrom('events')
    .select('actor')
    .where('project_id', '=', projectId)
    .orderBy('seq', 'desc')
    .executeTakeFirstOrThrow();
  return e.actor;
}

describe('API: actor, session and errors', () => {
  it('AC-ESQ-001-13 the actor comes from the credential and an actor declared in the body is ignored', async () => {
    const r = await api().person.request('POST', '/api/projects', { name: 'Actor', actor: 'system:impersonator@1' });
    expect(r.statusCode).toBe(200);
    const projectId = r.json<{ project_id: string }>().project_id;
    expect(await actorOfLastEvent(projectId)).toBe('human:ana');
    const c = await api().person.request('POST', `/api/projects/${projectId}/commands/run.request`, {
      actor: 'agent:run:fake',
      data: { action: 'echo', scope: { type: 'project' }, input: { text: 'x' } },
    });
    expect(c.statusCode).toBe(200);
    expect(await actorOfLastEvent(projectId)).toBe('human:ana');
  });

  it('AC-ESQ-001-13 without a credential there is no actor: 401', async () => {
    const r = await api().anonymous.request('POST', '/api/projects', { name: 'Anonymous' });
    expect(r.statusCode).toBe(401);
    expect(r.json<{ message: string }>().message).toMatch(/A session or an agent token is required/);
  });

  it('AC-DIS-001-15 the cookie is httpOnly and SameSite=Strict and mutations require the CSRF token', async () => {
    const login = await api().app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: 'ana', password: PASSWORD },
    });
    const cookie = login.cookies.find((c) => c.name === COOKIE_SESSION);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    const withoutCsrf = await api().app.inject({
      method: 'POST',
      url: '/api/projects',
      cookies: { [COOKIE_SESSION]: cookie?.value ?? '' },
      payload: { name: 'Without CSRF' },
    });
    expect(withoutCsrf.statusCode).toBe(403);
    expect(withoutCsrf.json<{ message: string }>().message).toMatch(/CSRF/);
    const bad = await api().person.request('POST', '/api/projects', { name: 'Origin' }, { origin: 'http://evil.example' });
    expect(bad.statusCode).toBe(403);
  });

  it('AC-ESQ-001-02 over HTTP a forbidden command returns 403 with the reason', async () => {
    const projectId = await createProject('Forbidden');
    const r = await api().person.request('POST', `/api/projects/${projectId}/commands/run.begin`, {
      entity_id: '00000000-0000-7000-8000-000000000001',
      data: {},
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: 'forbidden' });
  });

  it('AC-ESQ-001-03 over HTTP a nonexistent transition returns 409', async () => {
    const projectId = await createProject('Transition');
    const archive = () =>
      api().person.request('POST', `/api/projects/${projectId}/commands/project.archive`, { entity_id: projectId, data: {} });
    expect((await archive()).statusCode).toBe(200);
    const r = await archive();
    expect(r.statusCode).toBe(409);
    expect(r.json<{ message: string }>().message).toMatch(/archived/i);
  });

  it('an unknown command gives 404 and invalid data gives 422', async () => {
    const projectId = await createProject('Errors');
    expect((await api().person.request('POST', `/api/projects/${projectId}/commands/no.exists`, {})).statusCode).toBe(404);
    const r = await api().person.request('POST', `/api/projects/${projectId}/commands/run.request`, {
      data: { action: 'nothing' },
    });
    expect(r.statusCode).toBe(422);
  });

  it('the tables are served as data for the UI', async () => {
    const r = await api().person.request('GET', '/api/tables');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty('capabilities.commands.project\\.create');
  });
});

describe('API: command contract', () => {
  it('AC-ESQ-001-01 each command publishes its capability and the JSON Schema of its data', async () => {
    const r = await api().person.request('GET', '/api/commands');
    expect(r.statusCode).toBe(200);
    const commands = r.json<Record<string, { allowed: string[]; decisive: boolean; implemented: boolean; data: unknown }>>();
    expect(commands['proposal.accept']).toMatchObject({
      allowed: ['human'],
      decisive: true,
      implemented: true,
      data: { type: 'object', properties: { approve: { type: 'boolean' } } },
    });
    expect(commands['message.post']?.data).toMatchObject({ required: expect.arrayContaining(['exploration_id', 'text']) });
  });
});

describe('API: incremental SSE stream', () => {
  it('AC-ESQ-001-14 with Last-Event-ID only later events arrive', async () => {
    const { environment, person } = api();
    const projectId = await createProject('SSE');
    for (const text of ['a', 'b']) {
      await person.request('POST', `/api/projects/${projectId}/commands/run.request`, {
        data: { action: 'echo', scope: { type: 'project' }, input: { text } },
      });
    }
    const all = await environment.services.db
      .selectFrom('events')
      .select('id')
      .where('project_id', '=', projectId)
      .orderBy('id')
      .execute();
    const cutoff = all[2]?.id ?? '0';
    const later = all.filter((e) => BigInt(e.id) > BigInt(cutoff)).map((e) => e.id);

    // Real server listening on a free port: inject doesn't work for open streams.
    const app = await createServer({
      services: environment.services,
      baseUrl: environment.url,
      sessionHours: 1,
      allowedOrigins: [],
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    try {
      const received = await new Promise<string[]>((resolve, reject) => {
        const ids: string[] = [];
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: `/api/projects/${projectId}/events/stream`,
            headers: { cookie: `${COOKIE_SESSION}=${person.cookie}`, 'last-event-id': cutoff },
          },
          (res) => {
            let buffer = '';
            const onReceive = async (d: Buffer): Promise<void> => {
              buffer += d.toString();
              for (const m of buffer.matchAll(/^id: (\d+)$/gm)) if (!ids.includes(m[1] ?? '')) ids.push(m[1] ?? '');
              if (ids.length === later.length) {
                // A new event also arrives through the open stream.
                await person.request('POST', '/api/projects', { name: 'Other project' });
                await person.request('POST', `/api/projects/${projectId}/commands/run.request`, {
                  data: { action: 'echo', scope: { type: 'project' }, input: { text: 'c' } },
                });
              }
              if (ids.length >= later.length + 2) {
                req.destroy();
                resolve(ids);
              }
            };
            res.on('data', (d: Buffer) => {
              onReceive(d).catch(reject);
            });
          },
        );
        req.on('error', (e) => (ids.length >= later.length + 2 ? undefined : reject(e)));
        setTimeout(() => reject(new Error(`Timed out; received ${ids.join(',')}`)), 20_000);
        req.end();
      });
      expect(received.slice(0, later.length)).toEqual(later);
      expect(received.every((id) => BigInt(id) > BigInt(cutoff))).toBe(true);
      // No leaks between projects: all received events belong to this project.
      const fromOthers = await environment.services.db
        .selectFrom('events')
        .select('id')
        .where('id', 'in', received)
        .where('project_id', '<>', projectId)
        .execute();
      expect(fromOthers).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
