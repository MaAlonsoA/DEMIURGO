// Canal de agentes por MCP (AC-DIS-001-03): un cliente MCP del SDK llama a las herramientas
// del servidor MCP, que habla con la API real por HTTP con un token de agente. La persona
// resuelve con su sesión (cookie + CSRF) por la API.

import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { type CallToolResult, Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usarApi } from '../../api/test/soporte/api.ts';
import { NOMBRES_HERRAMIENTAS, crearServidorMcp } from '../src/index.ts';

const api = usarApi();
const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

let urlApi = '';
let proyectoId = '';
let exploracionId = '';
let token = '';
let tokenId = '';
const clientes: Client[] = [];

/** Comando de la persona por la API, con su cookie y su token CSRF. */
async function comandoPersona(comando: string, cuerpo: Record<string, unknown>) {
  const r = await api().persona.pedir('POST', `/api/proyectos/${proyectoId}/comandos/${comando}`, cuerpo);
  if (r.statusCode !== 200) throw new Error(`«${comando}» falló con ${r.statusCode}: ${r.body}`);
  return r.json<{ entidad_id: string; resultado: Record<string, unknown> | null }>();
}

async function emitirToken(nombre: string): Promise<{ token: string; id: string }> {
  const r = await comandoPersona('agent_token.issue', { datos: { nombre } });
  return { token: String(r.resultado?.token), id: r.entidad_id };
}

async function conectar(tokenAgente: string, fetchSustituto?: typeof globalThis.fetch): Promise<Client> {
  const servidor = crearServidorMcp({
    urlApi,
    token: tokenAgente,
    proyectoId,
    ...(fetchSustituto ? { fetch: fetchSustituto } : {}),
  });
  const [extremoCliente, extremoServidor] = InMemoryTransport.createLinkedPair();
  await servidor.connect(extremoServidor);
  const cliente = new Client({ name: 'cliente-de-prueba', version: '1.0.0' });
  await cliente.connect(extremoCliente);
  clientes.push(cliente);
  return cliente;
}

function llamar(cliente: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return cliente.callTool({ name, arguments: args });
}

function textoDe(r: CallToolResult): string {
  return r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
}

/** Contenido estructurado de un resultado correcto; si la herramienta falló, su texto. */
function datos(r: CallToolResult): unknown {
  if (r.isError) throw new Error(`La herramienta devolvió un error: ${textoDe(r)}`);
  return r.structuredContent;
}

function urlDe(entrada: string | URL | Request): string {
  if (typeof entrada === 'string') return entrada;
  return entrada instanceof URL ? entrada.href : entrada.url;
}

const decision = (n: number) => ({
  tipo: 'decision',
  carga: {
    titulo: `Decisión propuesta por MCP ${n}`,
    contexto: 'El agente externo ha leído la visión y propone fijar el alcance.',
    decision: 'El MVP cubre los dos pilares con aceptación humana.',
    consecuencias: 'Todo lo que proponga un agente pasa por la bandeja.',
  },
});

beforeAll(async () => {
  const { app, persona } = api();
  // Servidor real en un puerto libre: el servidor MCP llama a la API por HTTP. Lo cierra el
  // `afterAll` de `usarApi` junto con la aplicación.
  await app.listen({ host: '127.0.0.1', port: 0 });
  urlApi = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const p = await persona.pedir('POST', '/api/proyectos', { nombre: 'Canal MCP' });
  if (p.statusCode !== 200) throw new Error(`No se pudo crear el proyecto: ${p.body}`);
  proyectoId = p.json<{ proyecto_id: string }>().proyecto_id;
  exploracionId = (await comandoPersona('exploration.open', { datos: { proposito: 'Probar el canal de agentes por MCP' } }))
    .entidad_id;
  ({ token, id: tokenId } = await emitirToken('claude-code'));
});

afterAll(async () => {
  for (const c of clientes) await c.close();
});

