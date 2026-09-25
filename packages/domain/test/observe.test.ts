import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fingerprint } from '../src/fingerprint.ts';
import {
  ATTR,
  CLI_ENV,
  type Fragment,
  type FragmentDecision,
  GEN_AI_PROVIDER_NAMES,
  LOG,
  type Manifest,
  NOT_REPORTED,
  OBSERVE_SCHEMA_VERSION,
  RESOURCE,
  SPAN,
  TEXT_KINDS,
  formatTraceParent,
  interactionIdOf,
  manifestSummary,
  normalizeUsage,
  parseTraceParent,
  sha256Hex,
  traceIdOf,
  usageAttributes,
} from '../src/observe.ts';

// Real CLI output recorded by the providers' own tests (packages/core/test/fixtures).
const fixture = (path: string) => new URL(`../../core/test/fixtures/${path}`, import.meta.url);

/** The first JSON line of a recorded stream whose `type` matches. */
function lineOfType(path: string, type: string): Record<string, unknown> {
  const lines = readFileSync(fixture(path), 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.type === type) return parsed;
  }
  throw new Error(`No "${type}" line in ${path}`);
}

describe('observability vocabulary', () => {
  it('freezes the names of version 1', () => {
    // Fingerprint (sorted JSON) of every name a note can carry. Renaming or adding one changes it:
    // that is a change of vocabulary, so bump OBSERVE_SCHEMA_VERSION and update this literal.
    expect(OBSERVE_SCHEMA_VERSION).toBe(1);
    expect(fingerprint({ ATTR, SPAN, LOG, RESOURCE, TEXT_KINDS, CLI_ENV, GEN_AI_PROVIDER_NAMES })).toBe(
      'dab571c5ff04698f0422b940a354f6c00402a9dc3e313efd20b9beab55c8e5dc',
    );
  });
});

