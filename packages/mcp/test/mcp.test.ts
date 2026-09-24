// Canal de agentes por MCP (AC-DIS-001-03): un cliente MCP del SDK llama a las herramientas
// del servidor MCP, que habla con la API real por HTTP con un token de agente. La persona
// resuelve con su sesión (cookie + CSRF) por la API.

import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { type CallToolResult, Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useApi } from '../../api/test/support/api.ts';
import { TOOL_NAMES, createMcpServer } from '../src/index.ts';

const api = useApi();
const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

let urlApi = '';
let projectId = '';
let explorationId = '';
let token = '';
let tokenId = '';
const clients: Client[] = [];

/** Comando de la persona por la API, con su cookie y su token CSRF. */
async function personCommand(command: string, body: Record<string, unknown>) {
  const r = await api().person.request('POST', `/api/projects/${projectId}/commands/${command}`, body);
  if (r.statusCode !== 200) throw new Error(`«${command}» falló con ${r.statusCode}: ${r.body}`);
  return r.json<{ entity_id: string; result: Record<string, unknown> | null }>();
}

async function issueToken(name: string): Promise<{ token: string; id: string }> {
  const r = await personCommand('agent_token.issue', { data: { name } });
  return { token: String(r.result?.token), id: r.entity_id };
}

async function connect(agentToken: string, substituteFetch?: typeof globalThis.fetch): Promise<Client> {
  const server = createMcpServer({
    urlApi,
    token: agentToken,
    projectId,
    ...(substituteFetch ? { fetch: substituteFetch } : {}),
  });
  const [clientEndpoint, serverEndpoint] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEndpoint);
  const client = new Client({ name: 'cliente-de-prueba', version: '1.0.0' });
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