describe('servidor MCP del canal de agentes', () => {
  it('AC-DIS-001-03 expone exactamente las herramientas del canal y ninguna aprueba, acepta, confirma ni rechaza', async () => {
    const cliente = await conectar(token);
    const { tools } = await cliente.listTools();
    const nombres = tools.map((t) => t.name).sort();
    expect(nombres).toEqual([...NOMBRES_HERRAMIENTAS].sort());
    expect(nombres).toEqual(
      [
        'buscar_conocimiento',
        'conversar',
        'leer_bandeja',
        'leer_estado_producto',
        'leer_exploracion',
        'leer_exploraciones',
        'leer_fuentes',
        'leer_lote',
        'leer_registro',
        'proponer',
        'registrar_fuente',
      ].sort(),
    );
    const prohibidas = /aprob|aprueb|acept|confirm|rechaz|approv|accept|reject|resolve_|ejecutar_comando/i;
    const textos = tools.map((t) => `${t.name} ${t.title ?? ''} ${t.description ?? ''}`);
    expect(textos.filter((t) => prohibidas.test(t))).toEqual([]);
    expect(tools.filter((t) => !t.description).map((t) => t.name)).toEqual([]);
    expect(tools.filter((t) => t.inputSchema.type !== 'object').map((t) => t.name)).toEqual([]);
    const soloLectura = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name);
    expect(soloLectura.sort()).toEqual(nombres.filter((n) => n.startsWith('leer_') || n === 'buscar_conocimiento'));
  });

  it('AC-DIS-001-03 conversar publica un mensaje con el agente como autor', async () => {
    const cliente = await conectar(token);
    const r = datos(
      await llamar(cliente, 'conversar', { exploracion_id: exploracionId, texto: 'Hola: soy un agente externo por MCP.' }),
    ) as { entidad: string; entidad_id: string };
    expect(r.entidad).toBe('message');
    const autor = `agent:claude-code:${tokenId}`;
    const fila = await api()
      .entorno.servicios.db.selectFrom('messages')
      .select(['author', 'body'])
      .where('id', '=', r.entidad_id)
      .executeTakeFirstOrThrow();
    expect(fila).toEqual({ author: autor, body: 'Hola: soy un agente externo por MCP.' });

    const exploracion = datos(await llamar(cliente, 'leer_exploracion', { exploracion_id: exploracionId })) as {
      mensajes: { id: string; author: string }[];
    };
    expect(exploracion.mensajes.find((m) => m.id === r.entidad_id)?.author).toBe(autor);
    const lista = datos(await llamar(cliente, 'leer_exploraciones')) as { exploraciones: { id: string }[] };
    expect(lista.exploraciones.map((e) => e.id)).toContain(exploracionId);
  });

  it('AC-DIS-001-03 registrar_fuente y proponer dejan la fuente y un lote pendiente que solo la persona resuelve', async () => {
    const cliente = await conectar(token);
    const autor = `agent:claude-code:${tokenId}`;

    const fuente = datos(
      await llamar(cliente, 'registrar_fuente', { nombre: 'VISION.md', contenido: '# Visión\n\nDiseñar y construir con IA.' }),
    ) as { entidad_id: string };
    const fuentes = datos(await llamar(cliente, 'leer_fuentes')) as {
      fuentes: { id: string; name: string; registered_by: string }[];
    };
    expect(fuentes.fuentes.find((f) => f.id === fuente.entidad_id)).toMatchObject({ name: 'VISION.md', registered_by: autor });

    const lote = datos(await llamar(cliente, 'proponer', { resumen: 'Alcance del MVP', propuestas: [decision(1)] })) as {
      entidad: string;
      entidad_id: string;
      estado: string;
      resultado: { propuestas: string[] };
    };
    expect(lote).toMatchObject({ entidad: 'batch', estado: 'pending' });
    const propuestaId = lote.resultado.propuestas[0] ?? '';

    const bandeja = datos(await llamar(cliente, 'leer_bandeja')) as { lotes: { id: string }[] };
    expect(bandeja.lotes.find((l) => l.id === lote.entidad_id)).toMatchObject({
      tipo: 'agent',
      resolucion: 'item',
      productor: autor,
      propuestas: [{ id: propuestaId, estado: 'pending' }],
    });
    const detalle = datos(await llamar(cliente, 'leer_lote', { lote_id: lote.entidad_id }));
    expect(detalle).toMatchObject({ state: 'pending', producer: autor, resolution_mode: 'item' });

    // La persona resuelve con su sesión por la API.
    const aceptada = await comandoPersona('proposal.accept', { entidad_id: propuestaId, datos: {} });
    const { recordId, codigo } = aceptada.resultado as { recordId: string; codigo: string };
    const creacion = await api()
      .entorno.servicios.db.selectFrom('events')
      .select(['actor'])
      .where('command', '=', 'record.create')
      .where('entity_id', '=', recordId)
      .executeTakeFirstOrThrow();
    expect(creacion.actor).toBe('human:ana');

    expect(datos(await llamar(cliente, 'leer_registro', { codigo }))).toMatchObject({ codigo, tipo: 'decision' });
    const estado = datos(await llamar(cliente, 'leer_estado_producto')) as { decisiones: { codigo: string }[] };
    expect(estado.decisiones.map((d) => d.codigo)).toContain(codigo);
  });

  it('AC-DIS-001-03 proponer con 11 propuestas devuelve el motivo (máximo 10) y no crea nada', async () => {
    const cliente = await conectar(token);
    const contar = async () =>
      (
        await api()
          .entorno.servicios.db.selectFrom('proposal_batches')
          .select('id')
          .where('project_id', '=', proyectoId)
          .execute()
      ).length;
    const antes = await contar();
    const r = await llamar(cliente, 'proponer', { propuestas: Array.from({ length: 11 }, (_, i) => decision(i + 1)) });
    expect(r.isError).toBe(true);
    expect(textoDe(r)).toMatch(/como máximo 10/);
    expect((r.structuredContent as { motivos: string[] }).motivos.join(' ')).toMatch(
      /como máximo 10 elementos por lote \(hay 11\)/,
    );
    expect(await contar()).toBe(antes);
  });

  it('AC-DIS-001-03 un token revocado hace que las herramientas devuelvan un error de autenticación', async () => {
    const otro = await emitirToken('agente-revocado');
    const cliente = await conectar(otro.token);
    expect(datos(await llamar(cliente, 'leer_estado_producto'))).toHaveProperty('proyecto.id', proyectoId);
    await comandoPersona('agent_token.revoke', { entidad_id: otro.id, datos: { motivo: 'Fin de la prueba' } });
    const llamadas: [string, Record<string, unknown>][] = [
      ['leer_estado_producto', {}],
      ['conversar', { exploracion_id: exploracionId, texto: 'No debería publicarse.' }],
      ['proponer', { propuestas: [decision(99)] }],
    ];
    const resultados = await Promise.all(llamadas.map(([nombre, args]) => llamar(cliente, nombre, args)));
    for (const r of resultados) {
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ error: 'no_autenticado', estado_http: 401 });
      expect(textoDe(r)).toMatch(/^Error de autenticación \(HTTP 401\): Token de agente no válido o revocado/);
    }
  });

  it('los argumentos no válidos se rechazan en español sin llamar a la API', async () => {
    let llamadas = 0;
    const cliente = await conectar(token, async (entrada, init) => {
      llamadas++;
      return fetch(entrada, init);
    });
    const r = await llamar(cliente, 'leer_exploracion', { exploracion_id: 'no-es-un-uuid' });
    expect(r.isError).toBe(true);
    expect(textoDe(r)).toMatch(/^Argumentos no válidos: La herramienta «leer_exploracion» recibió argumentos no válidos/);
    expect(textoDe(r)).toMatch(/exploracion_id: .*UUID/);
    const p = await llamar(cliente, 'proponer', { propuestas: [{ tipo: 'otro', carga: {} }] });
    expect(p.isError).toBe(true);
    expect(llamadas).toBe(0);
  });

  it('buscar_conocimiento avisa en español mientras la búsqueda no existe en la API', async () => {
    const pedidas: string[] = [];
    const cliente = await conectar(token, async (entrada, init) => {
      const url = urlDe(entrada);
      pedidas.push(url);
      if (url.includes('/conocimiento/buscar')) {
        return new Response(JSON.stringify({ message: 'Route not found', error: 'Not Found', statusCode: 404 }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return fetch(entrada, init);
    });
    const r = await llamar(cliente, 'buscar_conocimiento', { consulta: 'aceptación humana' });
    expect(r.isError).toBe(true);
    expect(textoDe(r)).toMatch(/^No disponible \(HTTP 404\): La búsqueda de conocimiento aún no está disponible\./);
    expect(pedidas[0]).toContain(`/api/proyectos/${proyectoId}/conocimiento/buscar`);
    expect(new URL(pedidas[0] ?? '').searchParams.get('q')).toBe('aceptación humana');

    // Contra la API real: o la ruta ya existe y responde, o el aviso es el mismo.
    const real = await llamar(await conectar(token), 'buscar_conocimiento', { consulta: 'aceptación humana' });
    expect(!real.isError || textoDe(real).includes('La búsqueda de conocimiento aún no está disponible')).toBe(true);
  });

  it('main.ts sirve las herramientas por stdio con la configuración del entorno', async () => {
    const transporte = new StdioClientTransport({
      command: process.execPath,
      args: [MAIN],
      env: {
        ...getDefaultEnvironment(),
        DEMIURGO_API_URL: urlApi,
        DEMIURGO_AGENT_TOKEN: token,
        DEMIURGO_PROYECTO: proyectoId,
      },
      stderr: 'pipe',
    });
    const cliente = new Client({ name: 'cliente-stdio', version: '1.0.0' });
    await cliente.connect(transporte);
    clientes.push(cliente);
    const { tools } = await cliente.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...NOMBRES_HERRAMIENTAS].sort());
    expect(datos(await llamar(cliente, 'leer_estado_producto'))).toHaveProperty('proyecto.id', proyectoId);
  });

  it('main.ts se niega a arrancar sin configuración y lo dice en español', async () => {
    const r = await new Promise<{ codigo: number | string | null | undefined; stderr: string }>((resolver) => {
      execFile(process.execPath, [MAIN], { env: getDefaultEnvironment() }, (error, _stdout, stderr) =>
        resolver({ codigo: error ? error.code : 0, stderr }),
      );
    });
    expect(r.codigo).toBe(2);
    expect(r.stderr).toMatch(/falta la variable de entorno DEMIURGO_API_URL/);
  });
});