describe('normalizeUsage', () => {
  it('reads a fresh Claude result: input_tokens is uncached, cost is cumulative, thinking is reasoning', () => {
    const result = lineOfType('claude/fresh.recorded.jsonl', 'result');
    const u = normalizeUsage('claude', result);
    expect(u.uncachedInput).toEqual({ value: 1461, provenance: 'claude:result.usage.input_tokens' });
    expect(u.cacheRead).toEqual({ value: 0, provenance: 'claude:result.usage.cache_read_input_tokens' });
    expect(u.cacheWrite).toEqual({ value: 0, provenance: 'claude:result.usage.cache_creation_input_tokens' });
    expect(u.output).toEqual({ value: 286, provenance: 'claude:result.usage.output_tokens' });
    expect(u.reasoning).toEqual({ value: 214, provenance: 'claude:result.usage.output_tokens_details.thinking_tokens' });
    expect(u.declaredCostUsd).toEqual({ value: 0.0028910000000000003, provenance: 'claude:result.total_cost_usd:cumulative' });
    expect(u.turns).toBe(2);
    expect(u.inputTotal).toBe(1461);
    // Nothing read from the cache: a real 0, not "not reported".
    expect(u.cacheRatio).toBe(0);
    expect(u.raw).toBe(result);
  });

  it('reads a resumed Claude result the same way, with the cumulative cost of the session', () => {
    const u = normalizeUsage('claude', lineOfType('claude/resumed.recorded.jsonl', 'result'));
    expect(u.uncachedInput.value).toBe(1893);
    expect(u.output.value).toBe(166);
    expect(u.reasoning.value).toBe(100);
    expect(u.declaredCostUsd).toEqual({ value: 0.005614, provenance: 'claude:result.total_cost_usd:cumulative' });
    expect(u.turns).toBe(2);
    expect(u.inputTotal).toBe(1893);
  });

  it('accepts the Claude usage object alone: cost and turns then are not reported', () => {
    const result = lineOfType('claude/fresh.recorded.jsonl', 'result');
    const u = normalizeUsage('claude', result.usage);
    expect(u.uncachedInput.value).toBe(1461);
    expect(u.declaredCostUsd).toEqual({ value: null, provenance: NOT_REPORTED });
    expect(u.turns).toBeNull();
  });

  it('reads a fresh Codex turn: the cache is inside input_tokens and gets subtracted', () => {
    const turn = lineOfType('codex/fresh.recorded.jsonl', 'turn.completed');
    const u = normalizeUsage('codex', turn);
    expect(u.uncachedInput).toEqual({ value: 8884, provenance: 'codex:turn.completed.usage.input_tokens-cached_input_tokens' });
    expect(u.cacheRead).toEqual({ value: 0, provenance: 'codex:turn.completed.usage.cached_input_tokens' });
    expect(u.cacheWrite).toEqual({ value: 0, provenance: 'codex:turn.completed.usage.cache_write_input_tokens' });
    expect(u.output).toEqual({ value: 27, provenance: 'codex:turn.completed.usage.output_tokens' });
    expect(u.reasoning).toEqual({ value: 0, provenance: 'codex:turn.completed.usage.reasoning_output_tokens' });
    expect(u.declaredCostUsd).toEqual({ value: null, provenance: NOT_REPORTED });
    expect(u.turns).toBeNull();
    expect(u.inputTotal).toBe(8884);
    expect(u.cacheRatio).toBe(0);
  });

  it('reads a resumed Codex turn: 17863 input with 7936 cached → 9927 uncached, ratio 7936/17863', () => {
    const u = normalizeUsage('codex', lineOfType('codex/resumed.recorded.jsonl', 'turn.completed'));
    expect(u.uncachedInput.value).toBe(9927);
    expect(u.cacheRead.value).toBe(7936);
    expect(u.cacheWrite.value).toBe(0);
    expect(u.output.value).toBe(49);
    expect(u.inputTotal).toBe(17863);
    expect(u.cacheRatio).toBeCloseTo(7936 / 17863, 12);
  });

  it('reads an OpenCode completion: OpenAI names, cache write never reported', () => {
    const completion = JSON.parse(readFileSync(fixture('opencode/tool-call.json'), 'utf8')) as Record<string, unknown>;
    const u = normalizeUsage('opencode', completion);
    expect(u.uncachedInput).toEqual({
      value: 354,
      provenance: 'opencode:usage.prompt_tokens-prompt_tokens_details.cached_tokens',
    });
    expect(u.cacheRead).toEqual({ value: 0, provenance: 'opencode:usage.prompt_tokens_details.cached_tokens' });
    expect(u.cacheWrite).toEqual({ value: null, provenance: NOT_REPORTED });
    expect(u.output).toEqual({ value: 57, provenance: 'opencode:usage.completion_tokens' });
    expect(u.reasoning).toEqual({ value: 24, provenance: 'opencode:usage.completion_tokens_details.reasoning_tokens' });
    expect(u.declaredCostUsd.provenance).toBe(NOT_REPORTED);
    expect(u.inputTotal).toBe(354);
    expect(u.cacheRatio).toBe(0);
  });

  it('leaves absent figures as not_reported (null), never 0', () => {
    // A local model that reports neither the cache nor the reasoning.
    const u = normalizeUsage('qwen-local', { prompt_tokens: 120, completion_tokens: 30 });
    expect(u.uncachedInput).toEqual({ value: 120, provenance: 'qwen-local:usage.prompt_tokens' });
    expect(u.cacheRead).toEqual({ value: null, provenance: NOT_REPORTED });
    expect(u.cacheWrite).toEqual({ value: null, provenance: NOT_REPORTED });
    expect(u.reasoning).toEqual({ value: null, provenance: NOT_REPORTED });
    expect(u.output.value).toBe(30);
    expect(u.inputTotal).toBe(120);
    // The cache is not reported, so the ratio is unknown rather than 0.
    expect(u.cacheRatio).toBeNull();
  });

  it('reads the simulated provider from the domain Usage shape', () => {
    const u = normalizeUsage('simulated', { inputTokens: 100, outputTokens: 40, cachedInputTokens: 25, reasoningTokens: 5 });
    expect(u.uncachedInput).toEqual({ value: 75, provenance: 'simulated:inputTokens-cachedInputTokens' });
    expect(u.cacheRead).toEqual({ value: 25, provenance: 'simulated:cachedInputTokens' });
    expect(u.cacheWrite.provenance).toBe(NOT_REPORTED);
    expect(u.output).toEqual({ value: 40, provenance: 'simulated:outputTokens' });
    expect(u.reasoning).toEqual({ value: 5, provenance: 'simulated:reasoningTokens' });
    expect(u.inputTotal).toBe(100);
    expect(u.cacheRatio).toBe(0.25);
    const bare = normalizeUsage('simulated', { inputTokens: 10, outputTokens: 0 });
    expect(bare.uncachedInput).toEqual({ value: 10, provenance: 'simulated:inputTokens' });
    expect(bare.cacheRead.value).toBeNull();
  });

  it('assumes nothing for an unknown provider without prompt_tokens', () => {
    const u = normalizeUsage('mystery', { tokens: 12 });
    expect(u.uncachedInput.provenance).toBe(NOT_REPORTED);
    expect(u.output.provenance).toBe(NOT_REPORTED);
    expect(u.inputTotal).toBeNull();
    expect(u.cacheRatio).toBeNull();
    expect(u.raw).toEqual({ tokens: 12 });
  });

  it('never throws: non-objects give every figure not_reported', () => {
    for (const raw of [undefined, null, 'usage', 42, [1, 2], true]) {
      const u = normalizeUsage('claude', raw);
      for (const f of [u.uncachedInput, u.cacheRead, u.cacheWrite, u.output, u.reasoning, u.declaredCostUsd]) {
        expect(f).toEqual({ value: null, provenance: NOT_REPORTED });
      }
      expect(u.turns).toBeNull();
      expect(u.inputTotal).toBeNull();
      expect(u.cacheRatio).toBeNull();
      expect(u.raw).toBe(raw);
    }
    expect(() => normalizeUsage('codex', { usage: 'nope' })).not.toThrow();
    expect(() => normalizeUsage('opencode', { prompt_tokens: 'many' })).not.toThrow();
  });
});

