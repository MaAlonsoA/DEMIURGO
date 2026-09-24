// Credenciales: claves de personas (scrypt), sesiones con cookie httpOnly + CSRF y tokens de
// agentes externos. En la base solo se guardan huellas, nunca los secretos.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { type Actor, DomainError, externalAgent, human } from '@demiurgo/domain';
import type { Db } from '@demiurgo/core';

const scrypt = promisify(scryptCb) as (
  key: string,
  salt: Buffer,
  length: number,
  op: { N: number; r: number; p: number },
) => Promise<Buffer>;

export const COOKIE_SESSION = 'demiurgo_session';
export const CSRF_HEADER = 'x-demiurgo-csrf';
export const AGENT_TOKEN_PREFIX = 'dmg_agent_';

const PARAMS = { N: 16_384, r: 8, p: 1 };

export async function hashPassword(key: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(key, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64url')}$${h.toString('base64url')}`;
}

export async function verifyPassword(key: string, saved: string): Promise<boolean> {
  const [alg, n, r, p, salt, h] = saved.split('$');
  if (alg !== 'scrypt' || !salt || !h) return false;
  const expected = Buffer.from(h, 'base64url');
  const computed = await scrypt(key, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export const secretFingerprint = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
export const newSecret = (prefix = ''): string => `${prefix}${randomBytes(32).toString('base64url')}`;

export async function createPerson(db: Db, username: string, key: string): Promise<string> {
  if (key.length < 12) throw new DomainError('validation', 'La clave debe tener al menos 12 caracteres.');
  const { id } = await db
    .insertInto('humans')
    .values({ username: username, password_hash: await hashPassword(key) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

export type NewSession = { token: string; csrf: string; expires: Date; person: string };

export async function openSession(db: Db, username: string, key: string, hours: number): Promise<NewSession> {
  const person = await db.selectFrom('humans').selectAll().where('username', '=', username).executeTakeFirst();
  const ok = person
    ? await verifyPassword(key, person.password_hash)
    : await verifyPassword(key, 'scrypt$16384$8$1$AAAA$AAAA');
  if (!person || !ok) throw new DomainError('unauthenticated', 'Usuario o clave incorrectos.');
  const token = newSecret();
  const csrf = newSecret();
  const expires = new Date(Date.now() + hours * 3_600_000);
  await db
    .insertInto('sessions')
    .values({ human_id: person.id, token_hash: secretFingerprint(token), csrf_hash: secretFingerprint(csrf), expires_at: expires })
    .execute();
  return { token, csrf, expires, person: person.username };
}

export async function closeSession(db: Db, token: string): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date() })
    .where('token_hash', '=', secretFingerprint(token))
    .where('revoked_at', 'is', null)
    .execute();
}

export type Credential =
  | { type: 'person'; actor: Actor; csrfHash: string }
  | { type: 'agent'; actor: Actor; projectId: string }
  | { type: 'none' };

export async function resolveSession(db: Db, token: string): Promise<Credential> {
  const row = await db
    .selectFrom('sessions')
    .innerJoin('humans', 'humans.id', 'sessions.human_id')
    .select(['humans.username', 'sessions.csrf_hash', 'sessions.expires_at', 'sessions.revoked_at'])
    .where('sessions.token_hash', '=', secretFingerprint(token))
    .executeTakeFirst();
  if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) return { type: 'none' };
  return { type: 'person', actor: human(row.username), csrfHash: row.csrf_hash };
}

export async function resolveAgentToken(db: Db, token: string): Promise<Credential> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX)) return { type: 'none' };
  const row = await db
    .selectFrom('agent_tokens')
    .select(['id', 'name', 'project_id', 'state'])
    .where('token_hash', '=', secretFingerprint(token))
    .executeTakeFirst();
  if (!row || row.state !== 'active') return { type: 'none' };
  return { type: 'agent', actor: externalAgent(row.name, row.id), projectId: row.project_id };
}
