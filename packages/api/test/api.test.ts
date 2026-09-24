import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { COOKIE_SESION } from '../src/credenciales.ts';
import { crearServidor } from '../src/servidor.ts';
import { CLAVE, usarApi } from './soporte/api.ts';

const api = usarApi();

async function crearProyecto(nombre: string): Promise<string> {
  const r = await api().persona.pedir('POST', '/api/proyectos', { nombre });
  expect(r.statusCode).toBe(200);
  return r.json<{ proyecto_id: string }>().proyecto_id;
}

async function actorDelUltimoEvento(proyectoId: string): Promise<string> {
  const e = await api()
    .entorno.servicios.db.selectFrom('events')
    .select('actor')
    .where('project_id', '=', proyectoId)
    .orderBy('seq', 'desc')
    .executeTakeFirstOrThrow();
  return e.actor;
}

describe('API: actor, sesión y errores', () => {
  it('AC-ESQ-001-13 el actor sale de la credencial y un actor declarado en el cuerpo se ignora', async () => {
    const r = await api().persona.pedir('POST', '/api/proyectos', { nombre: 'Actor', actor: 'system:suplantador@1' });
    expect(r.statusCode).toBe(200);
    const proyectoId = r.json<{ proyecto_id: string }>().proyecto_id;
    expect(await actorDelUltimoEvento(proyectoId)).toBe('human:ana');
    const c = await api().persona.pedir('POST', `/api/proyectos/${proyectoId}/comandos/run.request`, {
      actor: 'agent:run:falso',
      datos: { accion: 'eco', alcance: { tipo: 'proyecto' }, entrada: { texto: 'x' } },
    });
    expect(c.statusCode).toBe(200);
    expect(await actorDelUltimoEvento(proyectoId)).toBe('human:ana');
  });

  it('AC-ESQ-001-13 sin credencial no hay actor: 401', async () => {
    const r = await api().anonimo.pedir('POST', '/api/proyectos', { nombre: 'Anónimo' });
    expect(r.statusCode).toBe(401);
    expect(r.json<{ mensaje: string }>().mensaje).toMatch(/iniciar sesión/);
  });

  it('AC-DIS-001-15 la cookie es httpOnly y SameSite=Strict y las mutaciones exigen el token CSRF', async () => {
    const login = await api().app.inject({ method: 'POST', url: '/api/sesion', payload: { usuario: 'ana', clave: CLAVE } });
    const galleta = login.cookies.find((c) => c.name === COOKIE_SESION);
    expect(galleta).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    const sinCsrf = await api().app.inject({
      method: 'POST',
      url: '/api/proyectos',
      cookies: { [COOKIE_SESION]: galleta?.value ?? '' },
      payload: { nombre: 'Sin CSRF' },
    });
    expect(sinCsrf.statusCode).toBe(403);
    expect(sinCsrf.json<{ mensaje: string }>().mensaje).toMatch(/CSRF/);
    const mal = await api().persona.pedir('POST', '/api/proyectos', { nombre: 'Origen' }, { origin: 'http://evil.example' });
    expect(mal.statusCode).toBe(403);
  });

  it('AC-ESQ-001-02 por HTTP un comando no permitido devuelve 403 con el motivo', async () => {
    const proyectoId = await crearProyecto('Prohibido');
    const r = await api().persona.pedir('POST', `/api/proyectos/${proyectoId}/comandos/run.begin`, {
      entidad_id: '00000000-0000-7000-8000-000000000001',
      datos: {},
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: 'prohibido' });
  });

  it('AC-ESQ-001-03 por HTTP una transición inexistente devuelve 409', async () => {
    const proyectoId = await crearProyecto('Transición');
    const archivar = () =>
      api().persona.pedir('POST', `/api/proyectos/${proyectoId}/comandos/project.archive`, { entidad_id: proyectoId, datos: {} });
    expect((await archivar()).statusCode).toBe(200);
    const r = await archivar();
    expect(r.statusCode).toBe(409);
    expect(r.json<{ mensaje: string }>().mensaje).toMatch(/Archivado/);
  });

  it('un comando desconocido da 404 y unos datos inválidos 422', async () => {
    const proyectoId = await crearProyecto('Errores');
    expect((await api().persona.pedir('POST', `/api/proyectos/${proyectoId}/comandos/no.existe`, {})).statusCode).toBe(404);
    const r = await api().persona.pedir('POST', `/api/proyectos/${proyectoId}/comandos/run.request`, {
      datos: { accion: 'nada' },
    });
    expect(r.statusCode).toBe(422);
  });

  it('las tablas se sirven como datos para la UI', async () => {
    const r = await api().persona.pedir('GET', '/api/tablas');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty('capacidades.comandos.project\\.create');
  });
});

describe('API: flujo SSE incremental', () => {
  it('AC-ESQ-001-14 con Last-Event-ID llegan solo los eventos posteriores', async () => {
    const { entorno, persona } = api();
    const proyectoId = await crearProyecto('SSE');
    for (const texto of ['a', 'b']) {
      await persona.pedir('POST', `/api/proyectos/${proyectoId}/comandos/run.request`, {
        datos: { accion: 'eco', alcance: { tipo: 'proyecto' }, entrada: { texto } },
      });
    }
    const todos = await entorno.servicios.db
      .selectFrom('events')
      .select('id')
      .where('project_id', '=', proyectoId)
      .orderBy('id')
      .execute();
    const corte = todos[2]?.id ?? '0';
    const posteriores = todos.filter((e) => BigInt(e.id) > BigInt(corte)).map((e) => e.id);

    // Servidor real escuchando en un puerto libre: inject no sirve para flujos abiertos.
    const app = await crearServidor({
      servicios: entorno.servicios,
      urlBase: entorno.url,
      horasSesion: 1,
      origenesPermitidos: [],
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    try {
      const recibidos = await new Promise<string[]>((resolver, rechazar) => {
        const ids: string[] = [];
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: `/api/proyectos/${proyectoId}/eventos/flujo`,
            headers: { cookie: `${COOKIE_SESION}=${persona.cookie}`, 'last-event-id': corte },
          },
          (res) => {
            let buffer = '';
            const alRecibir = async (d: Buffer): Promise<void> => {
              buffer += d.toString();
              for (const m of buffer.matchAll(/^id: (\d+)$/gm)) if (!ids.includes(m[1] ?? '')) ids.push(m[1] ?? '');
              if (ids.length === posteriores.length) {
                // Un evento nuevo llega también por el flujo abierto.
                await persona.pedir('POST', '/api/proyectos', { nombre: 'Otro proyecto' });
                await persona.pedir('POST', `/api/proyectos/${proyectoId}/comandos/run.request`, {
                  datos: { accion: 'eco', alcance: { tipo: 'proyecto' }, entrada: { texto: 'c' } },
                });
              }
              if (ids.length >= posteriores.length + 2) {
                req.destroy();
                resolver(ids);
              }
            };
            res.on('data', (d: Buffer) => {
              alRecibir(d).catch(rechazar);
            });
          },
        );
        req.on('error', (e) => (ids.length >= posteriores.length + 2 ? undefined : rechazar(e)));
        setTimeout(() => rechazar(new Error(`Tiempo agotado; recibidos ${ids.join(',')}`)), 20_000);
        req.end();
      });
      expect(recibidos.slice(0, posteriores.length)).toEqual(posteriores);
      expect(recibidos.every((id) => BigInt(id) > BigInt(corte))).toBe(true);
    } finally {
      await app.close();
    }
  });
});
