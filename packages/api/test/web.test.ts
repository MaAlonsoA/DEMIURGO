import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSRF_HEADER, SESSION_COOKIE } from '../src/credentials.ts';
import { createServer } from '../src/server.ts';
import { PASSWORD, useApi } from './support/api.ts';

const api = useApi();
let web: FastifyInstance;

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'demiurgo-web-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>DEMIURGO</title><div id="root"></div>');
  await writeFile(join(root, 'assets', 'app-1234.js'), 'console.log("app");');
  const e = api().environment;
  web = await createServer({
    services: e.services,
    databaseUrl: e.url,
    sessionHours: 1,
    allowedOrigins: ['http://127.0.0.1:8100'],
    webRoot: root,
  });
});

afterAll(async () => {
  await web?.close();
});

describe('API: the web build from the same origin', () => {
  it('AC-WEB-001-01 serves the web build and sends any route outside /api to index.html', async () => {
    const home = await web.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.headers['content-type']).toMatch(/text\/html/);
    expect(home.body).toContain('<div id="root">');

    const deep = await web.inject({ method: 'GET', url: '/p/0198a1b2-0000-7000-8000-000000000001/threads?x=1' });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain('<div id="root">');
    expect(deep.headers['cache-control']).toBe('no-cache');

    const asset = await web.inject({ method: 'GET', url: '/assets/app-1234.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain('console.log');
    expect(asset.headers['cache-control']).toMatch(/immutable/);
  });

  it('AC-WEB-001-01 an unknown /api route is a JSON 404, never index.html', async () => {
    const r = await web.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: 'not_found', reasons: [] });
    const post = await web.inject({ method: 'POST', url: '/somewhere', payload: {} });
    expect(post.statusCode).toBe(404);
    expect(post.json()).toMatchObject({ error: 'not_found' });
  });

  it('AC-WEB-001-01 the session query returns the CSRF token so a reloaded page can still write', async () => {
    const login = await web.inject({ method: 'POST', url: '/api/session', payload: { username: 'ana', password: PASSWORD } });
    const cookie = login.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
    const issued = login.json<{ csrf: string }>().csrf;

    const session = await web.inject({ method: 'GET', url: '/api/session', cookies: { [SESSION_COOKIE]: cookie } });
    expect(session.statusCode).toBe(200);
    const body = session.json<{ csrf: string; actor: { person: string } }>();
    expect(body.actor.person).toBe('ana');
    expect(body.csrf).toBe(issued);

    const withCsrf = await web.inject({
      method: 'POST',
      url: '/api/projects',
      cookies: { [SESSION_COOKIE]: cookie },
      headers: { [CSRF_HEADER]: body.csrf },
      payload: { name: 'After a reload' },
    });
    expect(withCsrf.statusCode).toBe(200);

    // Another session's token does not work with this cookie.
    const other = await web.inject({ method: 'POST', url: '/api/session', payload: { username: 'ana', password: PASSWORD } });
    const foreign = await web.inject({
      method: 'POST',
      url: '/api/projects',
      cookies: { [SESSION_COOKIE]: cookie },
      headers: { [CSRF_HEADER]: other.json<{ csrf: string }>().csrf },
      payload: { name: 'Foreign token' },
    });
    expect(foreign.statusCode).toBe(403);

    const anonymous = await web.inject({ method: 'GET', url: '/api/session' });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('API: the event stream starting from now', () => {
  it('AC-INT-001-15 with from=latest the stream announces the latest event and then sends only new ones', async () => {
    const { environment, person } = api();
    const created = await person.request('POST', '/api/projects', { name: 'Stream from now' });
    const projectId = created.json<{ project_id: string }>().project_id;
    const echo = (text: string) =>
      person.request('POST', `/api/projects/${projectId}/commands/run.request`, {
        data: { action: 'echo', scope: { type: 'project' }, input: { text } },
      });
    await echo('before');
    const latest = await environment.services.db
      .selectFrom('events')
      .select('id')
      .where('project_id', '=', projectId)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();

    await web.listen({ host: '127.0.0.1', port: 0 });
    const { port } = web.server.address() as AddressInfo;
    const chunks = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: `/api/projects/${projectId}/events/stream?from=latest`,
          headers: { cookie: `${SESSION_COOKIE}=${person.cookie}` },
        },
        (res) => {
          res.on('data', (d: Buffer) => {
            buffer += d.toString();
            if (/event: ready/.test(buffer) && !buffer.includes('event: run.request')) {
              echo('after').catch(reject);
            }
            if (buffer.includes('event: run.request')) {
              req.destroy();
              resolve(buffer);
            }
          });
        },
      );
      req.on('error', (e) => (buffer.includes('event: run.request') ? undefined : reject(e)));
      setTimeout(() => reject(new Error(`Timed out: ${buffer}`)), 20_000);
      req.end();
    });
    const ready = /id: (\d+)\nevent: ready\ndata: (.+)\n/.exec(chunks);
    expect(ready?.[1]).toBe(latest.id);
    expect(JSON.parse(ready?.[2] ?? '{}')).toEqual({ latest: latest.id });
    // Nothing from before "now" is sent again.
    const ids = [...chunks.matchAll(/^id: (\d+)$/gm)].map((m) => BigInt(m[1] ?? '0'));
    expect(ids.every((id) => id >= BigInt(latest.id))).toBe(true);
    expect(ids.some((id) => id > BigInt(latest.id))).toBe(true);
  });
});
