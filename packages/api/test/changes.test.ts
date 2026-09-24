// "What changed" since the person's last visit: the events of the log grouped by the thing they
// touch (record, thread, batch, knowledge), so the UI can dim what did not change and tell it in
// one line per thing.

import { describe, expect, it } from 'vitest';
import { useApi } from './support/api.ts';

const api = useApi();

type Thing = {
  kind: string;
  key: string;
  title: string | null;
  record_type?: string;
  events: { id: string; actor: string; command: string; entity_type: string; state_after: string | null }[];
};

describe('API: changes since the last visit', () => {
  it('AC-INT-001-16 the events since an id come grouped by thing, with the latest id to remember', async () => {
    const { person } = api();
    const created = await person.request('POST', '/api/projects', { name: 'Changes' });
    const projectId = created.json<{ project_id: string }>().project_id;
    const command = async (name: string, data: unknown, entityId?: string) => {
      const r = await person.request('POST', `/api/projects/${projectId}/commands/${name}`, {
        ...(entityId ? { entity_id: entityId } : {}),
        data,
      });
      if (r.statusCode !== 200) throw new Error(`${name}: ${r.body}`);
      return r.json<{ entity_id: string; result: Record<string, unknown> }>();
    };
    const before = await person.request('GET', `/api/projects/${projectId}/changes?since=0`);
    const since = before.json<{ latest: string }>().latest;

    const thread = await command('exploration.open', { purpose: 'Guests at events' });
    await command('message.post', { exploration_id: thread.entity_id, text: 'Two guests per member?', respond: false });
    await command('question.raise', { exploration_id: thread.entity_id, question: 'How many guests?' });
    const record = await command('record.create', {
      type: 'decision',
      domain: 'events',
      title: 'Two guests per member',
      sections: [
        { title: 'Context', content: 'Limited capacity.' },
        { title: 'Decision', content: 'Two guests maximum.' },
        { title: 'Consequences', content: 'Invitations are counted.' },
      ],
    });
    await command('record_version.approve', {}, String(record.result.versionId));

    const r = await person.request('GET', `/api/projects/${projectId}/changes?since=${since}`);
    expect(r.statusCode).toBe(200);
    const body = r.json<{ latest: string; things: Thing[] }>();
    expect(BigInt(body.latest)).toBeGreaterThan(BigInt(since));
    const byKind = (k: string) => body.things.filter((t) => t.kind === k);
    const [t] = byKind('exploration');
    expect(t).toMatchObject({ key: thread.entity_id, title: 'Guests at events' });
    expect(t?.events.map((e) => e.command)).toEqual(['exploration.open', 'message.post', 'question.raise']);
    const rec = byKind('record').find((x) => x.title === 'Two guests per member');
    expect(rec?.record_type).toBe('decision');
    expect(rec?.key).toMatch(/^DEC-/);
    expect(rec?.events.map((e) => e.command)).toEqual(expect.arrayContaining(['record.create', 'record_version.approve']));
    expect(rec?.events.every((e) => e.actor === 'human:ana')).toBe(true);

    const none = await person.request('GET', `/api/projects/${projectId}/changes?since=${body.latest}`);
    expect(none.json<{ latest: string; things: Thing[] }>()).toEqual({ latest: body.latest, things: [] });
  });

  it('AC-INT-001-10 the event log can be read for one entity, such as a run', async () => {
    const { person } = api();
    const created = await person.request('POST', '/api/projects', { name: 'Events of a run' });
    const projectId = created.json<{ project_id: string }>().project_id;
    const request = (text: string) =>
      person.request('POST', `/api/projects/${projectId}/commands/run.request`, {
        data: { action: 'echo', scope: { type: 'project' }, input: { text } },
      });
    const run = (await request('a')).json<{ entity_id: string }>().entity_id;
    await request('b');
    const r = await person.request('GET', `/api/projects/${projectId}/events?entity=${run}`);
    expect(r.statusCode).toBe(200);
    const events = r.json<{ entity_id: string; command: string }[]>();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.entity_id === run)).toBe(true);
    expect(events[0]?.command).toBe('run.request');
  });
});
