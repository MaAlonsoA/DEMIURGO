// Soporte de pruebas de la API: servidor sobre una base efímera, una persona con sesión y
// clientes con cookie + CSRF o con token de agente.

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll } from 'vitest';
import { type Entorno, usarEntorno } from '../../../core/test/soporte/entorno.ts';
import { CABECERA_CSRF, COOKIE_SESION, crearPersona } from '../../src/credenciales.ts';
import { crearServidor } from '../../src/servidor.ts';

export const CLAVE = 'clave-de-prueba-larga';

export type Cliente = {
  pedir(
    metodo: 'GET' | 'POST' | 'DELETE',
    url: string,
    cuerpo?: unknown,
    cabeceras?: Record<string, string>,
  ): Promise<LightMyRequestResponse>;
};

export type Api = {
  app: FastifyInstance;
  entorno: Entorno;
  persona: Cliente & { cookie: string; csrf: string };
  anonimo: Cliente;
  agente(token: string): Cliente;
};

export function usarApi(opciones: Parameters<typeof usarEntorno>[0] = {}): () => Api {
  const entorno = usarEntorno(opciones);
  let api: Api | undefined;
  beforeAll(async () => {
    const e = entorno();
    const app = await crearServidor({
      servicios: e.servicios,
      urlBase: e.url,
      horasSesion: 1,
      origenesPermitidos: ['http://127.0.0.1:8100'],
    });
    await crearPersona(e.servicios.db, 'ana', CLAVE);
    const login = await app.inject({ method: 'POST', url: '/api/sesion', payload: { usuario: 'ana', clave: CLAVE } });
    if (login.statusCode !== 200) throw new Error(`No se pudo iniciar sesión: ${login.body}`);
    const galleta = login.cookies.find((c) => c.name === COOKIE_SESION);
    const csrf = login.json<{ csrf: string }>().csrf;
    const cliente = (cabecerasBase: Record<string, string>, cookies: Record<string, string>): Cliente => ({
      pedir: (method, url, cuerpo, cabeceras = {}) =>
        app.inject({
          method,
          url,
          headers: { ...cabecerasBase, ...cabeceras },
          cookies,
          ...(cuerpo === undefined ? {} : { payload: cuerpo as Record<string, unknown> }),
        }),
    });
    api = {
      app,
      entorno: e,
      persona: {
        ...cliente({ [CABECERA_CSRF]: csrf }, { [COOKIE_SESION]: galleta?.value ?? '' }),
        cookie: galleta?.value ?? '',
        csrf,
      },
      anonimo: cliente({}, {}),
      agente: (token) => cliente({ authorization: `Bearer ${token}` }, {}),
    };
  });
  afterAll(async () => {
    await api?.app.close();
  });
  return () => {
    if (!api) throw new Error('La API aún no está lista.');
    return api;
  };
}
