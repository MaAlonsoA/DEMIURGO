// Codex provider (ADR-AGE-001 v2): `codex exec` with the person's ChatGPT sign-in, structured
// output with `--output-schema`, the events streamed with `--json`, the composed system prompt as
// developer instructions, a read-only sandbox, the person's config and rules ignored, and every
// tool-like feature disabled. A session is resumed with `codex exec resume <id>`; without one it
// runs ephemeral in an empty temporary folder.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentResult,
  FailureKind,
  Provider,
  ProviderEvent,
  ProviderInvocation,
  ProviderModel,
  Usage,
} from '@demiurgo/domain';
import { type ClaudeExecutable, lineLength, resolveExecutable } from '../agents/claude-cli.ts';
import { type ProcessEnd, isExecutableNotFound, nodeLauncher } from '../agents/process.ts';
import { allowedEnv, processEnv } from '../env.ts';
import type { CliProviderOptions } from './claude.ts';
import { strictSchema } from './schema-variants.ts';
import { lineSplitter, messageOf, waitForOutcome } from './stream.ts';

export const CODEX_PROVIDER = 'codex';

/**
 * Tool-like features turned off (`codex features list`, 0.156.1): no shell, no file edits, no
 * images, no sub-agents, no apps, plugins, browser, computer use, hooks or memories.
 */
export const CODEX_DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'view_image',
  'image_generation',
  'multi_agent',
  'apps',
  'plugins',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'in_app_browser',
  'tool_suggest',
  'skill_search',
  'goals',
  'hooks',
  'sleep_tool',
  'memories',
] as const;

const WINDOWS_LINE_LIMIT = 32_000;
const DISCOVERY_TIME_MS = 15_000;

/** A JSON string is a valid TOML basic string (TOML only adds DEL to the characters to escape). */
export function tomlString(text: string): string {
  return JSON.stringify(text).replaceAll('\u007f', '\\u007f');
}

