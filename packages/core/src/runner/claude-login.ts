// Claude's sign-in for headless runs. Two ways, in order of preference:
//
// 1. `CLAUDE_CODE_OAUTH_TOKEN`: a long-lived (one year) OAuth token made by `claude setup-token`. Claude Code
//    reads it from the environment (it ranks below the API-key variables and above the stored `/login`
//    credentials), it needs no credentials file and nothing refreshes it.
//    Source: https://code.claude.com/docs/en/authentication ("Generate a long-lived token" and
//    "Authentication precedence"). Bare mode does not read it, and DEMIURGO never uses bare mode.
// 2. Without it, the stored session in the shared sign-in volume (`.credentials.json`, access token with a short
//    life). Only ONE process may refresh it: a refresh rotates the refresh token, so a refresh done inside a
//    throwaway copy loses the new token and breaks the stored session. Builders therefore never get to refresh:
//    before one starts, `checkClaudeLogin` refuses to start it when the stored access token would expire
//    before the build can finish.
//
// Only the `expiresAt` field of the credentials is ever read; the tokens are never read, logged or returned.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CLAUDE_TOKEN_VARIABLE = 'CLAUDE_CODE_OAUTH_TOKEN';
/** Margin on top of the build's maximum time (our convention): enough for the steps around the builder. */
export const LOGIN_MARGIN_MS = 10 * 60_000;

type Env = Readonly<Record<string, string | undefined>>;

/** The long-lived token of the environment, or undefined when it is missing or blank. */
export function claudeOauthToken(env: Env): string | undefined {
  const value = env[CLAUDE_TOKEN_VARIABLE]?.trim();
  return value ? value : undefined;
}

/** When the stored session's access token expires (epoch ms), or null when there is no readable file or field. */
export async function storedSessionExpiry(configDir: string, read: (path: string) => Promise<string> = (p) => readFile(p, 'utf8')): Promise<number | null> {
  try {
    const parsed = JSON.parse(await read(join(configDir, '.credentials.json'))) as { claudeAiOauth?: { expiresAt?: unknown } } | null;
    const at = parsed?.claudeAiOauth?.expiresAt;
    return typeof at === 'number' && Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

export const LOGIN_EXPIRES_MESSAGE =
  "Claude's sign-in expires before this build could finish, and a builder never refreshes the shared session. " +
  'Run `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN in .env (then `docker compose up -d api`), or sign in again with `docker compose exec api claude`.';

export type LoginCheck = { ok: true } | { ok: false; message: string };

/**
 * Whether a Claude builder may start. Fine with the long-lived token, or when the stored session outlives the
 * build by the margin, or when nothing can be read (the builder then fails by itself and is classified).
 */
export async function checkClaudeLogin(input: {
  env: Env;
  maxTimeMs: number;
  now?: () => number;
  read?: (path: string) => Promise<string>;
}): Promise<LoginCheck> {
  if (claudeOauthToken(input.env)) return { ok: true };
  const dir = input.env.CLAUDE_CONFIG_DIR?.trim();
  if (!dir) return { ok: true };
  const expiresAt = await storedSessionExpiry(dir, input.read);
  if (expiresAt === null) return { ok: true };
  const now = (input.now ?? Date.now)();
  return expiresAt - now > input.maxTimeMs + LOGIN_MARGIN_MS ? { ok: true } : { ok: false, message: LOGIN_EXPIRES_MESSAGE };
}

/**
 * The stored session cannot be used by the provider (and no long-lived token is set): the access token is
 * expired. Used by the provider's readiness; the refresh itself is not attempted here.
 */
export async function storedSessionExpired(env: Env, now: () => number = Date.now, read?: (path: string) => Promise<string>): Promise<boolean> {
  if (claudeOauthToken(env)) return false;
  const dir = env.CLAUDE_CONFIG_DIR?.trim();
  if (!dir) return false;
  const expiresAt = await storedSessionExpiry(dir, read);
  return expiresAt !== null && expiresAt <= now();
}
