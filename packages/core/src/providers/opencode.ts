// OpenCode provider (ADR-AGE-001 v2): the local models the person configured in OpenCode (such as
// Qwen served by NInfer). OpenCode 2 has no structured output and NInfer rejects constrained output
// (`response_format: json_schema`, and any forced `tool_choice`), so the model is called at its
// OpenAI-compatible endpoint with a `StructuredOutput` tool whose parameters are the schema: the
// same mechanism OpenCode 1 and `claude --json-schema` use. If the model doesn't call it, the
// request is retried with a correction, up to 2 more times. Zod still judges the output. There is
// no provider session: every run sends the whole context.

import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type {
  AgentResult,
  AgentResultDetails,
  FailureKind,
  Provider,
  ProviderEvent,
  ProviderModel,
  Usage,
} from '@demiurgo/domain';
import { type ClaudeExecutable, resolveExecutable } from '../agents/claude-cli.ts';
import { type Launcher, nodeLauncher } from '../agents/process.ts';
import { allowedEnv, processEnv } from '../env.ts';
import { messageOf, waitForOutcome } from './stream.ts';

export const OPENCODE_PROVIDER = 'opencode';
const LABEL = 'OpenCode';
const TOOL = 'StructuredOutput';
const CORRECTION = `You must deliver the answer by calling the ${TOOL} tool exactly once, with arguments that match its schema.`;
const HEALTH_TIME_MS = 3000;
/** Thinking events while the model reasons: at most one per second. */
const THINKING_EVERY_MS = 1000;

export type OpenCodeOptions = {
  /** OpenCode's config file (`opencode.json`), read-only. */
  configPath: string;
  fetch?: typeof fetch;
  executable?: string;
  launcher?: Launcher;
  environment?: Readonly<Record<string, string | undefined>>;
  /** Attempts per run: the first plus the retries when the model doesn't call the tool. */
  maxAttempts?: number;
};

type Options = Readonly<Record<string, unknown>>;

export type OpenCodeModel = {
  providerKey: string;
  providerName: string;
  baseURL: string;
  modelKey: string;
  model: ProviderModel;
  options: Options;
  variants: Readonly<Record<string, Options>>;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const sameOptions = (a: Options, b: Options): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The models of the OpenAI-compatible providers in an OpenCode config, with their variants as efforts. */
export function openCodeModels(config: unknown): OpenCodeModel[] {
  const providers = isObject(config) && isObject(config.provider) ? config.provider : {};
  const result: OpenCodeModel[] = [];
  for (const [providerKey, p] of Object.entries(providers)) {
    if (!isObject(p) || p.npm !== '@ai-sdk/openai-compatible') continue;
    const baseURL = isObject(p.options) && typeof p.options.baseURL === 'string' ? p.options.baseURL.replace(/\/+$/, '') : '';
    if (!baseURL) continue;
    const providerName = typeof p.name === 'string' ? p.name : providerKey;
    for (const [modelKey, m] of Object.entries(isObject(p.models) ? p.models : {})) {
      if (!isObject(m)) continue;
      const options = isObject(m.options) ? m.options : {};
      const variants = Object.fromEntries(
        Object.entries(isObject(m.variants) ? m.variants : {}).filter((e): e is [string, Record<string, unknown>] =>
          isObject(e[1]),
        ),
      );
      const efforts = Object.keys(variants);
      result.push({
        providerKey,
        providerName,
        baseURL,
        modelKey,
        options,
        variants,
        model: {
          id: `${providerKey}/${modelKey}`,
          label: typeof m.name === 'string' ? m.name : modelKey,
          efforts,
          defaultEffort: efforts.find((e) => sameOptions(variants[e] ?? {}, options)) ?? null,
        },
      });
    }
  }
  return result;
}

const snake = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Chat request with the schema as the parameters of the StructuredOutput tool (never response_format). */
export function chatRequest(p: {
  model: string;
  system: string;
  input: string;
  schema: Record<string, unknown>;
  options: Options;
  history?: readonly { role: string; content: string }[];
}): Record<string, unknown> {
  const { $schema: _, ...parameters } = p.schema;
  return {
    ...Object.fromEntries(Object.entries(p.options).map(([k, v]) => [snake(k), v])),
    model: p.model,
    messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.input }, ...(p.history ?? [])],
    tools: [
      {
        type: 'function',
        function: {
          name: TOOL,
          description: 'Deliver the final answer with the required shape. Call it exactly once.',
          parameters,
        },
      },
    ],
    tool_choice: 'auto',
    stream: true,
    stream_options: { include_usage: true },
  };
}

