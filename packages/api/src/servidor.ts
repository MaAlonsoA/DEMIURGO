// Servidor HTTP de DEMIURGO v2 (Fastify). El actor lo fija el servidor según la credencial:
// cookie de sesión → human; token Bearer de agente → agent:<nombre>:<sesión>. El cuerpo de
// una petición nunca declara actor.

import cookie from '@fastify/cookie';
import {
  type Actor,
  CAPACIDADES,
  ErrorDominio,
  type NombreConsulta,
  TRANSICIONES,
  esComando,
  esErrorDominio,
  permitidoConsulta,
} from '@demiurgo/domain';
import { MANEJADORES, type Servicios, ejecutarComando } from '@demiurgo/core';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CABECERA_CSRF,
  COOKIE_SESION,
  type Credencial,
  abrirSesion,
  cerrarSesion,
  huellaSecreto,
  resolverSesion,
  resolverTokenAgente,
} from './credenciales.ts';
import { type Difusor, crearDifusor } from './difusor.ts';
import { CONSULTAS, type RutaConsulta } from './consultas.ts';

export type OpcionesServidor = {
  servicios: Servicios;
  urlBase: string;
  horasSesion: number;
  origenesPermitidos: readonly string[];
  /** Si se indica, las peticiones con otro Host se rechazan (defensa frente a DNS rebinding). */
  hostsPermitidos?: readonly string[];
  cookieSegura?: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    credencial: Credencial;
  }
}

const METODOS_MUTADORES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function actorDe(req: FastifyRequest): Actor {
  const c = req.credencial;
  if (c.tipo === 'ninguna') throw new ErrorDominio('no_autenticado', 'Hace falta iniciar sesión o un token de agente.');
  return c.actor;
}

/** Comprueba la consulta en la matriz y el alcance del token de agente. */
export function requerirConsulta(req: FastifyRequest, consulta: NombreConsulta, proyectoId?: string): Actor {
  const actor = actorDe(req);
  if (!permitidoConsulta(consulta, actor.tipo)) {
    throw new ErrorDominio('prohibido', `Este actor no puede usar la consulta «${consulta}».`);
  }
  comprobarAlcanceAgente(req, proyectoId);
  return actor;
}

function comprobarAlcanceAgente(req: FastifyRequest, proyectoId?: string): void {
  const c = req.credencial;
  if (c.tipo === 'agente' && proyectoId !== undefined && c.proyectoId !== proyectoId) {
    throw new ErrorDominio('prohibido', 'El token de este agente no da acceso a ese proyecto.');
  }
}

const cuerpoComando = z.object({ entidad_id: z.string().uuid().optional(), datos: z.unknown().optional() });

