// Failure classes added in salud-del-harness §6.6: `provider_error` and `harness`. The fixtures are the six builder
// steps of Comidas that were stored as `other` (read from build_steps, ids and sessions removed, nothing secret).

import { describe, expect, it } from 'vitest';
import { classifyBuilderFailure, isTransientFailure } from '../src/build/failure.ts';

const providerError = (id: string): string =>
  `{"type":"result","subtype":"success","is_error":true,"api_error_status":null,"result":"API Error","uuid":"${id}","timestamp":"2026-10-01T11:25:45.316Z","error":"server_error","is_api_error_message":true}\n` +
  '{"duration_api_ms":0,"stop_reason":"stop_sequence","total_cost_usd":0,"usage":{"input_tokens":0,"output_tokens":0},"modelUsage":{},"permission_denials":[]}';
const credentialsCopy = "cp: cannot create regular file '/home/demiurgo/.claude-auth/.claude.json': Permission denied";

describe('failure classes of the harness health design', () => {
  const base = { exitCode: 1 };

  it('the four Comidas steps with a server_error from the provider are provider_error', () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(classifyBuilderFailure({ ...base, transcript: providerError(id) })).toBe('provider_error');
    }
  });

  it('the two Comidas steps that could not copy the credentials are harness', () => {
    for (let i = 0; i < 2; i++) expect(classifyBuilderFailure({ ...base, stderr: credentialsCopy })).toBe('harness');
    expect(classifyBuilderFailure({ ...base, transcript: credentialsCopy })).toBe('harness');
  });

  it('none of the six stays other', () => {
    const kinds = [...['a', 'b', 'c', 'd'].map((id) => classifyBuilderFailure({ ...base, transcript: providerError(id) })), classifyBuilderFailure({ ...base, stderr: credentialsCopy }), classifyBuilderFailure({ ...base, stderr: credentialsCopy })];
    expect(kinds).not.toContain('other');
  });

  it('keeps the earlier classes first: a quota or login message that is also an API error message', () => {
    expect(classifyBuilderFailure({ ...base, transcript: '{"is_api_error_message":true,"result":"You have hit your limit"}' })).toBe('usage_limit');
    expect(classifyBuilderFailure({ ...base, transcript: '{"is_api_error_message":true,"result":"Invalid API key · Please run /login"}' })).toBe('login');
    expect(classifyBuilderFailure({ ...base, runnerKind: 'infra', stderr: credentialsCopy })).toBe('infra');
  });

  it('does not take a permission error the builder printed while working for the harness', () => {
    expect(classifyBuilderFailure({ ...base, transcript: 'Bash: rm /etc/hosts -> permission denied' })).toBe('other');
  });

  it('isTransientFailure: waiting fixes a usage limit and a provider error, nothing else', () => {
    expect(isTransientFailure('usage_limit')).toBe(true);
    expect(isTransientFailure('provider_error')).toBe(true);
    for (const kind of ['harness', 'login', 'timeout', 'other', 'tdd_red', null, undefined]) expect(isTransientFailure(kind)).toBe(false);
  });
});
