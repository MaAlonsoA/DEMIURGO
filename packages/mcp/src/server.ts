// Servidor MCP del canal de agentes (S1, AC-DIS-001-03). Expone como herramientas las mismas
// operaciones que la API permite a un token de agente: leer, conversar con su nombre,
// registrar fuentes y proponer. Ninguna herramienta resuelve propuestas ni ejecuta comandos
// arbitrarios: eso queda para la persona, con su sesión.
//
// Este módulo no lee variables de entorno: la configuración llega como argumentos. Solo
// `main.ts` la lee al arrancar por stdio.

import {
  MAX_EXTERNAL_AGENT_PROPOSALS,
  decisionPayload,
  explorationPayload,
  fdrPayload,
  dependencySchema,
  recordReference,
} from '@demiurgo/domain';
import { type CallToolResult, McpServer, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type ApiClient, type ApiError, type ApiResponse, createApiClient } from './api-client.ts';

export type McpServerOptions = {
  /** URL base de la API HTTP de DEMIURGO, por ejemplo `http://127.0.0.1:8100`. */
  urlApi: string;
  /** Token de agente (`dmg_agente_…`); la API fija con él el actor `agent:<nombre>:<sesión>`. */
  token: string;
  /** Proyecto al que da acceso el token. */
  projectId: string;
  /** Sustituto de `fetch` para pruebas. */
  fetch?: typeof globalThis.fetch;
};

export const TOOL_NAMES = [
  'read_product_state',
  'read_inbox',
  'read_explorations',
  'read_exploration',
  'read_record',
  'read_batch',
  'read_sources',
  'search_knowledge',
  'converse',
  'register_source',
  'propose',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const AGENT_TOKEN_PREFIX = 'dmg_agent_';
const VERSION = '0.1.0';

const INSTRUCTIONS = [
  'Canal de agentes de DEMIURGO para un proyecto.',
  'Con este token puedes leer el estado del producto, la bandeja, las exploraciones, los registros, los lotes y las fuentes;',
  'conversar en una exploración con tu nombre; registrar fuentes; y enviar propuestas.',
  'Las propuestas quedan pendientes en la bandeja hasta que una persona las resuelva: el modelo propone y la persona decide.',
].join(' ');

// Esquemas de entrada. Las cargas de las propuestas son las del dominio: las mismas que valida la API.

const uuid = z.uuid();
const noArguments = z.object({}).strict();

const readExplorationInput = z.object({ exploration_id: uuid.describe('Id de la exploración.') }).strict();
const readRecordInput = z
  .object({ code: recordReference.shape.code.describe('Código del registro, por ejemplo DEC-PLN-001 o FDR-DIS-001.') })
  .strict();
const readBatchInput = z.object({ batch_id: uuid.describe('Id del lote de propuestas.') }).strict();
const searchInput = z
  .object({ queryName: z.string().trim().min(1).max(500).describe('Texto que se busca en el conocimiento del proyecto.') })
  .strict();

const chatInput = z
  .object({
    exploration_id: uuid.describe('Id de la exploración donde se publica el mensaje.'),
    question_id: uuid.optional().describe('Id de la pregunta, si el mensaje va en su hilo.'),
    text: z.string().trim().min(1).max(20_000).describe('Texto del mensaje.'),
  })
  .strict();

const registerSourceInput = z
  .object({
    name: z.string().trim().min(1).max(200).describe('Nombre de la fuente, por ejemplo VISION.md.'),
    content: z.string().min(1).max(200_000).describe('Contenido completo de la fuente.'),
  })
  .strict();

const dependencies = z
  .array(dependencySchema)
  .optional()
  .describe('Registros de los que depende la propuesta (id, código y versión vigente); si cambian, la propuesta queda obsoleta.');

const proposal = z.discriminatedUnion('type', [
  z.object({ type: z.literal('decision'), payload: decisionPayload, dependencies }).strict(),
  z.object({ type: z.literal('exploration'), payload: explorationPayload, dependencies }).strict(),
  z.object({ type: z.literal('fdr'), payload: fdrPayload, dependencies }).strict(),
]);

// El máximo por lote lo aplica la API (con su motivo); aquí solo se documenta.
const entradaProponer = z
  .object({
    summary: z.string().trim().max(2000).optional().describe('Resumen del lote para quien lo revise.'),
    proposals: z.array(proposal).min(1).describe(`Propuestas del lote: como máximo ${MAX_EXTERNAL_AGENT_PROPOSALS}.`),
  })
  .strict();

// Validación con mensajes en español. El SDK valida la entrada con mensajes en inglés; para
// evitarlo recibe un esquema que anuncia el JSON Schema de Zod pero deja pasar el valor, y la
// herramienta valida después con la configuración regional española de Zod.
const errorInSpanish = z.locales.es().localeError;

function announce(schema: z.ZodType): StandardSchemaWithJSON<unknown, unknown> {
  return {
    '~standard': {
      version: 1,
      vendor: 'demiurgo',
      validate: (value: unknown) => ({ value: value }),
      jsonSchema: schema['~standard'].jsonSchema,
    },
  };
}

function result(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

const CATEGORIES: Record<string, string> = {
  unauthenticated: 'Error de autenticación',
  forbidden: 'Operación no permitida',
  not_found: 'No encontrado',
  invalid_transition: 'Transición no válida',
  guard: 'No se cumplen las condiciones',
  conflict: 'Conflict',
  validation: 'Datos no válidos',
  request: 'Petición no válida',
  not_implemented: 'Aún no implementado',
  not_available: 'No disponible',
  disconnected: 'Sin conexión con la API',
  argList: 'Argumentos no válidos',
};

function toolError(e: Omit<ApiError, 'ok'>): CallToolResult {
  const category = CATEGORIES[e.error] ?? 'Error de la API';
  const http = e.state > 0 ? ` (HTTP ${e.state})` : '';
  const lines = [`${category}${http}: ${e.message}`];
  if (e.reasons.length > 0) lines.push('Motivos:', ...e.reasons.map((m) => `- ${m}`));
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: { error: e.error, message: e.message, reasons: e.reasons, http_status: e.state },
    isError: true,
  };
}

function object(data: unknown, key: string): Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : { [key]: data };
}