/** Contenido estructurado de un resultado correcto; si la herramienta falló, su texto. */
function data(r: CallToolResult): unknown {
  if (r.isError) throw new Error(`La herramienta devolvió un error: ${textOf(r)}`);
  return r.structuredContent;
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

const decision = (n: number) => ({
  type: 'decision',
  payload: {
    title: `Decisión propuesta por MCP ${n}`,
    context: 'El agente externo ha leído la visión y propone fijar el alcance.',
    decision: 'El MVP cubre los dos pilares con aceptación humana.',
    consequences: 'Todo lo que proponga un agente pasa por la bandeja.',
  },
});

beforeAll(async () => {
  const { app, person } = api();
  // Servidor real en un puerto libre: el servidor MCP llama a la API por HTTP. Lo cierra el
  // `afterAll` de `usarApi` junto con la aplicación.
  await app.listen({ host: '127.0.0.1', port: 0 });
  urlApi = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const p = await person.request('POST', '/api/projects', { name: 'Canal MCP' });
  if (p.statusCode !== 200) throw new Error(`No se pudo crear el proyecto: ${p.body}`);
  projectId = p.json<{ project_id: string }>().project_id;
  explorationId = (await personCommand('exploration.open', { data: { purpose: 'Probar el canal de agentes por MCP' } }))
    .entity_id;
  ({ token, id: tokenId } = await issueToken('claude-code'));
});

afterAll(async () => {
  for (const c of clients) await c.close();
});

describe('servidor MCP del canal de agentes', () => {
  it('AC-DIS-001-03 expone exactamente las herramientas del canal y ninguna aprueba, acepta, confirma ni rechaza', async () => {
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
    const forbidden = /aprob|aprueb|acept|confirm|rechaz|approv|accept|reject|resolve_|ejecutar_comando/i;
    const texts = tools.map((t) => `${t.name} ${t.title ?? ''} ${t.description ?? ''}`);
    expect(texts.filter((t) => forbidden.test(t))).toEqual([]);
    expect(tools.filter((t) => !t.description).map((t) => t.name)).toEqual([]);
    expect(tools.filter((t) => t.inputSchema.type !== 'object').map((t) => t.name)).toEqual([]);
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name);
    expect(readOnly.sort()).toEqual(names.filter((n) => n.startsWith('read_') || n === 'search_knowledge'));
  });

  it('AC-DIS-001-03 conversar publica un mensaje con el agente como autor', async () => {
    const client = await connect(token);
    const r = data(
      await call(client, 'converse', { exploration_id: explorationId, text: 'Hola: soy un agente externo por MCP.' }),
    ) as { entity: string; entity_id: string };
    expect(r.entity).toBe('message');
    const author = `agent:claude-code:${tokenId}`;
    const row = await api()
      .environment.services.db.selectFrom('messages')
      .select(['author', 'body'])
      .where('id', '=', r.entity_id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ author: author, body: 'Hola: soy un agente externo por MCP.' });

    const exploration = data(await call(client, 'read_exploration', { exploration_id: explorationId })) as {
      messages: { id: string; author: string }[];
    };
    expect(exploration.messages.find((m) => m.id === r.entity_id)?.author).toBe(author);
    const list = data(await call(client, 'read_explorations')) as { explorations: { id: string }[] };
    expect(list.explorations.map((e) => e.id)).toContain(explorationId);
  });

  it('AC-DIS-001-03 registrar_fuente y proponer dejan la fuente y un lote pendiente que solo la persona resuelve', async () => {
    const client = await connect(token);
    const author = `agent:claude-code:${tokenId}`;

    const source = data(
      await call(client, 'register_source', { name: 'VISION.md', content: '# Visión\n\nDiseñar y construir con IA.' }),
    ) as { entity_id: string };
    const sources = data(await call(client, 'read_sources')) as {
      sources: { id: string; name: string; registered_by: string }[];
    };
    expect(sources.sources.find((f) => f.id === source.entity_id)).toMatchObject({ name: 'VISION.md', registered_by: author });

    const batch = data(await call(client, 'propose', { summary: 'Alcance del MVP', proposals: [decision(1)] })) as {
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

    // La persona resuelve con su sesión por la API.
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

  it('AC-DIS-001-03 proponer con 11 propuestas devuelve el motivo (máximo 10) y no crea nada', async () => {
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
    expect(textOf(r)).toMatch(/como máximo 10/);
    expect((r.structuredContent as { reasons: string[] }).reasons.join(' ')).toMatch(
      /como máximo 10 elementos por lote \(hay 11\)/,
    );
    expect(await count()).toBe(before);
  });

  it('AC-DIS-001-03 un token revocado hace que las herramientas devuelvan un error de autenticación', async () => {
    const another = await issueToken('agente-revocado');
    const client = await connect(another.token);
    expect(data(await call(client, 'read_product_state'))).toHaveProperty('project.id', projectId);
    await personCommand('agent_token.revoke', { entity_id: another.id, data: { reason: 'Fin de la prueba' } });
    const calls: [string, Record<string, unknown>][] = [
      ['read_product_state', {}],
      ['converse', { exploration_id: explorationId, text: 'No debería publicarse.' }],
      ['propose', { proposals: [decision(99)] }],
    ];
    const results = await Promise.all(calls.map(([name, args]) => call(client, name, args)));
    for (const r of results) {
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ error: 'unauthenticated', http_status: 401 });
      expect(textOf(r)).toMatch(/^Error de autenticación \(HTTP 401\): Token de agente no válido o revocado/);
    }
  });

  it('los argumentos no válidos se rechazan en español sin llamar a la API', async () => {
    let calls = 0;
    const client = await connect(token, async (input, init) => {
      calls++;
      return fetch(input, init);
    });
    const r = await call(client, 'read_exploration', { exploration_id: 'no-es-un-uuid' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^Argumentos no válidos: La herramienta «leer_exploracion» recibió argumentos no válidos/);
    expect(textOf(r)).toMatch(/exploracion_id: .*UUID/);
    const p = await call(client, 'propose', { proposals: [{ type: 'another', payload: {} }] });
    expect(p.isError).toBe(true);
    expect(calls).toBe(0);
  });

  it('buscar_conocimiento avisa en español mientras la búsqueda no existe en la API', async () => {
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
    const r = await call(client, 'search_knowledge', { queryName: 'aceptación humana' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^No disponible \(HTTP 404\): La búsqueda de conocimiento aún no está disponible\./);
    expect(requested[0]).toContain(`/api/projects/${projectId}/knowledge/search`);
    expect(new URL(requested[0] ?? '').searchParams.get('q')).toBe('aceptación humana');

    // Contra la API real: o la ruta ya existe y responde, o el aviso es el mismo.
    const real = await call(await connect(token), 'search_knowledge', { queryName: 'aceptación humana' });
    expect(!real.isError || textOf(real).includes('La búsqueda de conocimiento aún no está disponible')).toBe(true);
  });

  it('main.ts sirve las herramientas por stdio con la configuración del entorno', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MAIN],
      env: {
        ...getDefaultEnvironment(),
        DEMIURGO_API_URL: urlApi,
        DEMIURGO_AGENT_TOKEN: token,
        DEMIURGO_PROJECT: projectId,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'cliente-stdio', version: '1.0.0' });
    await client.connect(transport);
    clients.push(client);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(data(await call(client, 'read_product_state'))).toHaveProperty('project.id', projectId);
  });

  it('main.ts se niega a arrancar sin configuración y lo dice en español', async () => {
    const r = await new Promise<{ code: number | string | null | undefined; stderr: string }>((resolve) => {
      execFile(process.execPath, [MAIN], { env: getDefaultEnvironment() }, (error, _stdout, stderr) =>
        resolve({ code: error ? error.code : 0, stderr }),
      );
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/falta la variable de entorno DEMIURGO_API_URL/);
  });
});
