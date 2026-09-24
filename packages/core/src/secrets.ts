// Secretos: se generan aquí y en la base solo se guarda su huella.

import { createHash, randomBytes } from 'node:crypto';

export const AGENT_TOKEN_PREFIX = 'dmg_agent_';

export const secretFingerprint = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

export const newSecret = (prefix = ''): string => `${prefix}${randomBytes(32).toString('base64url')}`;
