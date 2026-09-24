// Servidor HTTP de DEMIURGO v2 (Fastify). El actor lo fija el servidor según la credencial:
// cookie de sesión → human; token Bearer de agente → agent:<nombre>:<sesión>. El cuerpo de
// una petición nunca declara actor.

import cookie from '@fastify/cookie';
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
import { HANDLERS, type Services, executeCommand } from '@demiurgo/core';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CSRF_HEADER,
  COOKIE_SESSION,
  type Credential,
  openSession,
  closeSession,
  secretFingerprint,
  resolveSession,
  resolveAgentToken,
} from './credentials.ts';
import { type Broadcaster, createBroadcaster } from './broadcaster.ts';
import { QUERIES, type QueryRoute } from './queries.ts';

export type ServerOptions = {
  services: Services;
  baseUrl: string;
  sessionHours: number;
  allowedOrigins: readonly string[];
  /** Si se indica, las peticiones con otro Host se rechazan (defensa frente a DNS rebinding). */
  allowedHosts?: readonly string[];
  secureCookie?: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    credential: Credential;
  }
}

const MUTATOR_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function actorOf(req: FastifyRequest): Actor {
  const c = req.credential;
  if (c.type === 'none') throw new DomainError('unauthenticated', 'Hace falta iniciar sesión o un token de agente.');
  return c.actor;
}

/** Comprueba la consulta en la matriz y el alcance del token de agente. */
export function requireQuery(req: FastifyRequest, queryName: QueryName, projectId?: string): Actor {
  const actor = actorOf(req);
  if (!allowedForQuery(queryName, actor.type)) {
    throw new DomainError('forbidden', `Este actor no puede usar la consulta «${queryName}».`);
  }
  checkAgentScope(req, projectId);
  return actor;
}

function checkAgentScope(req: FastifyRequest, projectId?: string): void {
  const c = req.credential;
  if (c.type === 'agent' && projectId !== undefined && c.projectId !== projectId) {
    throw new DomainError('forbidden', 'El token de este agente no da acceso a ese proyecto.');
  }
}

const commandBody = z.object({ entity_id: z.string().uuid().optional(), data: z.unknown().optional() });

export async function createServer(op: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });
  const { services } = op;
  const broadcaster: Broadcaster = createBroadcaster(op.baseUrl);
  app.addHook('onClose', async () => {
    await broadcaster.close();
  });
  await app.register(cookie);
  app.decorateRequest('credential', null as never);

  app.addHook('onRequest', async (req) => {
    if (op.allowedHosts && !op.allowedHosts.includes(req.headers.host ?? '')) {
      throw new DomainError('forbidden', 'Host no permitido.');
    }
    const auth = req.headers.authorization;
    if (auth) {
      const token = /^Bearer (.+)$/.exec(auth)?.[1] ?? '';
      req.credential = await resolveAgentToken(services.db, token);
      if (req.credential.type === 'none') throw new DomainError('unauthenticated', 'Token de agente no válido o revocado.');
      return;
    }
    const session = req.cookies[COOKIE_SESSION];
    req.credential = session ? await resolveSession(services.db, session) : { type: 'none' };
    if (req.credential.type === 'person' && MUTATOR_METHODS.has(req.method) && req.url !== '/api/session') {
      const csrf = req.headers[CSRF_HEADER];
      if (typeof csrf !== 'string' || secretFingerprint(csrf) !== req.credential.csrfHash) {
        throw new DomainError('forbidden', 'Falta el token CSRF de la sesión o no es válido.');
      }
      const origin = req.headers.origin;
      if (origin && !op.allowedOrigins.includes(origin)) throw new DomainError('forbidden', 'Origen no permitido.');
    }
  });

  app.setErrorHandler((error, _req, reply) => {
    if (isDomainError(error)) {
      return reply.status(error.httpStatus).send({ error: error.type, message: error.message, reasons: error.reasons });
    }
    const e = error as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: 'request', message: e.message ?? 'Petición no válida.', reasons: [] });
    }
    services.record.error('Error interno', { error: String(error) });
    return reply.status(500).send({ error: 'internal', message: 'Error interno del servidor.', reasons: [] });
  });

  app.get('/api/health', async () => ({ ok: true }));

  // Sesión humana. Un agente con token no puede abrir una sesión humana.
  app.post('/api/session', async (req, reply) => {
    if (req.headers.authorization) throw new DomainError('forbidden', 'Un agente no puede abrir una sesión humana.');
    const body = z.object({ username: z.string().min(1), key: z.string().min(1) }).parse(req.body);
    const s = await openSession(services.db, body.username, body.key, op.sessionHours);
    reply.setCookie(COOKIE_SESSION, s.token, {
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
    if (c.type === 'none') throw new DomainError('unauthenticated', 'No hay sesión.');
    return { actor: c.actor, type: c.type };
  });

  app.delete('/api/session', async (req, reply) => {
    const token = req.cookies[COOKIE_SESSION];
    if (token) await closeSession(services.db, token);
    reply.clearCookie(COOKIE_SESSION, { path: '/' });
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
    if (!isCommand(command)) throw new DomainError('not_found', `No existe el comando «${command}».`);
    checkAgentScope(req, projectId);
    // Cualquier otro campo del cuerpo (por ejemplo «actor») se ignora: el actor sale de la credencial.
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

  // Contrato de cada comando para los clientes (frontend y agentes): quién puede ejecutarlo, si es
  // decisivo y el JSON Schema de sus datos, generado desde el mismo esquema Zod que los valida.
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

  // Flujo SSE incremental del diario: con Last-Event-ID solo llegan los eventos posteriores.
  app.get('/api/projects/:projectId/events/stream', async (req, reply: FastifyReply) => {
    const { projectId } = req.params as { projectId: string };
    requireQuery(req, 'query.events', projectId);
    const header = req.headers['last-event-id'];
    let last = Number(typeof header === 'string' && /^\d+$/.test(header) ? header : '0');
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
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
    const validTo = await broadcaster.subscribe(projectId, () => {
      void send().catch(() => undefined);
    });
    const heartbeat = setInterval(() => raw.write(': latido\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      validTo();
    });
    await send();
  });

  for (const c of QUERIES) registerQuery(app, services, c);
  return app;
}

function registerQuery(app: FastifyInstance, services: Services, c: QueryRoute): void {
  app.get(c.path, async (req) => {
    const params = req.params as Record<string, string>;
    requireQuery(req, c.queryName, params.projectId);
    return c.respond({ services, params, query: req.query as Record<string, string>, credential: req.credential });
  });
}