export function codexArguments(inv: ProviderInvocation, files: { schema: string; last: string }, cwd: string): string[] {
  const options = [
    '--json',
    '--output-schema',
    files.schema,
    '-o',
    files.last,
    '-m',
    inv.model,
    ...(inv.effort ? ['-c', `model_reasoning_effort=${tomlString(inv.effort)}`] : []),
    '-c',
    `developer_instructions=${tomlString(inv.system)}`,
    '-c',
    'sandbox_mode="read-only"',
    '-c',
    'web_search="disabled"',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    ...CODEX_DISABLED_FEATURES.flatMap((f) => ['--disable', f]),
    ...(inv.session.mode === 'none' ? ['--ephemeral'] : []),
  ];
  // `exec resume` has no -C: its folder is the process's working directory.
  if (inv.session.mode === 'resumed') return ['exec', 'resume', ...options, inv.session.id, '-'];
  return ['exec', ...options, '-C', cwd, '-'];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parse(line: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(line);
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

/** Normalized kind of one `codex exec --json` line. */
export function normalizeCodexEvent(line: string): ProviderEvent {
  const e = parse(line);
  if (!e) return { kind: 'error', raw: line };
  const type = typeof e.type === 'string' ? e.type : '';
  if (type === 'thread.started' || type === 'turn.started') return { kind: 'started', raw: line };
  if (type === 'turn.completed') {
    const usage = isObject(e.usage) ? e.usage : {};
    return typeof usage.output_tokens === 'number'
      ? { kind: 'usage', raw: line, tokens: usage.output_tokens }
      : { kind: 'usage', raw: line };
  }
  if (type === 'turn.failed' || type === 'error') return { kind: 'error', raw: line };
  if (type.startsWith('item.')) {
    const item = isObject(e.item) ? e.item : {};
    return { kind: item.type === 'reasoning' ? 'thinking' : 'message', raw: line };
  }
  return { kind: 'message', raw: line };
}

type Summary = {
  threadId?: string;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  reported: { input: boolean; cached: boolean; output: boolean; reasoning: boolean };
  turns: number;
  lastMessage?: string;
  error?: string;
};

function summarize(lines: readonly string[]): Summary {
  const s: Summary = {
    input: 0,
    cached: 0,
    output: 0,
    reasoning: 0,
    reported: { input: false, cached: false, output: false, reasoning: false },
    turns: 0,
  };
  for (const line of lines) {
    const e = parse(line);
    if (!e) continue;
    if (e.type === 'thread.started' && typeof e.thread_id === 'string') s.threadId = e.thread_id;
    if (e.type === 'turn.completed') {
      s.turns++;
      const u = isObject(e.usage) ? e.usage : {};
      const add = (field: string, key: 'input' | 'cached' | 'output' | 'reasoning') => {
        if (typeof u[field] === 'number') {
          s[key] += u[field];
          s.reported[key] = true;
        }
      };
      add('input_tokens', 'input');
      add('cached_input_tokens', 'cached');
      add('output_tokens', 'output');
      add('reasoning_output_tokens', 'reasoning');
    }
    if (e.type === 'item.completed' && isObject(e.item) && e.item.type === 'agent_message' && typeof e.item.text === 'string') {
      s.lastMessage = e.item.text;
    }
    if (e.type === 'turn.failed' && isObject(e.error) && typeof e.error.message === 'string') s.error = e.error.message;
    else if (e.type === 'error' && typeof e.message === 'string') s.error ??= e.message;
  }
  return s;
}

const from = (reported: boolean, field: string): string => (reported ? `codex:turn.completed.usage.${field}` : 'not_reported');

function usageOf(s: Summary, durationMs: number): Usage {
  return {
    inputTokens: s.input,
    outputTokens: s.output,
    durationMs,
    ...(s.reported.cached ? { cachedInputTokens: s.cached } : {}),
    ...(s.reported.reasoning ? { reasoningTokens: s.reasoning } : {}),
    turns: s.turns,
    provenance: {
      inputTokens: from(s.reported.input, 'input_tokens'),
      cachedInputTokens: from(s.reported.cached, 'cached_input_tokens'),
      outputTokens: from(s.reported.output, 'output_tokens'),
      reasoningTokens: from(s.reported.reasoning, 'reasoning_output_tokens'),
      turns: 'codex:turn.completed',
      durationMs: 'demiurgo:measured',
      declaredCostUsd: 'not_reported',
    },
  };
}

/** Models as `codex debug models` lists them: only those with `visibility: "list"`. */
export function parseCodexModels(text: string): ProviderModel[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  const models = isObject(value) && Array.isArray(value.models) ? value.models : [];
  return models.filter(isObject).flatMap((m) => {
    if (m.visibility !== 'list' || typeof m.slug !== 'string') return [];
    const levels = Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : [];
    const efforts = levels.flatMap((l) =>
      isObject(l) && typeof l.effort === 'string' ? [l.effort] : typeof l === 'string' ? [l] : [],
    );
    return [
      {
        id: m.slug,
        label: typeof m.display_name === 'string' ? m.display_name : m.slug,
        efforts,
        defaultEffort: typeof m.default_reasoning_level === 'string' ? m.default_reasoning_level : null,
      },
    ];
  });
}

function truncate(text: string, max = 1500): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function createCodexProvider(options: CliProviderOptions = {}): Provider {
  const launcher = options.launcher ?? nodeLauncher;
  const origin = () => options.environment ?? processEnv();
  let resolution: Promise<ClaudeExecutable | undefined> | undefined;
  const resolve = (): Promise<ClaudeExecutable | undefined> => {
    if (options.executable) return Promise.resolve({ executable: options.executable, previousArgs: [] });
    resolution ??= resolveExecutable('codex', origin()).then((r) => {
      if (!r) resolution = undefined;
      return r;
    });
    return resolution;
  };

  async function quick(executable: ClaudeExecutable, args: string[]): Promise<ProcessEnd | null> {
    try {
      const proc = launcher({
        executable: executable.executable,
        args: [...executable.previousArgs, ...args],
        cwd: options.temporaryDirectory ?? tmpdir(),
        env: allowedEnv(origin()),
        input: '',
      });
      const outcome = await waitForOutcome(proc, DISCOVERY_TIME_MS, undefined, options.terminationWaitMs);
      return outcome.type === 'end' ? outcome.end : null;
    } catch {
      return null;
    }
  }

  return {
    id: CODEX_PROVIDER,
    label: 'Codex',
    sessions: true,

    async discover() {
      const base = { provider: CODEX_PROVIDER, label: 'Codex', sessions: true } as const;
      const executable = await resolve();
      if (!executable) {
        return {
          ...base,
          installed: false,
          version: null,
          ready: false,
          message: "Codex (`codex`) isn't installed or isn't on the PATH.",
          models: [],
        };
      }
      const version = await quick(executable, ['--version']);
      const login = await quick(executable, ['login', 'status']);
      const models = await quick(executable, ['debug', 'models']);
      // It says so on stderr (0.156.1); stdout is read too in case that changes.
      const signedIn = login?.code === 0 && /^\s*logged in/im.test(`${login.stdout}\n${login.stderr}`);
      return {
        ...base,
        installed: version !== null,
        version: /(\d+\.\d+\.\d+\S*)/.exec(version?.stdout ?? '')?.[1] ?? null,
        ready: signedIn,
        message: signedIn ? null : "Codex isn't signed in: run `codex login`.",
        models: parseCodexModels(models?.stdout ?? ''),
      };
    },

    async run(inv) {
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
        provider: CODEX_PROVIDER,
        model: inv.model,
        ...(usage ? { usage } : {}),
      });
      if (inv.signal?.aborted) return error('cancelled', 'Run cancelled before launching Codex.');
      let temporary: string | undefined;
      try {
        const executable = await resolve();
        if (!executable) return error('infra', 'Codex (`codex`) was not found on the PATH.');
        temporary = await mkdtemp(join(options.temporaryDirectory ?? tmpdir(), 'demiurgo-codex-'));
        const files = { schema: join(temporary, 'schema.json'), last: join(temporary, 'last-message.json') };
        await writeFile(files.schema, JSON.stringify(strictSchema(inv.schema)), 'utf8');
        const cwd = inv.session.mode === 'none' ? temporary : inv.session.directory;
        if (inv.session.mode !== 'none') await mkdir(cwd, { recursive: true });
        const args = [...executable.previousArgs, ...codexArguments(inv, files, cwd)];
        if (process.platform === 'win32' && lineLength(executable.executable, args) > WINDOWS_LINE_LIMIT) {
          return error('infra', 'The Codex command line exceeds the Windows limit: shorten the agent.');
        }
        const start = Date.now();
        const proc = launcher({
          executable: executable.executable,
          args,
          cwd,
          env: allowedEnv(origin()),
          input: inv.input,
          onStdout: lineSplitter((line) => inv.onEvent?.(normalizeCodexEvent(line))),
        });
        const outcome = await waitForOutcome(proc, inv.timeMs, inv.signal, options.terminationWaitMs);
        if (outcome.type === 'cutoff') {
          return error(
            outcome.reason,
            outcome.reason === 'timeout'
              ? `No answer from Codex in ${Math.round(inv.timeMs / 1000)} s: the process was terminated.`
              : 'Run cancelled: Codex was terminated.',
            outcome.end?.stdout ?? '',
          );
        }
        if (outcome.type === 'failure') {
          return isExecutableNotFound(outcome.error)
            ? error('infra', `Codex was not found at "${executable.executable}".`)
            : error('infra', `Could not launch Codex: ${messageOf(outcome.error)}`);
        }
        const end = outcome.end;
        const lines = end.stdout
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const summary = summarize(lines);
        const usage = usageOf(summary, Date.now() - start);
        const last = await readFile(files.last, 'utf8').catch(() => '');
        const text = last.trim() || summary.lastMessage?.trim() || '';
        const withSession = (r: AgentResult): AgentResult => {
          const id = inv.session.mode === 'resumed' ? inv.session.id : summary.threadId;
          return inv.session.mode === 'none' || !id ? r : { ...r, sessionId: id };
        };
        if (!text) {
          const detail = summary.error ?? (end.stderr.trim() || `it ended with code ${end.code ?? 'unknown'}`);
          return withSession(error('agent_error', `Codex gave no final answer: ${truncate(detail)}`, end.stdout, usage));
        }
        let rawOutput: unknown;
        try {
          rawOutput = JSON.parse(text);
        } catch {
          return withSession(error('agent_error', `Codex's final answer is not JSON: ${truncate(text, 300)}`, end.stdout, usage));
        }
        if (end.code !== 0 && summary.error) {
          return withSession(error('agent_error', `Codex returned an error: ${truncate(summary.error)}`, end.stdout, usage));
        }
        return withSession({ state: 'ok', rawOutput, usage, rawEvents: end.stdout, provider: CODEX_PROVIDER, model: inv.model });
      } catch (e) {
        return isExecutableNotFound(e)
          ? error('infra', 'Codex (`codex`) was not found.')
          : error('infra', `Failed to prepare or launch Codex: ${messageOf(e)}`);
      } finally {
        if (temporary !== undefined) {
          await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
        }
      }
    },
  };
}