describe('usageAttributes', () => {
  it('writes the GenAI and demiurgo attributes and omits the figures not reported', () => {
    const attrs = usageAttributes(normalizeUsage('claude', lineOfType('claude/resumed.recorded.jsonl', 'result')));
    expect(attrs[ATTR.genAiUsageInputTokens]).toBe(1893);
    expect(attrs[ATTR.genAiUsageOutputTokens]).toBe(166);
    expect(attrs[ATTR.genAiUsageCacheReadInputTokens]).toBe(0);
    expect(attrs[ATTR.genAiUsageCacheWriteInputTokens]).toBe(0);
    expect(attrs[ATTR.genAiUsageReasoningOutputTokens]).toBe(100);
    expect(attrs[ATTR.usageUncachedInputTokens]).toBe(1893);
    expect(attrs[ATTR.usageDeclaredCostUsd]).toBe(0.005614);
    expect(attrs[ATTR.usageTurns]).toBe(2);
    expect(JSON.parse(attrs[ATTR.usageProvenance] as string)).toEqual({
      uncachedInput: 'claude:result.usage.input_tokens',
      cacheRead: 'claude:result.usage.cache_read_input_tokens',
      cacheWrite: 'claude:result.usage.cache_creation_input_tokens',
      output: 'claude:result.usage.output_tokens',
      reasoning: 'claude:result.usage.output_tokens_details.thinking_tokens',
      declaredCostUsd: 'claude:result.total_cost_usd:cumulative',
    });
    expect((JSON.parse(attrs[ATTR.usageRaw] as string) as { usage: { input_tokens: number } }).usage.input_tokens).toBe(1893);

    const sparse = usageAttributes(normalizeUsage('qwen-local', { prompt_tokens: 120, completion_tokens: 30 }));
    expect(Object.keys(sparse).sort()).toEqual(
      [
        ATTR.genAiUsageInputTokens,
        ATTR.genAiUsageOutputTokens,
        ATTR.usageUncachedInputTokens,
        ATTR.usageProvenance,
        ATTR.usageRaw,
      ].sort(),
    );
    expect(sparse).not.toHaveProperty(ATTR.genAiUsageCacheReadInputTokens);
    expect(sparse).not.toHaveProperty(ATTR.usageTurns);

    const empty = usageAttributes(normalizeUsage('claude', null));
    expect(Object.keys(empty).sort()).toEqual([ATTR.usageProvenance, ATTR.usageRaw].sort());
    expect(empty[ATTR.usageRaw]).toBe('null');
  });
});

