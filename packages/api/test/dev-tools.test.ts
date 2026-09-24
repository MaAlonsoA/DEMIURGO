// Dev tools routes (snapshots and reset): only with the flag, only for a person with a session.

import type { Snapshot } from '@demiurgo/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { CSRF_HEADER } from '../src/credentials.ts';
import type { DevTools } from '../src/dev-tools.ts';
import { useApi } from './support/api.ts';

const SNAPSHOT: Snapshot = {
  name: 'dmg_snap_20260924_225426_after_day_1',
  label: 'after day 1',
  created_at: '2026-09-24T22:54:26.000Z',
  source: 'demiurgo_web_dev',
  migration: '0004',
  projects: [{ name: 'Demiurgo', events: 11 }],
  size_bytes: 9_000_000,
};

const calls: string[] = [];
let gate: Promise<void> = Promise.resolve();
const fake: DevTools = {
  database: 'demiurgo_web_dev',
  ready: () => gate,
  list: async () => {
    calls.push('list');
    return [SNAPSHOT];
  },
  save: async (label) => {
    calls.push(`save:${label}`);
    return SNAPSHOT;
  },
  restore: async (ref) => {
    calls.push(`restore:${ref}`);
    return SNAPSHOT;
  },
  drop: async (ref) => {
    calls.push(`drop:${ref}`);
    return SNAPSHOT;
  },
  reset: async () => {
    calls.push('reset');
  },
};

const off = useApi();
const on = useApi({}, { devTools: fake });
let agentToken = '';

beforeAll(async () => {
  const p = await on().person.request('POST', '/api/projects', { name: 'Dev' });
  const projectId = p.json<{ project_id: string }>().project_id;
  const t = await on().person.request('POST', `/api/projects/${projectId}/commands/agent_token.issue`, {
    data: { name: 'claude-code' },
  });
  agentToken = t.json<{ result: { token: string } }>().result.token;
});

describe('dev tools routes', () => {
  it('do not exist without the flag, and the session does not announce them', async () => {
    const person = off().person;
    expect((await person.request('GET', '/api/dev/snapshots')).statusCode).toBe(404);
    expect((await person.request('POST', '/api/dev/reset')).statusCode).toBe(404);
    expect((await person.request('GET', '/api/session')).json()).not.toHaveProperty('dev_tools');
  });

  it('need a person with a session and the CSRF token', async () => {
    expect((await on().anonymous.request('GET', '/api/dev/snapshots')).statusCode).toBe(401);
    expect((await on().agent(agentToken).request('GET', '/api/dev/snapshots')).statusCode).toBe(403);
    const forged = await on().person.request('POST', '/api/dev/reset', undefined, { [CSRF_HEADER]: 'forged' });
    expect(forged.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });

  it('list, save, restore, drop and reset for a person, and the session announces them', async () => {
    const person = on().person;
    expect((await person.request('GET', '/api/session')).json()).toMatchObject({ dev_tools: true });
    const list = await person.request('GET', '/api/dev/snapshots');
    expect(list.json()).toEqual({ database: 'demiurgo_web_dev', snapshots: [SNAPSHOT] });
    expect((await person.request('POST', '/api/dev/snapshots', { label: 'after day 1' })).json()).toEqual({ snapshot: SNAPSHOT });
    expect((await person.request('POST', `/api/dev/snapshots/${SNAPSHOT.name}/restore`)).json()).toEqual({ restored: SNAPSHOT });
    expect((await person.request('DELETE', `/api/dev/snapshots/${SNAPSHOT.name}`)).json()).toEqual({ dropped: SNAPSHOT });
    expect((await person.request('POST', '/api/dev/reset')).json()).toEqual({ reset: true });
    expect(calls).toEqual(['list', 'save:after day 1', `restore:${SNAPSHOT.name}`, `drop:${SNAPSHOT.name}`, 'reset']);
  });

  it('reject a label longer than 60 characters', async () => {
    const r = await on().person.request('POST', '/api/dev/snapshots', { label: 'x'.repeat(61) });
    expect(r.statusCode).toBe(422);
  });

  it('hold every request while the API restarts', async () => {
    const held = Promise.withResolvers<void>();
    gate = held.promise;
    let answered = false;
    const health = on()
      .anonymous.request('GET', '/api/health')
      .then((r) => {
        answered = true;
        return r;
      });
    await new Promise((r) => setTimeout(r, 50));
    expect(answered).toBe(false);
    held.resolve();
    expect((await health).statusCode).toBe(200);
    gate = Promise.resolve();
  });
});
