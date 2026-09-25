// Models & providers through the API (FDR-AGE-002): catalogs, agents and their assignments, the
// calls of a run with their events, and the live progress on the project's SSE stream.

import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { waitForRun } from '@demiurgo/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../../core/src/agents/simulated.ts';
import { SESSION_COOKIE } from '../src/credentials.ts';
import { createServer } from '../src/server.ts';
import { useApi } from './support/api.ts';

const api = useApi({ durable: true, providers: () => [createSimulatedProvider({ delayMs: 400 })] });
let projectId = '';
let token = '';

async function asPerson(command: string, data: unknown) {
  const r = await api().person.request('POST', `/api/projects/${projectId}/commands/${command}`, { data });
  if (r.statusCode !== 200) throw new Error(`${command}: ${r.body}`);
  return r.json<{ entity_id: string; result: Record<string, unknown> }>();
}

beforeAll(async () => {
  projectId = (await api().person.request('POST', '/api/projects', { name: 'Models' })).json<{ project_id: string }>().project_id;
  token = String((await asPerson('agent_token.issue', { name: 'bot' })).result.token);
});

describe('models and providers API', () => {
  it('AC-AGE-002-01 the person sees each provider with its catalog, stats and consumption', async () => {
    const r = await api().person.request('GET', '/api/providers');
    expect(r.statusCode).toBe(200);
    const body = r.json<{
      providers: { id: string }[];
      catalogs: { provider: string; models: unknown[] }[];
      consumption: unknown;
    }>();
    expect(body.providers.map((p) => p.id)).toEqual(['simulated']);
    expect(body.catalogs).toEqual([
      expect.objectContaining({ provider: 'simulated', models: [expect.objectContaining({ id: 'simulated' })] }),
    ]);
    expect(body.consumption).toMatchObject({ today: { byProvider: expect.any(Array) }, week: { byAgent: expect.any(Array) } });
    const refreshed = await api().person.request('POST', '/api/providers/refresh');
    expect(refreshed.statusCode).toBe(200);
  });

  it('AC-AGE-002-02 an agent token can neither read nor change the models', async () => {
    const agent = api().agent(token);
    expect((await agent.request('GET', '/api/providers')).statusCode).toBe(403);
    expect((await agent.request('GET', '/api/agents')).statusCode).toBe(403);
    const put = await agent.request('PUT', '/api/agents/explorer/assignment', {
      scope: 'global',
      provider: 'simulated',
      model: 'simulated',
      effort: null,
    });
    expect(put.statusCode).toBe(403);
    expect((await agent.request('POST', '/api/providers/refresh')).statusCode).toBe(403);
  });

  it('AC-AGE-002-02 a model outside the catalog is a 422; a valid one is assigned for the project', async () => {
    const person = api().person;
    const bad = await person.request('PUT', '/api/agents/explorer/assignment', {
      scope: 'project',
      project_id: projectId,
      provider: 'simulated',
      model: 'gpt-9',
      effort: null,
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json<{ reasons: string[] }>().reasons.join(' ')).toMatch(/Simulated offers: simulated/);
    const ok = await person.request('PUT', '/api/agents/explorer/assignment', {
      scope: 'project',
      project_id: projectId,
      provider: 'simulated',
      model: 'simulated',
      effort: null,
    });
    expect(ok.statusCode).toBe(200);
    const agents = (await person.request('GET', `/api/agents?project=${projectId}`)).json<{
      agents: { id: string; project: unknown; global: unknown; effective: { status: string; source: string } }[];
    }>().agents;
    const explorer = agents.find((a) => a.id === 'explorer');
    expect(explorer).toMatchObject({
      project: expect.any(Object),
      global: expect.any(Object),
      effective: { status: 'ok', source: 'project' },
    });
    expect(agents.map((a) => a.id)).toContain('knowledge_classifier');
    const removed = await person.request('DELETE', `/api/agents/explorer/assignment?scope=project&project=${projectId}`);
    expect(removed.statusCode).toBe(200);
  });

  it('AC-AGE-002-10 a run streams its progress on the SSE and leaves its calls with the events in order', async () => {
    const e = api().environment;
    const app = await createServer({ services: e.services, databaseUrl: e.url, sessionHours: 1, allowedOrigins: [] });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    let runId = '';
    try {
      const progress = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: `/api/projects/${projectId}/events/stream?from=latest`,
            headers: { cookie: `${SESSION_COOKIE}=${api().person.cookie}` },
          },
          (res) => {
            let buffer = '';
            res.on('data', (d: Buffer) => {
              buffer += d.toString();
              if (!runId && buffer.includes('event: ready')) {
                void asPerson('run.request', { action: 'echo', scope: { type: 'project' }, input: { text: 'live' } }).then(
                  (r) => {
                    runId = r.entity_id;
                  },
                  reject,
                );
              }
              const m = /event: run\.progress\ndata: (.+)\n/.exec(buffer);
              if (m?.[1]) {
                req.destroy();
                resolve(JSON.parse(m[1]) as Record<string, unknown>);
              }
            });
          },
        );
        req.on('error', () => undefined);
        setTimeout(() => reject(new Error('No progress arrived.')), 20_000);
        req.end();
      });
      expect(progress).toMatchObject({ provider: 'simulated', model: 'simulated', events: expect.any(Number) });
    } finally {
      await app.close();
    }
    await waitForRun(runId);
    const calls = (await api().person.request('GET', `/api/projects/${projectId}/runs/${runId}/calls`)).json<{
      calls: { state: string; usage: { provenance: Record<string, string> }; events: { seq: number; kind: string }[] }[];
    }>().calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.state).toBe('ok');
    expect(calls[0]?.events.map((x) => x.kind)).toEqual(['started', 'message', 'result']);
    expect(calls[0]?.events.map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(calls[0]?.usage.provenance).toMatchObject({ inputTokens: 'simulated:input.length' });
    // A person sees each event as the provider wrote it; an external agent only its normalized
    // kind and tokens: the raw text can carry local paths and the person's environment.
    expect(calls[0]?.events.every((x) => typeof (x as { raw?: unknown }).raw === 'string')).toBe(true);
    const seen = (await api().agent(token).request('GET', `/api/projects/${projectId}/runs/${runId}/calls`)).json<{
      calls: { events: Record<string, unknown>[] }[];
    }>().calls;
    expect(seen[0]?.events.map((x) => x.kind)).toEqual(['started', 'message', 'result']);
    expect(seen[0]?.events.some((x) => 'raw' in x)).toBe(false);
  });
});
