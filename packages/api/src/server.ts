// DEMIURGO v2 HTTP server (Fastify). The actor is set by the server based on the credential:
// session cookie → human; agent Bearer token → agent:<name>:<session>. The request body never
// declares an actor.

import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import {
  type Actor,
  CAPABILITIES,
  DomainError,
  type QueryName,
  TRANSITIONS,
  isCommand,
  isDomainError,
  allowedForQuery,
} from '@demiurgo/domain';
import { HANDLERS, type Services, executeCommand, runProgress } from '@demiurgo/core';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CSRF_HEADER,
  SESSION_COOKIE,
  type Credential,
  openSession,
  closeSession,
  secretFingerprint,
  sessionCsrf,
  resolveSession,
  resolveAgentToken,
} from './credentials.ts';
import { type Broadcaster, createBroadcaster } from './broadcaster.ts';
import { type DevTools, registerDevRoutes } from './dev-tools.ts';
import { registerModelRoutes } from './models.ts';
import { QUERIES, type QueryRoute } from './queries.ts';

export type ServerOptions = {
  services: Services;
  databaseUrl: string;
  sessionHours: number;
  allowedOrigins: readonly string[];
  /** If set, requests with another Host are rejected (defense against DNS rebinding). */
  allowedHosts?: readonly string[];
  secureCookie?: boolean;
  /** Folder with the web build (packages/web/dist): served from the same origin as the API. */
  webRoot?: string;
  /** Shared with the runtime, which closes it while the core restarts. By default, its own. */
  broadcaster?: Broadcaster;
  /** Only with DEMIURGO_DEV_TOOLS=1: snapshots and reset under /api/dev. */
  devTools?: DevTools;
};

declare module 'fastify' {
  interface FastifyRequest {
    credential: Credential;
  }
}

const MUTATOR_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function actorOf(req: FastifyRequest): Actor {
  const c = req.credential;
  if (c.type === 'none') throw new DomainError('unauthenticated', 'A session or an agent token is required.');
  return c.actor;
}

/** Checks the query against the capability matrix and the agent token's scope. */
export function requireQuery(req: FastifyRequest, queryName: QueryName, projectId?: string): Actor {
  const actor = actorOf(req);
  if (!allowedForQuery(queryName, actor.type)) {
    throw new DomainError('forbidden', `This actor cannot use the "${queryName}" query.`);
  }
  checkAgentScope(req, projectId);
  return actor;
}

function checkAgentScope(req: FastifyRequest, projectId?: string): void {
  const c = req.credential;
  if (c.type === 'agent' && projectId !== undefined && c.projectId !== projectId) {
    throw new DomainError('forbidden', 'This agent token does not grant access to that project.');
  }
}

const commandBody = z.object({ entity_id: z.string().uuid().optional(), data: z.unknown().optional() });

