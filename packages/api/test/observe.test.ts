// The API as the root of interactions (observability spec §7.2): every command that enters through
// it opens an `interaction <command>` span with its channel, the body returns the interaction id,
// and the journal's correlation is that id. The MCP server's header makes the channel `mcp`.

import { ATTR, CHANNEL_HEADER, SPAN } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { useApi } from './support/api.ts';

const api = useApi();
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function interactionSpan(command: string, interactionId: string) {
  return api()
    .environment.observer.spans()
    .find((s) => s.name === `${SPAN.interaction} ${command}` && s.attributes[ATTR.interactionId] === interactionId);
}

describe('API: interactions', () => {
  it('a command through the API is an interaction with channel api, and the body returns its id', async () => {
    const r = await api().person.request('POST', '/api/projects', { name: 'Observed' });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ project_id: string; state: string; seq: number; interaction_id: string }>();
    expect(body).toMatchObject({ state: 'active', seq: 1 });
    expect(body.interaction_id).toMatch(RE_UUID);

    const root = interactionSpan('project.create', body.interaction_id);
    expect(root?.parentSpanContext).toBeUndefined();
    expect(root?.attributes).toMatchObject({
      [ATTR.channel]: 'api',
      [ATTR.actor]: 'human:ana',
      [ATTR.actorType]: 'human',
      [ATTR.command]: 'project.create',
      [ATTR.httpRoute]: '/api/projects',
    });
    const command = api()
      .environment.observer.spans()
      .find((s) => s.name === `${SPAN.command} project.create` && s.spanContext().traceId === root?.spanContext().traceId);
    expect(command?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);

    const event = await api()
      .environment.services.db.selectFrom('events')
      .select('cause')
      .where('project_id', '=', body.project_id)
      .executeTakeFirstOrThrow();
    expect(event.cause).toMatchObject({ correlation: body.interaction_id });
  });

  it('a request with the MCP channel header is recorded as mcp, with its project, entity and route', async () => {
    const p = await api().person.request('POST', '/api/projects', { name: 'Through MCP' });
    const projectId = p.json<{ project_id: string }>().project_id;
    const r = await api().person.request(
      'POST',
      `/api/projects/${projectId}/commands/exploration.open`,
      { data: { purpose: 'Opened over MCP' } },
      { [CHANNEL_HEADER]: 'mcp' },
    );
    expect(r.statusCode).toBe(200);
    const body = r.json<{
      entity: string;
      entity_id: string;
      state: string;
      seq: number;
      result: unknown;
      interaction_id: string;
    }>();
    expect(body).toMatchObject({ entity: 'exploration', state: 'active', result: null });
    expect(body.interaction_id).toMatch(RE_UUID);

    const root = interactionSpan('exploration.open', body.interaction_id);
    expect(root?.attributes).toMatchObject({
      [ATTR.channel]: 'mcp',
      [ATTR.command]: 'exploration.open',
      [ATTR.projectId]: projectId,
      [ATTR.httpRoute]: '/api/projects/:projectId/commands/:command',
    });
    const command = api()
      .environment.observer.spans()
      .find((s) => s.name === `${SPAN.command} exploration.open` && s.spanContext().traceId === root?.spanContext().traceId);
    expect(command?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
    expect(command?.attributes[ATTR.entityId]).toBe(body.entity_id);

    // A query emits nothing.
    const spansBefore = api().environment.observer.spans().length;
    expect((await api().person.request('GET', `/api/projects/${projectId}/explorations`)).statusCode).toBe(200);
    expect(api().environment.observer.spans()).toHaveLength(spansBefore);
  });
});