type Definition<E extends z.ZodType> = {
  title: string;
  description: string;
  input: E;
  readOnly: boolean;
  execute(args: z.output<E>, api: ApiClient): Promise<CallToolResult>;
};

function register<E extends z.ZodType>(server: McpServer, api: ApiClient, name: ToolName, d: Definition<E>): void {
  server.registerTool(
    name,
    {
      title: d.title,
      description: d.description,
      inputSchema: announce(d.input),
      annotations: {
        title: d.title,
        readOnlyHint: d.readOnly,
        destructiveHint: false,
        idempotentHint: d.readOnly,
        openWorldHint: false,
      },
    },
    async (args: unknown) => {
      const r = d.input.safeParse(args ?? {}, { error: errorInSpanish });
      if (!r.success) {
        return toolError({
          state: 0,
          error: 'argList',
          message: `La herramienta «${name}» recibió argumentos no válidos.`,
          reasons: r.error.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)),
        });
      }
      return d.execute(r.data, api);
    },
  );
}

/** Convierte una respuesta de la API en el resultado de la herramienta. */
function respond(r: ApiResponse, key = 'data'): CallToolResult {
  return r.ok ? result(object(r.data, key)) : toolError(r);
}

/** Comprueba la configuración antes de crear el servidor; lanza un error en español si no es válida. */
export function checkMcpOptions(op: McpServerOptions): void {
  let url: URL;
  try {
    url = new URL(op.urlApi);
  } catch {
    throw new Error(`La URL de la API de DEMIURGO no es válida: «${op.urlApi}».`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`La URL de la API de DEMIURGO debe ser http o https: «${op.urlApi}».`);
  }
  if (!op.token.startsWith(AGENT_TOKEN_PREFIX)) {
    throw new Error(`El token de agente debe empezar por «${AGENT_TOKEN_PREFIX}».`);
  }
  if (!uuid.safeParse(op.projectId).success) {
    throw new Error(`El id de proyecto no es válido: «${op.projectId}».`);
  }
}

