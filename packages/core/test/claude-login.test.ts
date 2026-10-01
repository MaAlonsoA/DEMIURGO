import { describe, expect, it } from 'vitest';
import { LOGIN_MARGIN_MS, checkClaudeLogin, storedSessionExpired, storedSessionExpiry } from '../src/runner/claude-login.ts';
import { runBuilder } from '../src/runner/builder.ts';
import { allowedEnv } from '../src/env.ts';

const NOW = 1_800_000_000_000;
const fake = (expiresAt: unknown) => async () => JSON.stringify({ claudeAiOauth: { accessToken: 'x'.repeat(20), refreshToken: 'y'.repeat(20), expiresAt } });
const HOUR = 3_600_000;

describe('Claude sign-in gate for builders', () => {
  it('reads only the expiry from the credentials', async () => {
    expect(await storedSessionExpiry('/c', fake(NOW))).toBe(NOW);
    expect(await storedSessionExpiry('/c', async () => 'not json')).toBeNull();
    expect(await storedSessionExpiry('/c', async () => { throw new Error('ENOENT'); })).toBeNull();
    expect(await storedSessionExpiry('/c', fake('soon'))).toBeNull();
  });

  it('lets a build start when the session outlives it by the margin', async () => {
    const env = { CLAUDE_CONFIG_DIR: '/c' };
    const ok = await checkClaudeLogin({ env, maxTimeMs: HOUR, now: () => NOW, read: fake(NOW + HOUR + LOGIN_MARGIN_MS + 1) });
    expect(ok).toEqual({ ok: true });
  });

  it('refuses when it expires within the build time plus 10 minutes, naming the fix without the token', async () => {
    const env = { CLAUDE_CONFIG_DIR: '/c' };
    const r = await checkClaudeLogin({ env, maxTimeMs: HOUR, now: () => NOW, read: fake(NOW + HOUR + LOGIN_MARGIN_MS) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('claude setup-token');
      expect(r.message).toContain('CLAUDE_CODE_OAUTH_TOKEN');
      expect(r.message).not.toContain('xxxx');
    }
    expect((await checkClaudeLogin({ env, maxTimeMs: HOUR, now: () => NOW, read: fake(NOW - 1) })).ok).toBe(false);
  });

  it('does not gate with the long-lived token, nor when nothing can be read', async () => {
    const read = fake(NOW - 1);
    expect(await checkClaudeLogin({ env: { CLAUDE_CONFIG_DIR: '/c', CLAUDE_CODE_OAUTH_TOKEN: 'tok' }, maxTimeMs: HOUR, now: () => NOW, read })).toEqual({ ok: true });
    expect(await checkClaudeLogin({ env: {}, maxTimeMs: HOUR, now: () => NOW, read })).toEqual({ ok: true });
    expect(await checkClaudeLogin({ env: { CLAUDE_CONFIG_DIR: '/c' }, maxTimeMs: HOUR, now: () => NOW, read: async () => { throw new Error('x'); } })).toEqual({ ok: true });
  });

  it('runBuilder fails the attempt as login without starting a container', async () => {
    const r = await runBuilder(
      { worktreeHostPath: '/w', provider: 'claude', model: 'opus', effort: 'high', prompt: 'p', maxTimeMs: HOUR, limits: { cpus: 1, memoryMb: 512, pids: 64 } },
      { environment: {}, dockerBinary: '/nonexistent/docker', loginCheck: async () => ({ ok: false, message: 'expired' }) },
    );
    expect(r.state).toBe('failure');
    expect(r.failureKind).toBe('login');
    expect(r.stderrTail).toBe('expired');
  });

  it('readiness sees an expired stored session unless the token is set', async () => {
    const env = { CLAUDE_CONFIG_DIR: '/c' };
    expect(await storedSessionExpired(env, () => NOW, fake(NOW - 1))).toBe(true);
    expect(await storedSessionExpired(env, () => NOW, fake(NOW + 1000))).toBe(false);
    expect(await storedSessionExpired({ ...env, CLAUDE_CODE_OAUTH_TOKEN: 't' }, () => NOW, fake(NOW - 1))).toBe(false);
  });

  it('the API-side CLI environment carries the token only when it is not blank', () => {
    expect(allowedEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'tok' }).CLAUDE_CODE_OAUTH_TOKEN).toBe('tok');
    expect(allowedEnv({ CLAUDE_CODE_OAUTH_TOKEN: '' }).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });
});
