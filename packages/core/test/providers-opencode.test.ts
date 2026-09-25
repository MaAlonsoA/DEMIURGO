// OpenCode provider: the local models configured in OpenCode, called at their OpenAI-compatible
// endpoint with a StructuredOutput tool. A fake fetch replays the streams recorded from the local
// Qwen (NInfer) in `fixtures/opencode/`; the no-tool one is edited from a recording (`synthetic`).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ProviderEvent, type ProviderInvocation, jsonSchemaOf } from '@demiurgo/domain';
import { afterAll, describe, expect, it } from 'vitest';
import { chatRequest, createOpenCodeProvider, openCodeModels } from '../src/providers/opencode.ts';
import { fixture, scriptedLauncher } from './support/launchers.ts';

const CONFIG = join(import.meta.dirname, 'fixtures', 'opencode', 'opencode.json');
const folders: string[] = [];
afterAll(() => {
  for (const f of folders) rmSync(f, { recursive: true, force: true });
});

const invocation = (over: Partial<ProviderInvocation> = {}): ProviderInvocation => ({
  system: 'You echo.',
  input: 'Action: echo',
  schema: jsonSchemaOf('echo'),
  model: 'qwen-local/qwen3.8-27b',
  effort: 'medium',
  session: { mode: 'none' },
  timeMs: 60_000,
  ...over,
});

type Sent = { url: string; body: Record<string, unknown> };

