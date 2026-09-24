// API test support: a server on an ephemeral database, a person with a session and
// clients with a cookie + CSRF or with an agent token.

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll } from 'vitest';
import { type Environment, useEnvironment } from '../../../core/test/support/env.ts';
import { CSRF_HEADER, SESSION_COOKIE, createPerson } from '../../src/credentials.ts';
import { createServer } from '../../src/server.ts';

export const PASSWORD = 'long-test-password';

export type Client = {
  request(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<LightMyRequestResponse>;
};

export type Api = {
  app: FastifyInstance;
  environment: Environment;
  person: Client & { cookie: string; csrf: string };
  anonymous: Client;
  agent(token: string): Client;
};

export function useApi(options: Parameters<typeof useEnvironment>[0] = {}): () => Api {
  const environment = useEnvironment(options);
  let api: Api | undefined;
  beforeAll(async () => {
    const e = environment();
    const app = await createServer({
      services: e.services,
      databaseUrl: e.url,
      sessionHours: 1,
      allowedOrigins: ['http://127.0.0.1:8100'],
    });
    await createPerson(e.services.db, 'ana', PASSWORD);
    const login = await app.inject({ method: 'POST', url: '/api/session', payload: { username: 'ana', password: PASSWORD } });
    if (login.statusCode !== 200) throw new Error(`Could not log in: ${login.body}`);
    const cookie = login.cookies.find((c) => c.name === SESSION_COOKIE);
    const csrf = login.json<{ csrf: string }>().csrf;
    const client = (baseHeaders: Record<string, string>, cookies: Record<string, string>): Client => ({
      request: (method, url, body, headers = {}) =>
        app.inject({
          method,
          url,
          headers: { ...baseHeaders, ...headers },
          cookies,
          ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
        }),
    });
    api = {
      app,
      environment: e,
      person: {
        ...client({ [CSRF_HEADER]: csrf }, { [SESSION_COOKIE]: cookie?.value ?? '' }),
        cookie: cookie?.value ?? '',
        csrf,
      },
      anonymous: client({}, {}),
      agent: (token) => client({ authorization: `Bearer ${token}` }, {}),
    };
  });
  afterAll(async () => {
    await api?.app.close();
  });
  return () => {
    if (!api) throw new Error('The API is not ready yet.');
    return api;
  };
}