/** Crea el servidor MCP del canal de agentes sobre la API HTTP de DEMIURGO. */
export function createMcpServer(op: McpServerOptions): McpServer {
  checkMcpOptions(op);
  const api = createApiClient(op);
  const server = new McpServer(
    { name: 'demiurgo', title: 'DEMIURGO', version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  register(server, api, 'read_product_state', {
    title: 'Leer el estado del producto',
    description:
      'Devuelve el estado del producto: decisiones y diseños con su versión vigente, su estado epistémico y su readiness, las exploraciones y el recuento de la bandeja.',
    input: noArguments,
    readOnly: true,
    execute: async (_a, c) => respond(await c.read('/state')),
  });

  register(server, api, 'read_inbox', {
    title: 'Leer la bandeja',
    description:
      'Devuelve la bandeja del proyecto: lotes pendientes con sus propuestas y su productor, preguntas por revisar y enlaces en revisión, cada elemento con su estado epistémico.',
    input: noArguments,
    readOnly: true,
    execute: async (_a, c) => respond(await c.read('/inbox')),
  });

  register(server, api, 'read_explorations', {
    title: 'Listar las exploraciones',
    description: 'Lista las exploraciones del proyecto con su propósito, su estado y su origen.',
    input: noArguments,
    readOnly: true,
    execute: async (_a, c) => respond(await c.read('/explorations'), 'explorations'),
  });

  register(server, api, 'read_exploration', {
    title: 'Leer una exploración',
    description:
      'Devuelve una exploración con su hilo de mensajes (cada uno con su autor), sus preguntas y sus exploraciones hijas.',
    input: readExplorationInput,
    readOnly: true,
    execute: async (a, c) => respond(await c.read(`/explorations/${encodeURIComponent(a.exploration_id)}`)),
  });

  register(server, api, 'read_record', {
    title: 'Leer un registro',
    description:
      'Devuelve un registro (decisión, FDR, ADR o bug) por su código: sus versiones, secciones, criterios (AC) con su verificación, enlaces y readiness.',
    input: readRecordInput,
    readOnly: true,
    execute: async (a, c) => respond(await c.read(`/records/${encodeURIComponent(a.code)}`)),
  });

  register(server, api, 'read_batch', {
    title: 'Leer un lote de propuestas',
    description: 'Devuelve un lote de propuestas con su productor, su modo de resolución y el estado de cada propuesta.',
    input: readBatchInput,
    readOnly: true,
    execute: async (a, c) => respond(await c.read(`/batches/${encodeURIComponent(a.batch_id)}`)),
  });

  register(server, api, 'read_sources', {
    title: 'Listar las fuentes',
    description: 'Lista las fuentes registradas en el proyecto con su nombre, su huella de contenido y quién las registró.',
    input: noArguments,
    readOnly: true,
    execute: async (_a, c) => respond(await c.read('/sources'), 'sources'),
  });

  register(server, api, 'search_knowledge', {
    title: 'Buscar en el conocimiento',
    description:
      'Busca en el conocimiento del proyecto (registros, exploraciones y fuentes) y devuelve los resultados más relevantes.',
    input: searchInput,
    readOnly: true,
    async execute(a, c) {
      const r = await c.read('/knowledge/search', { q: a.queryName });
      if (!r.ok && r.error === 'nonexistent_path') {
        return toolError({
          state: r.state,
          error: 'not_available',
          message: 'La búsqueda de conocimiento aún no está disponible.',
          reasons: [],
        });
      }
      return respond(r, 'results');
    },
  });

  register(server, api, 'converse', {
    title: 'Conversar en una exploración',
    description:
      'Publica un mensaje en el hilo de una exploración (o de una de sus preguntas) con el nombre de este agente como autor.',
    input: chatInput,
    readOnly: false,
    execute: async (a, c) =>
      respond(
        await c.command('message.post', {
          exploration_id: a.exploration_id,
          ...(a.question_id ? { question_id: a.question_id } : {}),
          text: a.text,
        }),
      ),
  });

  register(server, api, 'register_source', {
    title: 'Registrar una fuente',
    description:
      'Registra un documento como fuente del proyecto (por ejemplo VISION.md). Una fuente es una entrada no confiable: informa, pero no cambia ningún registro.',
    input: registerSourceInput,
    readOnly: false,
    execute: async (a, c) => respond(await c.command('source.register', { name: a.name, content: a.content })),
  });

  register(server, api, 'propose', {
    title: 'Propose',
    description: `Envía un lote de propuestas (decisión, exploración o FDR con sus criterios) a la bandeja del proyecto. Como máximo ${MAX_EXTERNAL_AGENT_PROPOSALS} propuestas por lote. Las propuestas quedan pendientes y una persona las resuelve una a una; este agente no puede resolverlas.`,
    input: entradaProponer,
    readOnly: false,
    execute: async (a, c) =>
      respond(
        await c.command('batch.submit', {
          ...(a.summary ? { summary: a.summary } : {}),
          proposals: a.proposals.map((p) => ({
            type: p.type,
            payload: p.payload,
            ...(p.dependencies ? { dependencies: p.dependencies } : {}),
          })),
        }),
      ),
  });

  return server;
}