/** Fetch that answers each chat request with the next stream, and /models with the recorded list. */
function fakeFetch(streams: string[], options: { modelsDown?: boolean; hang?: boolean } = {}) {
  const sent: Sent[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith('/models')) {
      if (options.modelsDown) throw new TypeError('fetch failed');
      return new Response(fixture('opencode/models.json'), { status: 200 });
    }
    sent.push({ url, body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown> });
    if (options.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    const next = streams.shift() ?? 'opencode/stream-no-tool.synthetic.txt';
    return new Response(fixture(next), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { fetchImpl, sent };
}

const versionLauncher = () => scriptedLauncher(() => ({ stdout: 'opencode v2.0.15\n' }));

describe('OpenCode provider', () => {
  it('AC-AGE-002-01 reads the models and variants configured in OpenCode', () => {
    const models = openCodeModels(JSON.parse(fixture('opencode/opencode.json').replace(/^﻿/, '')));
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      baseURL: 'http://127.0.0.1:8080/v1',
      providerName: 'Qwen3.8 local (NInfer)',
      model: {
        id: 'qwen-local/qwen3.8-27b',
        label: 'Qwen3.8-27B NVFP4 (local)',
        efforts: ['high', 'medium', 'low', 'xhigh'],
        defaultEffort: 'high',
      },
    });
  });

  it('AC-AGE-002-01 discovery lists the models when the local endpoint answers, without calling a model', async () => {
    const { fetchImpl, sent } = fakeFetch([]);
    const { launcher } = versionLauncher();
    const catalog = await createOpenCodeProvider({
      configPath: CONFIG,
      fetch: fetchImpl,
      launcher,
      executable: 'opencode',
    }).discover();
    expect(catalog).toMatchObject({
      provider: 'opencode',
      installed: true,
      version: '2.0.15',
      ready: true,
      sessions: false,
      message: null,
    });
    expect(catalog.models.map((m) => m.id)).toEqual(['qwen-local/qwen3.8-27b']);
    expect(sent).toHaveLength(0);
  });

  it("AC-AGE-002-01 with the endpoint down, discovery says which one isn't answering", async () => {
    const { fetchImpl } = fakeFetch([], { modelsDown: true });
    const { launcher } = versionLauncher();
    const catalog = await createOpenCodeProvider({
      configPath: CONFIG,
      fetch: fetchImpl,
      launcher,
      executable: 'opencode',
    }).discover();
    expect(catalog).toMatchObject({
      ready: false,
      message: "Qwen3.8 local (NInfer) isn't answering at http://127.0.0.1:8080/v1.",
    });
  });

  it('AC-AGE-002-01 without an OpenCode config there is nothing to offer', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'dmg-opencode-'));
    folders.push(empty);
    const { fetchImpl } = fakeFetch([]);
    const catalog = await createOpenCodeProvider({
      configPath: join(empty, 'opencode.json'),
      fetch: fetchImpl,
      launcher: versionLauncher().launcher,
    }).discover();
    expect(catalog).toMatchObject({ installed: false, ready: false, models: [] });
    expect(catalog.message).toMatch(/No OpenCode config/);
  });

  it('AC-AGE-002-06 asks for the answer through a StructuredOutput tool, with the variant options and no response_format', () => {
    const body = chatRequest({
      model: 'qwen3.8-27b',
      system: 'S',
      input: 'I',
      schema: jsonSchemaOf('echo'),
      options: { reasoningEffort: 'medium', maxTokens: 4000 },
    });
    expect(body).toMatchObject({
      model: 'qwen3.8-27b',
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'I' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      tool_choice: 'auto',
      reasoning_effort: 'medium',
      max_tokens: 4000,
      tools: [{ type: 'function', function: { name: 'StructuredOutput' } }],
    });
    expect(body).not.toHaveProperty('response_format');
    const parameters = (body.tools as { function: { parameters: Record<string, unknown> } }[])[0]?.function.parameters;
    expect(parameters).not.toHaveProperty('$schema');
    expect(parameters).toMatchObject({ type: 'object', required: ['reply'] });
  });

  it('AC-AGE-001-02 AC-AGE-002-10 the recorded tool-call stream gives ok with usage, provenance and events', async () => {
    const events: ProviderEvent[] = [];
    const { fetchImpl, sent } = fakeFetch(['opencode/stream-tool-call.txt']);
    const r = await createOpenCodeProvider({ configPath: CONFIG, fetch: fetchImpl }).run(
      invocation({ onEvent: (e) => events.push(e) }),
    );
    expect(r).toMatchObject({
      state: 'ok',
      rawOutput: { reply: 'hello from DEMIURGO' },
      provider: 'opencode',
      model: 'qwen3.8-27b',
      usage: {
        inputTokens: 354,
        cachedInputTokens: 0,
        outputTokens: 64,
        reasoningTokens: 31,
        turns: 1,
        provenance: {
          inputTokens: 'opencode:usage.prompt_tokens',
          reasoningTokens: 'opencode:usage.completion_tokens_details.reasoning_tokens',
        },
      },
    });
    expect(r.sessionId).toBeUndefined();
    expect(sent[0]?.url).toBe('http://127.0.0.1:8080/v1/chat/completions');
    expect(sent[0]?.body).toMatchObject({ model: 'qwen3.8-27b', reasoning_effort: 'medium' });
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe('started');
    expect(kinds).toContain('thinking');
    expect(kinds.slice(-2)).toEqual(['message', 'usage']);
    expect(events.at(-1)?.tokens).toBe(64);
  });

  it('a missing answer is retried with a correction, and then works', async () => {
    const { fetchImpl, sent } = fakeFetch(['opencode/stream-no-tool.synthetic.txt', 'opencode/stream-tool-call.txt']);
    const r = await createOpenCodeProvider({ configPath: CONFIG, fetch: fetchImpl }).run(invocation());
    expect(r).toMatchObject({ state: 'ok', usage: { turns: 2 } });
    const retry = sent[1]?.body.messages as { role: string; content: string }[];
    expect(retry.at(-2)).toMatchObject({ role: 'assistant' });
    expect(retry.at(-1)?.content).toMatch(/StructuredOutput tool exactly once/);
  });

  it('after 3 attempts without the tool the failure is agent_error with every attempt in the raw events', async () => {
    const { fetchImpl, sent } = fakeFetch([]);
    const r = await createOpenCodeProvider({ configPath: CONFIG, fetch: fetchImpl }).run(invocation());
    expect(sent).toHaveLength(3);
    expect(r).toMatchObject({ state: 'error', failureKind: 'agent_error' });
    expect(r.state === 'error' ? r.message : '').toMatch(/didn't call StructuredOutput after 3 attempts/);
    expect(r.rawEvents.match(/data: \[DONE\]/g)).toHaveLength(3);
  });

  it('a model that is not in the OpenCode config is infra', async () => {
    const { fetchImpl, sent } = fakeFetch([]);
    const r = await createOpenCodeProvider({ configPath: CONFIG, fetch: fetchImpl }).run(
      invocation({ model: 'qwen-local/nope' }),
    );
    expect(r).toMatchObject({ state: 'error', failureKind: 'infra' });
    expect(sent).toHaveLength(0);
  });

  it('AC-AGE-001-03 when time runs out the request is aborted and the failure is timeout; a cancelled signal gives cancelled', async () => {
    const hung = fakeFetch([], { hang: true });
    const timeout = await createOpenCodeProvider({ configPath: CONFIG, fetch: hung.fetchImpl }).run(invocation({ timeMs: 30 }));
    expect(timeout).toMatchObject({ state: 'error', failureKind: 'timeout' });
    const control = new AbortController();
    setTimeout(() => control.abort(), 30);
    const cancelled = await createOpenCodeProvider({ configPath: CONFIG, fetch: fakeFetch([], { hang: true }).fetchImpl }).run(
      invocation({ signal: control.signal }),
    );
    expect(cancelled).toMatchObject({ state: 'error', failureKind: 'cancelled' });
  });
});