type Attempt = {
  raw: string;
  content: string;
  toolArguments: string | null;
  model: string | null;
  usage: Record<string, unknown> | null;
  finishReason: string | null;
  systemFingerprint: string | null;
  chunkId: string | null;
};

/** Reads the SSE stream of one chat completion, emitting normalized events as it goes. */
async function readStream(response: Response, emit: (e: ProviderEvent) => void): Promise<Attempt> {
  const attempt: Attempt = {
    raw: '',
    content: '',
    toolArguments: null,
    model: null,
    usage: null,
    finishReason: null,
    systemFingerprint: null,
    chunkId: null,
  };
  const decoder = new TextDecoder('utf-8');
  let pending = '';
  let thinkingTokens = 0;
  let lastThinking = 0;
  const handle = (line: string) => {
    if (!line.startsWith('data: ')) return;
    const data = line.slice(6).trim();
    if (data === '[DONE]') return;
    let chunk: unknown;
    try {
      chunk = JSON.parse(data);
    } catch {
      emit({ kind: 'error', raw: data });
      return;
    }
    if (!isObject(chunk)) return;
    if (typeof chunk.model === 'string') attempt.model = chunk.model;
    if (isObject(chunk.usage)) attempt.usage = chunk.usage;
    if (typeof chunk.system_fingerprint === 'string') attempt.systemFingerprint = chunk.system_fingerprint;
    if (typeof chunk.id === 'string') attempt.chunkId = chunk.id;
    const choice = Array.isArray(chunk.choices) && isObject(chunk.choices[0]) ? chunk.choices[0] : null;
    if (typeof choice?.finish_reason === 'string') attempt.finishReason = choice.finish_reason;
    const delta = choice && isObject(choice.delta) ? choice.delta : {};
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      thinkingTokens++;
      const now = Date.now();
      if (now - lastThinking >= THINKING_EVERY_MS) {
        lastThinking = now;
        emit({ kind: 'thinking', raw: data, tokens: thinkingTokens });
      }
    }
    if (typeof delta.content === 'string') attempt.content += delta.content;
    for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const fn = isObject(call) && isObject(call.function) ? call.function : null;
      if (!fn) continue;
      if (fn.name === TOOL || attempt.toolArguments !== null) {
        attempt.toolArguments = (attempt.toolArguments ?? '') + (typeof fn.arguments === 'string' ? fn.arguments : '');
      }
    }
    if (choice?.finish_reason === 'tool_calls' || choice?.finish_reason === 'stop') {
      emit({ kind: 'message', raw: data });
    }
  };
  const reader = response.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      attempt.raw += text;
      pending += text;
      let at = pending.indexOf('\n');
      while (at >= 0) {
        handle(pending.slice(0, at).replace(/\r$/, ''));
        pending = pending.slice(at + 1);
        at = pending.indexOf('\n');
      }
    }
    if (pending.trim()) handle(pending.trim());
  }
  if (attempt.usage) {
    const out = attempt.usage.completion_tokens;
    emit(
      typeof out === 'number'
        ? { kind: 'usage', raw: JSON.stringify(attempt.usage), tokens: out }
        : { kind: 'usage', raw: JSON.stringify(attempt.usage) },
    );
  }
  return attempt;
}

/** Parses the tool's arguments: the output, or null if the model didn't deliver valid JSON. */
function outputOf(attempt: Attempt): { ok: true; value: unknown } | { ok: false } {
  if (attempt.toolArguments === null) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(attempt.toolArguments) };
  } catch {
    return { ok: false };
  }
}

const details = (u: Record<string, unknown>, key: string): Record<string, unknown> => (isObject(u[key]) ? u[key] : {});

/** How each attempt ended: the tool was called with valid JSON, not called, or called with broken JSON. */
function attemptOutcome(a: Attempt): 'ok' | 'no_tool_call' | 'invalid_json' {
  if (a.toolArguments === null) return 'no_tool_call';
  return outputOf(a).ok ? 'ok' : 'invalid_json';
}

