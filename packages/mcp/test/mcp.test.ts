// Agent channel over MCP (AC-DIS-001-03): an MCP client of the SDK calls the tools
// of the MCP server, which talks to the real API over HTTP with an agent token. The person
// resolves things with their session (cookie + CSRF) through the API.

import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { ATTR, CHANNEL_HEADER, SPAN } from '@demiurgo/domain';
import { type CallToolResult, Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useApi } from '../../api/test/support/api.ts';
import { TOOL_NAMES, createMcpServer } from '../src/index.ts';

const api = useApi();
const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

let apiUrl = '';
let projectId = '';
let explorationId = '';
let token = '';
let tokenId = '';
const clients: Client[] = [];

/** Person's command through the API, with their cookie and CSRF token. */
async function personCommand(command: string, body: Record<string, unknown>) {
  const r = await api().person.request('POST', `/api/projects/${projectId}/commands/${command}`, body);
  if (r.statusCode !== 200) throw new Error(`"${command}" failed with ${r.statusCode}: ${r.body}`);
  return r.json<{ entity_id: string; result: Record<string, unknown> | null }>();
}

async function issueToken(name: string): Promise<{ token: string; id: string }> {
  const r = await personCommand('agent_token.issue', { data: { name } });
  return { token: String(r.result?.token), id: r.entity_id };
}

async function connect(agentToken: string, substituteFetch?: typeof globalThis.fetch): Promise<Client> {
  const server = createMcpServer({
    apiUrl,
    token: agentToken,
    projectId,
    ...(substituteFetch ? { fetch: substituteFetch } : {}),
  });
  const [clientEndpoint, serverEndpoint] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEndpoint);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientEndpoint);
  clients.push(client);
  return client;
}

function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return client.callTool({ name, arguments: args });
}

function textOf(r: CallToolResult): string {
  return r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
}