export async function createServer(op: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });
  const { services } = op;
  const broadcaster: Broadcaster = op.broadcaster ?? createBroadcaster(op.databaseUrl);
  app.addHook('onClose', async () => {
    await broadcaster.close();
  });
  await app.register(cookie);
  app.decorateRequest('credential', null as never);

  app.addHook('onRequest', async (req) => {
    // While the dev tools restart the core, requests wait for the new one.
    if (op.devTools) await op.devTools.ready();
    if (op.allowedHosts && !op.allowedHosts.includes(req.headers.host ?? '')) {
      throw new DomainError('forbidden', 'Host not allowed.');
    }
    const auth = req.headers.authorization;
    if (auth) {
      const token = /^Bearer (.+)$/.exec(auth)?.[1] ?? '';
      req.credential = await resolveAgentToken(services.db, token);
      if (req.credential.type === 'none') throw new DomainError('unauthenticated', 'Invalid or revoked agent token.');
      return;
    }
    const session = req.cookies[SESSION_COOKIE];
    req.credential = session ? await resolveSession(services.db, session) : { type: 'none' };
    if (req.credential.type === 'person' && MUTATOR_METHODS.has(req.method) && req.url !== '/api/session') {
      const csrf = req.headers[CSRF_HEADER];
      if (typeof csrf !== 'string' || secretFingerprint(csrf) !== req.credential.csrfHash) {
        throw new DomainError('forbidden', 'The session CSRF token is missing or invalid.');
      }
      const origin = req.headers.origin;
      if (origin && !op.allowedOrigins.includes(origin)) throw new DomainError('forbidden', 'Origin not allowed.');
    }
  });

  app.setErrorHandler((error, _req, reply) => {
    if (isDomainError(error)) {
      return reply.status(error.httpStatus).send({ error: error.type, message: error.message, reasons: error.reasons });
    }
    const e = error as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: 'request', message: e.message ?? 'Invalid request.', reasons: [] });
    }
    services.logger.error('Internal error', { error: String(error) });
    return reply.status(500).send({ error: 'internal', message: 'Internal server error.', reasons: [] });
  });

  app.get('/api/health', async () => ({ ok: true }));

  // Human session. An agent with a token cannot open a human session.
  app.post('/api/session', async (req, reply) => {
    if (req.headers.authorization) throw new DomainError('forbidden', 'An agent cannot open a human session.');
    const body = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
    const s = await openSession(services.db, body.username, body.password, op.sessionHours);
    reply.setCookie(SESSION_COOKIE, s.token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: op.secureCookie ?? false,
      expires: s.expires,
    });
    return { person: s.person, csrf: s.csrf, expires: s.expires.toISOString() };
  });

  app.get('/api/session', async (req) => {
    const c = req.credential;
    if (c.type === 'none') throw new DomainError('unauthenticated', 'No session.');
    // The CSRF token is derived from the cookie's token: it is only returned if it is the one of this session.
    const token = req.cookies[SESSION_COOKIE];
    const csrf = c.type === 'person' && token && secretFingerprint(sessionCsrf(token)) === c.csrfHash ? sessionCsrf(token) : null;
    return { actor: c.actor, type: c.type, csrf, ...(op.devTools ? { dev_tools: true } : {}) };
  });

  app.delete('/api/session', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await closeSession(services.db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/projects', async (req) => {
    const actor = actorOf(req);
    const body = z
      .object({ name: z.unknown() })
      .passthrough()
      .parse(req.body ?? {});
    const r = await executeCommand(services, { command: 'project.create', actor, data: { name: body.name } });
    return { project_id: r.projectId, state: r.state, seq: r.seq };
  });

  app.post('/api/projects/:projectId/commands/:command', async (req) => {
    const actor = actorOf(req);
    const { projectId, command } = req.params as { projectId: string; command: string };
    if (!isCommand(command)) throw new DomainError('not_found', `The command "${command}" does not exist.`);
    checkAgentScope(req, projectId);
    // Any other field in the body (e.g. "actor") is ignored: the actor comes from the credential.
    const body = commandBody.parse(req.body ?? {});
    const r = await executeCommand(services, {
      command,
      actor,
      projectId,
      ...(body.entity_id ? { entityId: body.entity_id } : {}),
      data: body.data ?? {},
    });
    return { entity: r.entity, entity_id: r.entityId, state: r.state, seq: r.seq, result: r.result ?? null };
  });

  app.get('/api/tables', async (req) => {
    requireQuery(req, 'query.tables');
    return { capabilities: CAPABILITIES, transitions: TRANSITIONS };
  });

  // Contract of each command for clients (frontend and agents): who can run it, whether it is
  // decisive, and the JSON Schema of its data, generated from the same Zod schema that validates it.
  app.get('/api/commands', async (req) => {
    requireQuery(req, 'query.tables');
    return Object.fromEntries(
      Object.entries(CAPABILITIES.commands).map(([name, c]) => {
        const m = HANDLERS[name as keyof typeof HANDLERS];
        const schema = m ? z.toJSONSchema(m.data, { io: 'input', unrepresentable: 'any' }) : null;
        return [name, { ...c, implemented: Boolean(m), data: schema }];
      }),
    );
  });

  // Incremental SSE stream of the event log: with Last-Event-ID only later events arrive.
  // With ?from=latest (and no Last-Event-ID) it starts now: it announces the latest event with a
  // "ready" event, whose id the browser sends back when it reconnects.
  app.get('/api/projects/:projectId/events/stream', async (req, reply: FastifyReply) => {
    const { projectId } = req.params as { projectId: string };
    requireQuery(req, 'query.events', projectId);
    const header = req.headers['last-event-id'];
    const fromLatest = typeof header !== 'string' && (req.query as { from?: string }).from === 'latest';
    let last = Number(typeof header === 'string' && /^\d+$/.test(header) ? header : '0');
    if (fromLatest) {
      const newest = await services.db
        .selectFrom('events')
        .select('id')
        .where('project_id', '=', projectId)
        .orderBy('id', 'desc')
        .executeTakeFirst();
      last = Number(newest?.id ?? '0');
    }
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    if (fromLatest) raw.write(`id: ${last}\nevent: ready\ndata: ${JSON.stringify({ latest: String(last) })}\n\n`);
    let sending = false;
    let again = false;
    const send = async (): Promise<void> => {
      if (sending) {
        again = true;
        return;
      }
      sending = true;
      try {
        do {
          again = false;
          const rows = await services.db
            .selectFrom('events')
            .selectAll()
            .where('project_id', '=', projectId)
            .where('id', '>', String(last))
            .orderBy('id')
            .limit(500)
            .execute();
          for (const f of rows) {
            last = Number(f.id);
            raw.write(`id: ${f.id}\nevent: ${f.command}\ndata: ${JSON.stringify(f)}\n\n`);
          }
          if (rows.length === 500) again = true;
        } while (again);
      } finally {
        sending = false;
      }
    };
    // Progress of a run: a summary of its current call, without an id (it is not an event of the log).
    const progress = async (runId: string): Promise<void> => {
      const p = await runProgress(services.db, runId);
      if (p) raw.write(`event: run.progress\ndata: ${JSON.stringify(p)}\n\n`);
    };
    const unsubscribe = await broadcaster.subscribe(projectId, (n) => {
      if (n.progress) void progress(n.progress).catch(() => undefined);
      else void send().catch(() => undefined);
    });
    const heartbeat = setInterval(() => raw.write(': heartbeat\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    await send();
  });

  for (const c of QUERIES) registerQuery(app, services, c);
  registerModelRoutes(app, { services, actorOf, requireQuery });
  if (op.devTools) registerDevRoutes(app, op.devTools);
  if (op.webRoot) await serveWeb(app, op.webRoot);
  app.setNotFoundHandler((req, reply) => {
    // Outside /api, a GET is a route of the web app: it gets index.html and the app resolves it.
    if (op.webRoot && req.method === 'GET' && !req.url.startsWith('/api')) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.status(404).send({ error: 'not_found', message: 'That route does not exist.', reasons: [] });
  });
  return app;
}

async function serveWeb(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, {
    root,
    cacheControl: false,
    setHeaders(reply, path) {
      // Vite fingerprints what goes in assets/: it can be cached forever. The rest is revalidated.
      reply.header('cache-control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
}

function registerQuery(app: FastifyInstance, services: Services, c: QueryRoute): void {
  app.get(c.path, async (req) => {
    const params = req.params as Record<string, string>;
    requireQuery(req, c.queryName, params.projectId);
    return c.respond({ services, params, query: req.query as Record<string, string>, credential: req.credential });
  });
}
