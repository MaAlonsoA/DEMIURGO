// Secrets: generated here, and only their fingerprint is stored in the database.

import { createHash, randomBytes } from 'node:crypto';

export const AGENT_TOKEN_PREFIX = 'dmg_agent_';

export const secretFingerprint = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

export const newSecret = (prefix = ''): string => `${prefix}${randomBytes(32).toString('base64url')}`;
