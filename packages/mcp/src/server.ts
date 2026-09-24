// MCP server for the agent channel (S1, AC-DIS-001-03). Exposes as tools the same
// operations the API allows an agent token: read, converse under its name,
// register sources and propose. No tool resolves proposals or runs arbitrary
// commands: that is left to the person, with their session.
//
// This module does not read environment variables: the configuration arrives as
// arguments. Only `main.ts` reads it on startup over stdio.

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
  /** Base URL of the DEMIURGO HTTP API, e.g. `http://127.0.0.1:8100`. */
  urlApi: string;
  /** Agent token (`dmg_agent_…`); the API uses it to fix the actor `agent:<name>:<session>`. */
  token: string;
  /** Project the token grants access to. */
  projectId: string;
  /** `fetch` substitute for tests. */
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
  "DEMIURGO's agent channel for a project.",
  'With this token you can read the product state, the inbox, the explorations, the records, the batches and the sources;',
  'converse in an exploration under your name; register sources; and send proposals.',
  'Proposals stay pending in the inbox until a person resolves them: the model proposes and the person decides.',
].join(' ');

// Input schemas. Proposal payloads are the domain's: the same ones the API validates.

const uuid = z.uuid();
const noArguments = z.object({}).strict();

const readExplorationInput = z.object({ exploration_id: uuid.describe('Id of the exploration.') }).strict();
const readRecordInput = z
  .object({ code: recordReference.shape.code.describe('Record code, e.g. DEC-PLN-001 or FDR-DIS-001.') })
  .strict();
const readBatchInput = z.object({ batch_id: uuid.describe('Id of the proposal batch.') }).strict();
const searchInput = z
  .object({ queryName: z.string().trim().min(1).max(500).describe('Text to search for in the project knowledge.') })
  .strict();

const chatInput = z
  .object({
    exploration_id: uuid.describe('Id of the exploration where the message is posted.'),
    question_id: uuid.optional().describe('Id of the question, if the message goes in its thread.'),
    text: z.string().trim().min(1).max(20_000).describe('Message text.'),
  })
  .strict();

const registerSourceInput = z
  .object({
    name: z.string().trim().min(1).max(200).describe('Source name, e.g. VISION.md.'),
    content: z.string().min(1).max(200_000).describe('Full content of the source.'),
  })
  .strict();

const dependencies = z
  .array(dependencySchema)
  .optional()
  .describe('Records the proposal depends on (id, code and current version); if they change, the proposal becomes stale.');

const proposal = z.discriminatedUnion('type', [
  z.object({ type: z.literal('decision'), payload: decisionPayload, dependencies }).strict(),
  z.object({ type: z.literal('exploration'), payload: explorationPayload, dependencies }).strict(),
  z.object({ type: z.literal('fdr'), payload: fdrPayload, dependencies }).strict(),
]);

// The per-batch maximum is enforced by the API (with its own reason); this is only documentation.
const proposeInput = z
  .object({
    summary: z.string().trim().max(2000).optional().describe('Summary of the batch for whoever reviews it.'),
    proposals: z.array(proposal).min(1).describe(`Proposals in the batch: at most ${MAX_EXTERNAL_AGENT_PROPOSALS}.`),
  })
  .strict();

// Validation with English messages. The SDK validates the input itself with English messages
// already; to control the exact wording, it receives a schema that announces Zod's JSON Schema
// but lets the value through unchanged, and the tool validates afterwards itself using Zod's
// English locale explicitly.
const errorInEnglish = z.locales.en().localeError;

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
  unauthenticated: 'Authentication error',
  forbidden: 'Operation not allowed',
  not_found: 'Not found',
  invalid_transition: 'Invalid transition',
  guard: 'Conditions not met',
  conflict: 'Conflict',
  validation: 'Invalid data',
  request: 'Invalid request',
  not_implemented: 'Not implemented yet',
  not_available: 'Not available',
  disconnected: 'No connection to the API',
  argList: 'Invalid arguments',
};

function toolError(e: Omit<ApiError, 'ok'>): CallToolResult {
  const category = CATEGORIES[e.error] ?? 'API error';
  const http = e.state > 0 ? ` (HTTP ${e.state})` : '';
  const lines = [`${category}${http}: ${e.message}`];
  if (e.reasons.length > 0) lines.push('Reasons:', ...e.reasons.map((m) => `- ${m}`));
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: { error: e.error, message: e.message, reasons: e.reasons, http_status: e.state },
    isError: true,
  };
}

function object(data: unknown, key: string): Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : { [key]: data };
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
      const r = d.input.safeParse(args ?? {}, { error: errorInEnglish });
      if (!r.success) {
        return toolError({
          state: 0,
          error: 'argList',
          message: `Tool "${name}" received invalid arguments.`,
          reasons: r.error.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)),
        });
      }
      return d.execute(r.data, api);
    },
  );
}

