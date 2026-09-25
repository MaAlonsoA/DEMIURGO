// Credentials: person passwords (scrypt), sessions with an httpOnly cookie + CSRF, and external
// agent tokens. The database stores only fingerprints, never the secrets.

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

export const SESSION_COOKIE = 'demiurgo_session';
export const CSRF_HEADER = 'x-demiurgo-csrf';
export const AGENT_TOKEN_PREFIX = 'dmg_agent_';

const PARAMS = { N: 16_384, r: 8, p: 1 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(password, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64url')}$${h.toString('base64url')}`;
}

export async function verifyPassword(password: string, saved: string): Promise<boolean> {
  const [alg, n, r, p, salt, h] = saved.split('$');
  if (alg !== 'scrypt' || !salt || !h) return false;
  const expected = Buffer.from(h, 'base64url');
  const computed = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export const secretFingerprint = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
export const newSecret = (prefix = ''): string => `${prefix}${randomBytes(32).toString('base64url')}`;

/**
 * CSRF token of a session, derived from its secret token: only whoever holds the httpOnly cookie
 * can obtain it (from the same origin, with `GET /api/session`), so a reloaded page can still write.
 * The database keeps only its fingerprint.
 */
export const sessionCsrf = (token: string): string =>
  createHash('sha256').update(`demiurgo-csrf:${token}`, 'utf8').digest('base64url');

export async function createPerson(db: Db, username: string, password: string): Promise<string> {
  if (password.length < 12) throw new DomainError('validation', 'The password must be at least 12 characters.');
  const { id } = await db
    .insertInto('humans')
    .values({ username: username, password_hash: await hashPassword(password) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

export type NewSession = { token: string; csrf: string; expires: Date; person: string };

/** The person whose password this is; the same answer for an unknown name or a wrong password. */
export async function verifyPerson(db: Db, username: string, password: string) {
  const person = await db.selectFrom('humans').selectAll().where('username', '=', username).executeTakeFirst();
  const ok = person
    ? await verifyPassword(password, person.password_hash)
    : await verifyPassword(password, 'scrypt$16384$8$1$AAAA$AAAA');
  if (!person || !ok) throw new DomainError('unauthenticated', 'Incorrect username or password.');
  return person;
}

export async function openSession(db: Db, username: string, password: string, hours: number): Promise<NewSession> {
  const person = await verifyPerson(db, username, password);
  const token = newSecret();
  const csrf = sessionCsrf(token);
  const expires = new Date(Date.now() + hours * 3_600_000);
  await db
    .insertInto('sessions')
    .values({
      human_id: person.id,
      token_hash: secretFingerprint(token),
      csrf_hash: secretFingerprint(csrf),
      expires_at: expires,
    })
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
