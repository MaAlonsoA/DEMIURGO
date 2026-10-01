import { describe, expect, it } from 'vitest';
import { classifyBuilderFailure, failureExcerpt, isTransientFailure, redactSecrets } from '../src/build/failure.ts';

describe('classifyBuilderFailure', () => {
  const base = { exitCode: 1 };
  it('keeps what the runner knows', () => {
    expect(classifyBuilderFailure({ ...base, runnerKind: 'timeout' })).toBe('timeout');
    expect(classifyBuilderFailure({ ...base, runnerKind: 'cancelled' })).toBe('cancelled');
    expect(classifyBuilderFailure({ exitCode: null, runnerKind: 'infra' })).toBe('infra');
  });
  it('recognises a usage or rate limit', () => {
    for (const text of ['Claude AI usage limit reached|1759300000', 'rate limit exceeded', 'You have hit your limit', 'HTTP 429 Too Many Requests', 'limit reached']) {
      expect(classifyBuilderFailure({ ...base, stderr: text })).toBe('usage_limit');
    }
    expect(isTransientFailure('usage_limit')).toBe(true);
    expect(isTransientFailure('other')).toBe(false);
  });
  it('does not take a healthy rate_limit_event line for a limit', () => {
    const transcript = '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}\n{"type":"result","is_error":true}';
    expect(classifyBuilderFailure({ ...base, transcript })).toBe('other');
    const rejected = '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected"}}';
    expect(classifyBuilderFailure({ ...base, transcript: rejected })).toBe('usage_limit');
  });
  it('recognises authentication problems', () => {
    expect(classifyBuilderFailure({ ...base, stderr: 'Invalid API key · Please run /login' })).toBe('auth');
    expect(classifyBuilderFailure({ ...base, stderr: 'OAuth token has expired' })).toBe('auth');
  });
  it('recognises out of memory and a kill', () => {
    expect(classifyBuilderFailure({ exitCode: 137 })).toBe('out_of_memory');
    expect(classifyBuilderFailure({ ...base, stderr: 'FATAL ERROR: heap out of memory' })).toBe('out_of_memory');
  });
  it('falls back to other for a plain exit code', () => {
    expect(classifyBuilderFailure({ ...base, stderr: 'something broke' })).toBe('other');
    expect(classifyBuilderFailure({ ...base })).toBe('other');
  });
});

describe('redaction', () => {
  it('removes tokens by shape', () => {
    const text = 'ghp_abcdefghijklmnopqrstuv github_pat_11ABCDEFG0abcdefghij sk-ant-abc123def456ghi dmg_agent_abcdef123456 Bearer abc.def-ghi123456';
    const out = redactSecrets(text, {});
    expect(out).not.toMatch(/ghp_|github_pat_|sk-ant|dmg_agent_|abc\.def/);
    expect(out).toContain('***');
  });
  it('removes the values of secret environment variables, not the others', () => {
    const env = { DEMIURGO_GITHUB_TOKEN: 'plain-secret-value', NODE_ENV: 'production-mode' };
    const out = redactSecrets('token plain-secret-value in production-mode', env);
    expect(out).toBe('token *** in production-mode');
  });
  it('keeps the last 1500 characters, redacted', () => {
    const excerpt = failureExcerpt({ transcript: `${'x'.repeat(5000)} ghp_abcdefghijklmnopqrstuv end`, stderr: 'boom' }, {});
    expect(excerpt.length).toBeLessThanOrEqual(1500);
    expect(excerpt).toContain('boom');
    expect(excerpt).not.toContain('ghp_');
  });
});