/** Turns an API response into the tool's result. */
function respond(r: ApiResponse, key = 'data'): CallToolResult {
  return r.ok ? result(object(r.data, key)) : toolError(r);
}

/** Checks the configuration before creating the server; throws an error if it is invalid. */
export function checkMcpOptions(op: McpServerOptions): void {
  let url: URL;
  try {
    url = new URL(op.urlApi);
  } catch {
    throw new Error(`The DEMIURGO API URL is not valid: "${op.urlApi}".`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`The DEMIURGO API URL must be http or https: "${op.urlApi}".`);
  }
  if (!op.token.startsWith(AGENT_TOKEN_PREFIX)) {
    throw new Error(`The agent token must start with "${AGENT_TOKEN_PREFIX}".`);
  }
  if (!uuid.safeParse(op.projectId).success) {
    throw new Error(`The project id is not valid: "${op.projectId}".`);
  }
}

/** Creates the agent channel's MCP server on top of the DEMIURGO HTTP API. */
export function createMcpServer(op: McpServerOptions): McpServer {
  checkMcpOptions(op);
  const api = createApiClient(op);
  const server = new McpServer(
    { name: 'demiurgo', title: 'DEMIURGO', version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  register(server, api, 'read_product_state', {
    title: 'Read the product state',
    description:
      'Returns the product state: decisions and designs with their current version, epistemic status and readiness, the explorations and the inbox count.',
    input: noArguments,
    readOnly: true,
    execute: async (_a, c) => respond(await c.read('/state')),
  });

  register(server, api, 'read_inbox', {
    title: 'Read the inbox',
    description:
      "Returns the project's inbox: pending batches with their proposals and producer, questions to review and links under review, each item with its epistemic status.",
    input: noArguments,
    readOnly: true,
    execute: async (_a, c) => respond(await c.read('/inbox')),
  });

  register(server, api, 'read_explorations', {
    title: 'List the explorations',
    description: "Lists the project's explorations with their purpose, state and origin.",
    input: noArguments,
    readOnly: true,
    execute: async (_a, c) => respond(await c.read('/explorations'), 'explorations'),
  });

  register(server, api, 'read_exploration', {
    title: 'Read an exploration',
    description:
      'Returns an exploration with its message thread (each with its author), its questions and its child explorations.',
    input: readExplorationInput,
    readOnly: true,
    execute: async (a, c) => respond(await c.read(`/explorations/${encodeURIComponent(a.exploration_id)}`)),
  });

  register(server, api, 'read_record', {
    title: 'Read a record',
    description:
      'Returns a record (decision, FDR, ADR or bug) by its code: its versions, sections, acceptance criteria with their verification, links and readiness.',
    input: readRecordInput,
    readOnly: true,
    execute: async (a, c) => respond(await c.read(`/records/${encodeURIComponent(a.code)}`)),
  });

  register(server, api, 'read_batch', {
    title: 'Read a proposal batch',
    description: 'Returns a proposal batch with its producer, its resolution mode and the state of each proposal.',
    input: readBatchInput,
    readOnly: true,
    execute: async (a, c) => respond(await c.read(`/batches/${encodeURIComponent(a.batch_id)}`)),
  });

  register(server, api, 'read_sources', {
    title: 'List the sources',
    description: 'Lists the sources registered in the project with their name, content fingerprint and who registered them.',
    input: noArguments,
    readOnly: true,
    execute: async (_a, c) => respond(await c.read('/sources'), 'sources'),
  });

  register(server, api, 'search_knowledge', {
    title: 'Search the knowledge',
    description: "Searches the project's knowledge (records, explorations and sources) and returns the most relevant results.",
    input: searchInput,
    readOnly: true,
    async execute(a, c) {
      const r = await c.read('/knowledge/search', { q: a.queryName });
      if (!r.ok && r.error === 'nonexistent_path') {
        return toolError({
          state: r.state,
          error: 'not_available',
          message: 'Knowledge search is not available yet.',
          reasons: [],
        });
      }
      return respond(r, 'results');
    },
  });

  register(server, api, 'converse', {
    title: 'Converse in an exploration',
    description: "Posts a message in an exploration's thread (or one of its questions) under this agent's name as author.",
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
    title: 'Register a source',
    description:
      'Registers a document as a project source (e.g. VISION.md). A source is untrusted input: it informs, but never changes any record.',
    input: registerSourceInput,
    readOnly: false,
    execute: async (a, c) => respond(await c.command('source.register', { name: a.name, content: a.content })),
  });

  register(server, api, 'propose', {
    title: 'Propose',
    description: `Sends a batch of proposals (decision, exploration or FDR with its criteria) to the project's inbox. At most ${MAX_EXTERNAL_AGENT_PROPOSALS} proposals per batch. Proposals stay pending and a person resolves them one by one; this agent cannot resolve them.`,
    input: proposeInput,
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
