// Credenciales: claves de personas (scrypt), sesiones con cookie httpOnly + CSRF y tokens de
// agentes externos. En la base solo se guardan huellas, nunca los secretos.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { type Actor, ErrorDominio, agenteExterno, humano } from '@demiurgo/domain';
import type { Bd } from '@demiurgo/core';

const scrypt = promisify(scryptCb) as (
  clave: string,
  sal: Buffer,
  largo: number,
  op: { N: number; r: number; p: number },
) => Promise<Buffer>;

export const COOKIE_SESION = 'demiurgo_sesion';
export const CABECERA_CSRF = 'x-demiurgo-csrf';
export const PREFIJO_TOKEN_AGENTE = 'dmg_agente_';

const PARAMS = { N: 16_384, r: 8, p: 1 };

export async function hashClave(clave: string): Promise<string> {
  const sal = randomBytes(16);
  const h = await scrypt(clave, sal, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${sal.toString('base64url')}$${h.toString('base64url')}`;
}

export async function verificarClave(clave: string, guardado: string): Promise<boolean> {
  const [alg, n, r, p, sal, h] = guardado.split('$');
  if (alg !== 'scrypt' || !sal || !h) return false;
  const esperado = Buffer.from(h, 'base64url');
  const calculado = await scrypt(clave, Buffer.from(sal, 'base64url'), esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

export const huellaSecreto = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
export const nuevoSecreto = (prefijo = ''): string => `${prefijo}${randomBytes(32).toString('base64url')}`;

export async function crearPersona(db: Bd, usuario: string, clave: string): Promise<string> {
  if (clave.length < 12) throw new ErrorDominio('validacion', 'La clave debe tener al menos 12 caracteres.');
  const { id } = await db
    .insertInto('humans')
    .values({ username: usuario, password_hash: await hashClave(clave) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

export type SesionNueva = { token: string; csrf: string; expira: Date; persona: string };

export async function abrirSesion(db: Bd, usuario: string, clave: string, horas: number): Promise<SesionNueva> {
  const persona = await db.selectFrom('humans').selectAll().where('username', '=', usuario).executeTakeFirst();
  const ok = persona
    ? await verificarClave(clave, persona.password_hash)
    : await verificarClave(clave, 'scrypt$16384$8$1$AAAA$AAAA');
  if (!persona || !ok) throw new ErrorDominio('no_autenticado', 'Usuario o clave incorrectos.');
  const token = nuevoSecreto();
  const csrf = nuevoSecreto();
  const expira = new Date(Date.now() + horas * 3_600_000);
  await db
    .insertInto('sessions')
    .values({ human_id: persona.id, token_hash: huellaSecreto(token), csrf_hash: huellaSecreto(csrf), expires_at: expira })
    .execute();
  return { token, csrf, expira, persona: persona.username };
}

export async function cerrarSesion(db: Bd, token: string): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date() })
    .where('token_hash', '=', huellaSecreto(token))
    .where('revoked_at', 'is', null)
    .execute();
}

export type Credencial =
  | { tipo: 'persona'; actor: Actor; csrfHash: string }
  | { tipo: 'agente'; actor: Actor; proyectoId: string }
  | { tipo: 'ninguna' };

export async function resolverSesion(db: Bd, token: string): Promise<Credencial> {
  const fila = await db
    .selectFrom('sessions')
    .innerJoin('humans', 'humans.id', 'sessions.human_id')
    .select(['humans.username', 'sessions.csrf_hash', 'sessions.expires_at', 'sessions.revoked_at'])
    .where('sessions.token_hash', '=', huellaSecreto(token))
    .executeTakeFirst();
  if (!fila || fila.revoked_at || new Date(fila.expires_at) < new Date()) return { tipo: 'ninguna' };
  return { tipo: 'persona', actor: humano(fila.username), csrfHash: fila.csrf_hash };
}

export async function resolverTokenAgente(db: Bd, token: string): Promise<Credencial> {
  if (!token.startsWith(PREFIJO_TOKEN_AGENTE)) return { tipo: 'ninguna' };
  const fila = await db
    .selectFrom('agent_tokens')
    .select(['id', 'name', 'project_id', 'state'])
    .where('token_hash', '=', huellaSecreto(token))
    .executeTakeFirst();
  if (!fila || fila.state !== 'active') return { tipo: 'ninguna' };
  return { tipo: 'agente', actor: agenteExterno(fila.name, fila.id), proyectoId: fila.project_id };
}