/** The evidence of the call (§7.6): the last usage as it came, the attempts with their reasons, and the stream's ids. */
function detailsOf(attempts: readonly Attempt[]): AgentResultDetails {
  const last = attempts.at(-1);
  return {
    ...(last?.usage ? { rawUsage: last.usage } : {}),
    attempts: attempts.map((a, i) => ({
      attempt: i + 1,
      model: a.model,
      finishReason: a.finishReason,
      usage: a.usage,
      outcome: attemptOutcome(a),
    })),
    extra: {
      finishReason: last?.finishReason ?? null,
      systemFingerprint: last?.systemFingerprint ?? null,
      chunkId: last?.chunkId ?? null,
    },
  };
}

const from = (v: number | null, field: string): string => (v === null ? 'not_reported' : `opencode:usage.${field}`);

function usageOf(attempts: readonly Attempt[], durationMs: number): Usage {
  const sum = (read: (u: Record<string, unknown>) => unknown): number | null => {
    let total: number | null = null;
    for (const a of attempts) {
      const v = a.usage ? read(a.usage) : undefined;
      if (typeof v === 'number') total = (total ?? 0) + v;
    }
    return total;
  };
  const input = sum((u) => u.prompt_tokens);
  const cached = sum((u) => details(u, 'prompt_tokens_details').cached_tokens);
  const output = sum((u) => u.completion_tokens);
  const reasoning = sum((u) => details(u, 'completion_tokens_details').reasoning_tokens);
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    durationMs,
    ...(cached === null ? {} : { cachedInputTokens: cached }),
    ...(reasoning === null ? {} : { reasoningTokens: reasoning }),
    turns: attempts.length,
    provenance: {
      inputTokens: from(input, 'prompt_tokens'),
      cachedInputTokens: from(cached, 'prompt_tokens_details.cached_tokens'),
      outputTokens: from(output, 'completion_tokens'),
      reasoningTokens: from(reasoning, 'completion_tokens_details.reasoning_tokens'),
      turns: 'demiurgo:requests',
      durationMs: 'demiurgo:measured',
      declaredCostUsd: 'not_reported',
    },
  };
}