describe('trace identity', () => {
  it('turns an interaction id into a trace id and back', () => {
    const id = '019a1b2c-3d4e-7f80-9abc-def012345678';
    expect(traceIdOf(id)).toBe('019a1b2c3d4e7f809abcdef012345678');
    expect(traceIdOf(id.toUpperCase())).toBe('019a1b2c3d4e7f809abcdef012345678');
    expect(interactionIdOf(traceIdOf(id))).toBe(id);
    expect(interactionIdOf('019A1B2C3D4E7F809ABCDEF012345678')).toBe(id);
  });

  it('parses and formats a W3C traceparent', () => {
    const traceId = '019a1b2c3d4e7f809abcdef012345678';
    const spanId = '00f067aa0ba902b7';
    expect(formatTraceParent(traceId, spanId)).toBe(`00-${traceId}-${spanId}-01`);
    expect(formatTraceParent(traceId, spanId, false)).toBe(`00-${traceId}-${spanId}-00`);
    expect(parseTraceParent(formatTraceParent(traceId, spanId))).toEqual({ traceId, spanId, flags: '01' });
    expect(parseTraceParent(`  00-${traceId.toUpperCase()}-${spanId}-01\n`)).toEqual({ traceId, spanId, flags: '01' });
    for (const bad of [
      '',
      'garbage',
      `01-${traceId}-${spanId}-01`,
      `00-${traceId.slice(1)}-${spanId}-01`,
      `00-${traceId}-${spanId}`,
      `00-${traceId}-xyz-01`,
    ]) {
      expect(parseTraceParent(bad)).toBeNull();
    }
  });
});

describe('sha256Hex', () => {
  it('is the full SHA-256 of the UTF-8 text', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('ñ')).toHaveLength(64);
    expect(sha256Hex('ñ')).not.toBe(sha256Hex('n'));
  });
});

function fragment(seq: number, section: string, decision: FragmentDecision, chars: number): Fragment {
  return {
    seq,
    section,
    source: { type: 'message', id: `m${seq}`, version: null, eventSeq: seq },
    textHash: sha256Hex(`text ${seq}`),
    chars,
    originalChars: chars + (decision === 'truncated' ? 100 : 0),
    decision,
    reason: decision === 'dropped' ? 'budget:messages' : 'included',
    score: null,
    position: decision === 'dropped' ? null : seq,
  };
}

describe('manifestSummary', () => {
  it('counts what entered, what was dropped, and the characters per section', () => {
    const manifest: Manifest = {
      builder: 'exploration_chat@2',
      graphVersion: 3,
      budget: { messages: 1000, knowledge: 500 },
      candidates: 5,
      fragments: [
        fragment(1, 'messages', 'included', 400),
        fragment(2, 'messages', 'truncated', 300),
        fragment(3, 'messages', 'dropped', 0),
        fragment(4, 'knowledge', 'summarized', 120),
        fragment(5, 'knowledge', 'dropped', 0),
      ],
    };
    expect(manifestSummary(manifest)).toEqual({
      includedChars: 820,
      droppedCount: 2,
      bySection: {
        messages: { included: 2, chars: 700, dropped: 1 },
        knowledge: { included: 1, chars: 120, dropped: 1 },
      },
    });
    expect(manifestSummary({ ...manifest, fragments: [] })).toEqual({ includedChars: 0, droppedCount: 0, bySection: {} });
  });
});
