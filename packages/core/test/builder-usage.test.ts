import { describe, expect, it } from 'vitest';
import { usageCollector } from '../src/runner/builder-usage.ts';

const claudeResult = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 120000,
  total_cost_usd: 1.25,
  num_turns: 14,
  usage: {
    input_tokens: 100,
    cache_creation_input_tokens: 2000,
    cache_read_input_tokens: 30000,
    output_tokens: 900,
    output_tokens_details: { thinking_tokens: 300 },
  },
});
const turn = (i: number, o: number, c: number, r: number) =>
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: i, cached_input_tokens: c, output_tokens: o, reasoning_output_tokens: r } });

describe('builder usage collector', () => {
  it('reads the Claude result event with its cost, whatever the chunking', () => {
    const c = usageCollector('claude');
    const stream = `{"type":"system","subtype":"init"}\n${claudeResult}\n`;
    for (let i = 0; i < stream.length; i += 7) c.add(stream.slice(i, i + 7));
    const u = c.usage(5);
    expect(u).toMatchObject({ inputTokens: 32100, outputTokens: 900, cachedInputTokens: 30000, reasoningTokens: 300, turns: 14, durationMs: 120000, declaredCostUsd: 1.25 });
    expect(u?.provenance?.declaredCostUsd).toBe('claude:result.total_cost_usd');
  });

  it('sums the Codex turn.completed events', () => {
    const c = usageCollector('codex');
    c.add(`{"type":"thread.started","thread_id":"abc12345"}\n${turn(100, 10, 40, 4)}\n{"type":"item.completed","item":{"type":"agent_message","text":"x"}}\n${turn(200, 20, 80, 6)}`);
    const u = c.usage(7000);
    expect(u).toMatchObject({ inputTokens: 300, outputTokens: 30, cachedInputTokens: 120, reasoningTokens: 10, turns: 2, durationMs: 7000 });
    expect(u?.declaredCostUsd).toBeUndefined();
  });

  it('reports nothing when the stream had no usage', () => {
    for (const p of ['claude', 'codex'] as const) {
      const c = usageCollector(p);
      c.add('{"type":"assistant","message":{}}\nnot json\n');
      expect(c.usage(1)).toBeUndefined();
    }
  });
});
