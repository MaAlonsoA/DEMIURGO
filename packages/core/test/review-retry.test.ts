import { describe, expect, it } from 'vitest';
import { isTransientRunError, REVIEW_MAX_RETRIES, REVIEW_RETRY_BACKOFF_MS } from '../src/build/review-retry.ts';

describe('isTransientRunError', () => {
  it('recognises capacity, overload, limits, 429/5xx and network errors', () => {
    for (const text of [
      'Codex gave no final answer: Selected model is at capacity. Please try a different model.',
      'API Error: 529 overloaded_error',
      'Claude AI usage limit reached|1759300000',
      'rate limit exceeded',
      'HTTP 429 Too Many Requests',
      'HTTP 503 Service Unavailable',
      'request failed: ECONNRESET',
      'fetch failed',
    ]) {
      expect(isTransientRunError(text), text).toBe(true);
    }
  });
  it('does not retry what waiting does not fix', () => {
    for (const text of ['Not logged in · Please run /login', 'The output did not match the schema', 'invalid_output', '', null, undefined]) {
      expect(isTransientRunError(text), String(text)).toBe(false);
    }
  });
  it('has a backoff for every retry', () => {
    expect(REVIEW_RETRY_BACKOFF_MS).toHaveLength(REVIEW_MAX_RETRIES);
  });
});
