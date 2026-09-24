// Secretos: se generan aquí y en la base solo se guarda su huella.

import { createHash, randomBytes } from 'node:crypto';

export const PREFIJO_TOKEN_AGENTE = 'dmg_agente_';

export const huellaSecreto = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

export const nuevoSecreto = (prefijo = ''): string => `${prefijo}${randomBytes(32).toString('base64url')}`;