/** Structured content of a successful result; if the tool failed, its text. */
function data(r: CallToolResult): unknown {
  if (r.isError) throw new Error(`The tool returned an error: ${textOf(r)}`);
  return r.structuredContent;
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

const decision = (n: number) => ({
  type: 'decision',
  payload: {
    title: `Decision proposed by MCP ${n}`,
    context: 'The external agent has read the vision and proposes fixing the scope.',
    decision: 'The MVP covers both pillars with human acceptance.',
    consequences: 'Everything an agent proposes goes through the inbox.',
  },
});

beforeAll(async () => {
  const { app, person } = api();
  // Real server on a free port: the MCP server calls the API over HTTP. Closed by
  // `useApi`'s `afterAll` along with the app.
  await app.listen({ host: '127.0.0.1', port: 0 });
  apiUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const p = await person.request('POST', '/api/projects', { name: 'MCP channel' });
  if (p.statusCode !== 200) throw new Error(`Could not create the project: ${p.body}`);
  projectId = p.json<{ project_id: string }>().project_id;
  explorationId = (await personCommand('exploration.open', { data: { purpose: 'Test the MCP agent channel' } })).entity_id;
  ({ token, id: tokenId } = await issueToken('claude-code'));
});

afterAll(async () => {
  for (const c of clients) await c.close();
});

describe('MCP server for the agent channel', () => {
  it('AC-DIS-001-03 exposes exactly the channel tools and none of them approves, accepts, confirms or rejects', async () => {
    const client = await connect(token);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    expect(names).toEqual(
      [
        'search_knowledge',
        'converse',
        'read_inbox',
        'read_product_state',
        'read_exploration',
        'read_explorations',
        'read_sources',
        'read_batch',
        'read_record',
        'propose',
        'register_source',
      ].sort(),
    );
    const forbidden = /approv|accept(?!ance)|confirm|reject|resolve_|execute_command/i;
    const texts = tools.map((t) => `${t.name} ${t.title ?? ''} ${t.description ?? ''}`);
    expect(texts.filter((t) => forbidden.test(t))).toEqual([]);
    expect(tools.filter((t) => !t.description).map((t) => t.name)).toEqual([]);
    expect(tools.filter((t) => t.inputSchema.type !== 'object').map((t) => t.name)).toEqual([]);
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name);
    expect(readOnly.sort()).toEqual(names.filter((n) => n.startsWith('read_') || n === 'search_knowledge'));
  });

  it('AC-DIS-001-03 converse posts a message with the agent as its author', async () => {
    const client = await connect(token);
    const r = data(
      await call(client, 'converse', { exploration_id: explorationId, text: 'Hello: I am an external agent over MCP.' }),
    ) as { entity: string; entity_id: string };
    expect(r.entity).toBe('message');
    const author = `agent:claude-code:${tokenId}`;
    const row = await api()
      .environment.services.db.selectFrom('messages')
      .select(['author', 'body'])
      .where('id', '=', r.entity_id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ author: author, body: 'Hello: I am an external agent over MCP.' });

    const exploration = data(await call(client, 'read_exploration', { exploration_id: explorationId })) as {
      messages: { id: string; author: string }[];
    };
    expect(exploration.messages.find((m) => m.id === r.entity_id)?.author).toBe(author);
    const list = data(await call(client, 'read_explorations')) as { explorations: { id: string }[] };
    expect(list.explorations.map((e) => e.id)).toContain(explorationId);
  });

  it('AC-DIS-001-03 register_source and propose leave the source and a pending batch that only the person can resolve', async () => {
    const client = await connect(token);
    const author = `agent:claude-code:${tokenId}`;

    const source = data(
      await call(client, 'register_source', { name: 'VISION.md', content: '# Vision\n\nDesign and build with AI.' }),
    ) as { entity_id: string };
    const sources = data(await call(client, 'read_sources')) as {
      sources: { id: string; name: string; registered_by: string }[];
    };
    expect(sources.sources.find((f) => f.id === source.entity_id)).toMatchObject({ name: 'VISION.md', registered_by: author });

    const batch = data(await call(client, 'propose', { summary: 'MVP scope', proposals: [decision(1)] })) as {
      entity: string;
      entity_id: string;
      state: string;
      result: { proposals: string[] };
    };
    expect(batch).toMatchObject({ entity: 'batch', state: 'pending' });
    const proposalId = batch.result.proposals[0] ?? '';

    const inbox = data(await call(client, 'read_inbox')) as { batches: { id: string }[] };
    expect(inbox.batches.find((l) => l.id === batch.entity_id)).toMatchObject({
      type: 'agent',
      resolution: 'item',
      producer: author,
      proposals: [{ id: proposalId, state: 'pending' }],
    });
    const detail = data(await call(client, 'read_batch', { batch_id: batch.entity_id }));
    expect(detail).toMatchObject({ state: 'pending', producer: author, resolution_mode: 'item' });

    // The person resolves it with their session through the API.
    const accepted = await personCommand('proposal.accept', { entity_id: proposalId, data: {} });
    const { recordId, code } = accepted.result as { recordId: string; code: string };
    const creation = await api()
      .environment.services.db.selectFrom('events')
      .select(['actor'])
      .where('command', '=', 'record.create')
      .where('entity_id', '=', recordId)
      .executeTakeFirstOrThrow();
    expect(creation.actor).toBe('human:ana');

    expect(data(await call(client, 'read_record', { code }))).toMatchObject({ code, type: 'decision' });
    const state = data(await call(client, 'read_product_state')) as { decisions: { code: string }[] };
    expect(state.decisions.map((d) => d.code)).toContain(code);
  });

  it('AC-DIS-001-03 propose with 11 proposals returns the reason (maximum 10) and creates nothing', async () => {
    const client = await connect(token);
    const count = async () =>
      (
        await api()
          .environment.services.db.selectFrom('proposal_batches')
          .select('id')
          .where('project_id', '=', projectId)
          .execute()
      ).length;
    const before = await count();
    const r = await call(client, 'propose', { proposals: Array.from({ length: 11 }, (_, i) => decision(i + 1)) });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/at most 10/);
    expect((r.structuredContent as { reasons: string[] }).reasons.join(' ')).toMatch(
      /can propose at most 10 items per batch \(there are 11\)/,
    );
    expect(await count()).toBe(before);
  });

  it('AC-DIS-001-03 a revoked token makes the tools return an authentication error', async () => {
    const another = await issueToken('revoked-agent');
    const client = await connect(another.token);
    expect(data(await call(client, 'read_product_state'))).toHaveProperty('project.id', projectId);
    await personCommand('agent_token.revoke', { entity_id: another.id, data: { reason: 'End of test' } });
    const calls: [string, Record<string, unknown>][] = [
      ['read_product_state', {}],
      ['converse', { exploration_id: explorationId, text: 'This should not be posted.' }],
      ['propose', { proposals: [decision(99)] }],
    ];
    const results = await Promise.all(calls.map(([name, args]) => call(client, name, args)));
    for (const r of results) {
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ error: 'unauthenticated', http_status: 401 });
      expect(textOf(r)).toMatch(/^Authentication error \(HTTP 401\): Invalid or revoked agent token/);
    }
  });

  it('every request carries the channel header, and the API records the interaction as mcp', async () => {
    const seen: (string | null)[] = [];
    const client = await connect(token, async (input, init) => {
      seen.push(new Headers(init?.headers).get(CHANNEL_HEADER));
      return fetch(input, init);
    });
    const mcpInteractions = () =>
      api()
        .environment.observer.spans()
        .filter((s) => s.name === `${SPAN.interaction} message.post` && s.attributes[ATTR.channel] === 'mcp');
    const before = mcpInteractions().length;
    data(await call(client, 'read_exploration', { exploration_id: explorationId }));
    data(await call(client, 'converse', { exploration_id: explorationId, text: 'Which channel am I on?' }));
    expect(seen).toEqual(['mcp', 'mcp']);
    const after = mcpInteractions();
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)?.attributes[ATTR.actor]).toBe(`agent:claude-code:${tokenId}`);
  });

  it('invalid arguments are rejected without calling the API', async () => {
    let calls = 0;
    const client = await connect(token, async (input, init) => {
      calls++;
      return fetch(input, init);
    });
    const r = await call(client, 'read_exploration', { exploration_id: 'not-a-uuid' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^Invalid arguments: Tool "read_exploration" received invalid arguments/);
    expect(textOf(r)).toMatch(/exploration_id: .*UUID/);
    const p = await call(client, 'propose', { proposals: [{ type: 'another', payload: {} }] });
    expect(p.isError).toBe(true);
    expect(calls).toBe(0);
  });

  it('search_knowledge warns while the search does not exist yet in the API', async () => {
    const requested: string[] = [];
    const client = await connect(token, async (input, init) => {
      const url = urlOf(input);
      requested.push(url);
      if (url.includes('/knowledge/search')) {
        return new Response(JSON.stringify({ message: 'Route not found', error: 'Not Found', statusCode: 404 }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return fetch(input, init);
    });
    const r = await call(client, 'search_knowledge', { query: 'human acceptance' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^Not available \(HTTP 404\): Knowledge search is not available yet\./);
    expect(requested[0]).toContain(`/api/projects/${projectId}/knowledge/search`);
    expect(new URL(requested[0] ?? '').searchParams.get('q')).toBe('human acceptance');

    // Against the real API: either the route already exists and responds, or the warning is the same.
    const real = await call(await connect(token), 'search_knowledge', { query: 'human acceptance' });
    expect(!real.isError || textOf(real).includes('Knowledge search is not available yet')).toBe(true);
  });

  it('main.ts serves the tools over stdio with the environment configuration', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MAIN],
      env: {
        ...getDefaultEnvironment(),
        DEMIURGO_API_URL: apiUrl,
        DEMIURGO_AGENT_TOKEN: token,
        DEMIURGO_PROJECT: projectId,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-client', version: '1.0.0' });
    await client.connect(transport);
    clients.push(client);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(data(await call(client, 'read_product_state'))).toHaveProperty('project.id', projectId);
  });

  it('main.ts refuses to start without configuration and says why', async () => {
    const r = await new Promise<{ code: number | string | null | undefined; stderr: string }>((resolve) => {
      execFile(process.execPath, [MAIN], { env: getDefaultEnvironment() }, (error, _stdout, stderr) =>
        resolve({ code: error ? error.code : 0, stderr }),
      );
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/missing environment variable DEMIURGO_API_URL/);
  });
});