export async function crearServidor(op: OpcionesServidor): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });
  const { servicios } = op;
  const difusor: Difusor = crearDifusor(op.urlBase);
  app.addHook('onClose', async () => {
    await difusor.cerrar();
  });
  await app.register(cookie);
  app.decorateRequest('credencial', null as never);

  app.addHook('onRequest', async (req) => {
    if (op.hostsPermitidos && !op.hostsPermitidos.includes(req.headers.host ?? '')) {
      throw new ErrorDominio('prohibido', 'Host no permitido.');
    }
    const auth = req.headers.authorization;
    if (auth) {
      const token = /^Bearer (.+)$/.exec(auth)?.[1] ?? '';
      req.credencial = await resolverTokenAgente(servicios.db, token);
      if (req.credencial.tipo === 'ninguna') throw new ErrorDominio('no_autenticado', 'Token de agente no válido o revocado.');
      return;
    }
    const sesion = req.cookies[COOKIE_SESION];
    req.credencial = sesion ? await resolverSesion(servicios.db, sesion) : { tipo: 'ninguna' };
    if (req.credencial.tipo === 'persona' && METODOS_MUTADORES.has(req.method) && req.url !== '/api/sesion') {
      const csrf = req.headers[CABECERA_CSRF];
      if (typeof csrf !== 'string' || huellaSecreto(csrf) !== req.credencial.csrfHash) {
        throw new ErrorDominio('prohibido', 'Falta el token CSRF de la sesión o no es válido.');
      }
      const origen = req.headers.origin;
      if (origen && !op.origenesPermitidos.includes(origen)) throw new ErrorDominio('prohibido', 'Origen no permitido.');
    }
  });

  app.setErrorHandler((error, _req, reply) => {
    if (esErrorDominio(error)) {
      return reply.status(error.estadoHttp).send({ error: error.tipo, mensaje: error.message, motivos: error.motivos });
    }
    const e = error as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: 'peticion', mensaje: e.message ?? 'Petición no válida.', motivos: [] });
    }
    servicios.registro.error('Error interno', { error: String(error) });
    return reply.status(500).send({ error: 'interno', mensaje: 'Error interno del servidor.', motivos: [] });
  });

  app.get('/api/salud', async () => ({ ok: true }));

  // Sesión humana. Un agente con token no puede abrir una sesión humana.
  app.post('/api/sesion', async (req, reply) => {
    if (req.headers.authorization) throw new ErrorDominio('prohibido', 'Un agente no puede abrir una sesión humana.');
    const cuerpo = z.object({ usuario: z.string().min(1), clave: z.string().min(1) }).parse(req.body);
    const s = await abrirSesion(servicios.db, cuerpo.usuario, cuerpo.clave, op.horasSesion);
    reply.setCookie(COOKIE_SESION, s.token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: op.cookieSegura ?? false,
      expires: s.expira,
    });
    return { persona: s.persona, csrf: s.csrf, expira: s.expira.toISOString() };
  });

  app.get('/api/sesion', async (req) => {
    const c = req.credencial;
    if (c.tipo === 'ninguna') throw new ErrorDominio('no_autenticado', 'No hay sesión.');
    return { actor: c.actor, tipo: c.tipo };
  });

  app.delete('/api/sesion', async (req, reply) => {
    const token = req.cookies[COOKIE_SESION];
    if (token) await cerrarSesion(servicios.db, token);
    reply.clearCookie(COOKIE_SESION, { path: '/' });
    return { ok: true };
  });

  app.post('/api/proyectos', async (req) => {
    const actor = actorDe(req);
    const cuerpo = z
      .object({ nombre: z.unknown() })
      .passthrough()
      .parse(req.body ?? {});
    const r = await ejecutarComando(servicios, { comando: 'project.create', actor, datos: { nombre: cuerpo.nombre } });
    return { proyecto_id: r.proyectoId, estado: r.estado, seq: r.seq };
  });

  app.post('/api/proyectos/:proyectoId/comandos/:comando', async (req) => {
    const actor = actorDe(req);
    const { proyectoId, comando } = req.params as { proyectoId: string; comando: string };
    if (!esComando(comando)) throw new ErrorDominio('no_encontrado', `No existe el comando «${comando}».`);
    comprobarAlcanceAgente(req, proyectoId);
    // Cualquier otro campo del cuerpo (por ejemplo «actor») se ignora: el actor sale de la credencial.
    const cuerpo = cuerpoComando.parse(req.body ?? {});
    const r = await ejecutarComando(servicios, {
      comando,
      actor,
      proyectoId,
      ...(cuerpo.entidad_id ? { entidadId: cuerpo.entidad_id } : {}),
      datos: cuerpo.datos ?? {},
    });
    return { entidad: r.entidad, entidad_id: r.entidadId, estado: r.estado, seq: r.seq, resultado: r.resultado ?? null };
  });

  app.get('/api/tablas', async (req) => {
    requerirConsulta(req, 'query.tables');
    return { capacidades: CAPACIDADES, transiciones: TRANSICIONES };
  });

  // Contrato de cada comando para los clientes (frontend y agentes): quién puede ejecutarlo, si es
  // decisivo y el JSON Schema de sus datos, generado desde el mismo esquema Zod que los valida.
  app.get('/api/comandos', async (req) => {
    requerirConsulta(req, 'query.tables');
    return Object.fromEntries(
      Object.entries(CAPACIDADES.comandos).map(([nombre, c]) => {
        const m = MANEJADORES[nombre as keyof typeof MANEJADORES];
        const esquema = m ? z.toJSONSchema(m.datos, { io: 'input', unrepresentable: 'any' }) : null;
        return [nombre, { ...c, implementado: Boolean(m), datos: esquema }];
      }),
    );
  });

  // Flujo SSE incremental del diario: con Last-Event-ID solo llegan los eventos posteriores.
  app.get('/api/proyectos/:proyectoId/eventos/flujo', async (req, reply: FastifyReply) => {
    const { proyectoId } = req.params as { proyectoId: string };
    requerirConsulta(req, 'query.events', proyectoId);
    const cabecera = req.headers['last-event-id'];
    let ultimo = Number(typeof cabecera === 'string' && /^\d+$/.test(cabecera) ? cabecera : '0');
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    let enviando = false;
    let otraVez = false;
    const enviar = async (): Promise<void> => {
      if (enviando) {
        otraVez = true;
        return;
      }
      enviando = true;
      try {
        do {
          otraVez = false;
          const filas = await servicios.db
            .selectFrom('events')
            .selectAll()
            .where('project_id', '=', proyectoId)
            .where('id', '>', String(ultimo))
            .orderBy('id')
            .limit(500)
            .execute();
          for (const f of filas) {
            ultimo = Number(f.id);
            raw.write(`id: ${f.id}\nevent: ${f.command}\ndata: ${JSON.stringify(f)}\n\n`);
          }
          if (filas.length === 500) otraVez = true;
        } while (otraVez);
      } finally {
        enviando = false;
      }
    };
    const baja = await difusor.suscribir(proyectoId, () => {
      void enviar().catch(() => undefined);
    });
    const latido = setInterval(() => raw.write(': latido\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(latido);
      baja();
    });
    await enviar();
  });

  for (const c of CONSULTAS) registrarConsulta(app, servicios, c);
  return app;
}

function registrarConsulta(app: FastifyInstance, servicios: Servicios, c: RutaConsulta): void {
  app.get(c.ruta, async (req) => {
    const params = req.params as Record<string, string>;
    requerirConsulta(req, c.consulta, params.proyectoId);
    return c.responder({ servicios, params, query: req.query as Record<string, string>, credencial: req.credencial });
  });
}