export function createOpenCodeProvider(options: OpenCodeOptions): Provider {
  const fetchImpl = options.fetch ?? fetch;
  const launcher = options.launcher ?? nodeLauncher;
  const maxAttempts = options.maxAttempts ?? 3;
  const origin = () => options.environment ?? processEnv();

  async function readConfig(): Promise<{ ok: true; models: OpenCodeModel[] } | { ok: false; message: string }> {
    let text: string;
    try {
      text = await readFile(options.configPath, 'utf8');
    } catch {
      return { ok: false, message: `No OpenCode config at ${options.configPath}.` };
    }
    try {
      // opencode.json may carry a BOM and full-line comments (JSONC).
      const clean = text.replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, '');
      return { ok: true, models: openCodeModels(JSON.parse(clean)) };
    } catch (e) {
      return { ok: false, message: `The OpenCode config at ${options.configPath} can't be read: ${messageOf(e)}` };
    }
  }

  async function version(): Promise<string | null> {
    try {
      const executable: ClaudeExecutable | undefined = options.executable
        ? { executable: options.executable, previousArgs: [] }
        : await resolveExecutable('opencode', origin());
      if (!executable) return null;
      const proc = launcher({
        executable: executable.executable,
        args: [...executable.previousArgs, '--version'],
        cwd: tmpdir(),
        env: allowedEnv(origin()),
        input: '',
      });
      const outcome = await waitForOutcome(proc, 15_000, undefined);
      return outcome.type === 'end' ? (/(\d+\.\d+\.\d+\S*)/.exec(outcome.end.stdout)?.[1] ?? null) : null;
    } catch {
      return null;
    }
  }

  async function answers(baseURL: string): Promise<boolean> {
    try {
      const r = await fetchImpl(`${baseURL}/models`, { signal: AbortSignal.timeout(HEALTH_TIME_MS) });
      return r.ok;
    } catch {
      return false;
    }
  }

  return {
    id: OPENCODE_PROVIDER,
    label: LABEL,
    sessions: false,

    async discover() {
      const base = { provider: OPENCODE_PROVIDER, label: LABEL, sessions: false } as const;
      const config = await readConfig();
      const v = await version();
      if (!config.ok) return { ...base, installed: false, version: v, ready: false, message: config.message, models: [] };
      const endpoints = [...new Map(config.models.map((m) => [m.baseURL, m.providerName])).entries()];
      const down: string[] = [];
      for (const [url, name] of endpoints) if (!(await answers(url))) down.push(`${name} isn't answering at ${url}.`);
      const models = config.models.map((m) => m.model);
      return {
        ...base,
        installed: true,
        version: v,
        ready: models.length > 0 && down.length === 0,
        message: models.length === 0 ? 'Your OpenCode config has no OpenAI-compatible local model.' : down.join(' ') || null,
        models,
      };
    },

    async run(inv) {
      const attempts: Attempt[] = [];
      const error = (
        failureKind: Exclude<FailureKind, 'invalid_output'>,
        message: string,
        rawEvents = '',
        usage?: Usage,
      ): AgentResult => ({
        state: 'error',
        failureKind,
        message,
        rawEvents,
        provider: OPENCODE_PROVIDER,
        model: inv.model,
        ...(usage ? { usage } : {}),
        ...(attempts.length > 0 ? { details: detailsOf(attempts) } : {}),
      });
      if (inv.signal?.aborted) return error('cancelled', 'Run cancelled before calling the local model.');
      const config = await readConfig();
      if (!config.ok) return error('infra', config.message);
      const entry = config.models.find((m) => m.model.id === inv.model);
      if (!entry) return error('infra', `${inv.model} isn't in your OpenCode config any more. Choose another model.`);
      const variant = inv.effort ? entry.variants[inv.effort] : undefined;
      if (inv.effort && !variant) return error('infra', `${inv.model} has no "${inv.effort}" variant in your OpenCode config.`);
      const requestOptions = { ...entry.options, ...variant };

      const control = new AbortController();
      let reason: 'timeout' | 'cancelled' | null = null;
      const timer = setTimeout(() => {
        reason = 'timeout';
        control.abort();
      }, inv.timeMs);
      const onAbort = () => {
        reason ??= 'cancelled';
        control.abort();
      };
      inv.signal?.addEventListener('abort', onAbort, { once: true });
      const emit = (e: ProviderEvent) => inv.onEvent?.(e);
      const history: { role: string; content: string }[] = [];
      const start = Date.now();
      const raw = () => attempts.map((a) => a.raw).join('\n');
      try {
        for (let n = 1; n <= maxAttempts; n++) {
          emit({ kind: 'started', raw: JSON.stringify({ type: 'request', attempt: n, model: entry.modelKey }) });
          const body = chatRequest({
            model: entry.modelKey,
            system: inv.system,
            input: inv.input,
            schema: inv.schema,
            options: requestOptions,
            history,
          });
          const response = await fetchImpl(`${entry.baseURL}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
            body: JSON.stringify(body),
            signal: control.signal,
          });
          if (!response.ok) {
            const detail = (await response.text().catch(() => '')).slice(0, 1000);
            return error(
              'agent_error',
              `${entry.providerName} answered HTTP ${response.status}: ${detail}`,
              raw(),
              usageOf(attempts, Date.now() - start),
            );
          }
          const attempt = await readStream(response, emit);
          attempts.push(attempt);
          const output = outputOf(attempt);
          if (output.ok) {
            return {
              state: 'ok',
              rawOutput: output.value,
              usage: usageOf(attempts, Date.now() - start),
              rawEvents: raw(),
              provider: OPENCODE_PROVIDER,
              model: attempt.model ?? entry.modelKey,
              details: detailsOf(attempts),
            };
          }
          history.push(
            { role: 'assistant', content: (attempt.content || attempt.toolArguments || '').slice(0, 4000) },
            { role: 'user', content: CORRECTION },
          );
        }
        return error(
          'agent_error',
          `${entry.providerName} didn't call ${TOOL} after ${maxAttempts} attempts.`,
          raw(),
          usageOf(attempts, Date.now() - start),
        );
      } catch (e) {
        if (reason === 'timeout') {
          return error('timeout', `No answer from ${entry.providerName} in ${Math.round(inv.timeMs / 1000)} s.`, raw());
        }
        if (reason === 'cancelled') return error('cancelled', 'Run cancelled: the request was aborted.', raw());
        return error('infra', `Could not reach ${entry.providerName} at ${entry.baseURL}: ${messageOf(e)}`, raw());
      } finally {
        clearTimeout(timer);
        inv.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
