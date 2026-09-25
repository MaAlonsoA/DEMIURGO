// Claude provider (ADR-AGE-001 v2): `claude -p` with the person's subscription, structured output
// with `--json-schema`, the events streamed with `--output-format stream-json`, and no tools, MCP,
// settings or CLAUDE.md. With a session it runs in the conversation's stable folder
// (`--session-id` the first time, `--resume` after); without one, in an empty temporary folder
// that is deleted, and nothing is saved.

import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentResult,
  type AgentResultDetails,
  CLI_ENV,
  type FailureKind,
  type Provider,
  type ProviderEvent,
  type ProviderInvocation,
  type ProviderModel,
  type ProviderTrace,
} from '@demiurgo/domain';
import {
  type ClaudeExecutable,
  lineLength,
  normalizeClaudeOutput,
  resolveClaudeExecutable,
  schemaForCli,
} from '../agents/claude-cli.ts';
import { type Launcher, type ProcessEnd, isExecutableNotFound, nodeLauncher } from '../agents/process.ts';
import { allowedEnv, otelResourceAttributes, processEnv } from '../env.ts';
import { lineSplitter, messageOf, waitForOutcome } from './stream.ts';

export const CLAUDE_PROVIDER = 'claude';

/** The aliases always point to the latest model of each family; the exact one is recorded after each run. */
export const CLAUDE_MODELS: readonly { id: string; label: string }[] = [
  { id: 'haiku', label: 'Haiku (latest)' },
  { id: 'sonnet', label: 'Sonnet (latest)' },
  { id: 'opus', label: 'Opus (latest)' },
  { id: 'fable', label: 'Fable (latest)' },
];

/**
 * Fixed isolation for every invocation:
 * - `--tools WebSearch`: only web search, pre-approved (no WebFetch: it could open local addresses such as
 *   the API or Postgres; no Bash, no reading or writing files).
 * - `--strict-mcp-config`: only the MCP servers from `--mcp-config`, and none is passed.
 * - `--safe-mode`: no CLAUDE.md, skills, plugins, hooks, MCP, agents or custom styles.
 * - `--setting-sources ""`: user, project and local settings aren't read.
 * `--bare` doesn't work: it requires ANTHROPIC_API_KEY and doesn't read the subscription.
 */
export const CLAUDE_ISOLATION_FLAGS = [
  '--tools',
  'WebSearch',
  '--allowedTools',
  'WebSearch',
  '--strict-mcp-config',
  '--safe-mode',
  '--setting-sources',
  '',
] as const;

/** CreateProcess allows 32,767 characters; margin is left for the quotes Node adds. */
const WINDOWS_LINE_LIMIT = 32_000;
const DISCOVERY_TIME_MS = 15_000;

export type CliProviderOptions = {
  /** Absolute path to the executable. If missing, it is looked up on the PATH. */
  executable?: string;
  /** Injectable launcher: tests replace it so they don't call the real CLI. */
  launcher?: Launcher;
  /** Source environment filtered through the allow list (defaults to the process's own). */
  environment?: Readonly<Record<string, string | undefined>>;
  /** Folder where temporary directories are created (defaults to `os.tmpdir()`). */
  temporaryDirectory?: string;
  /** Wait after ordering termination before giving up on the process. */
  terminationWaitMs?: number;
};

export function claudeArguments(inv: ProviderInvocation, sessionId: string | null): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--json-schema',
    JSON.stringify(schemaForCli(inv.schema)),
    ...CLAUDE_ISOLATION_FLAGS,
    '--model',
    inv.model,
  ];
  if (inv.effort) args.push('--effort', inv.effort);
  args.push('--system-prompt', inv.system);
  if (inv.session.mode === 'resumed') args.push('--resume', inv.session.id);
  else if (inv.session.mode === 'fresh' && sessionId) {
    args.push('--session-id', sessionId);
    // The visible name in the CLI's own session listing (§5.4).
    if (inv.session.name) args.push('--name', inv.session.name);
  } else args.push('--no-session-persistence');
  return args;
}

/**
 * The telemetry of the child (§7.6), computed per call and never inherited: Claude Code reads
 * `TRACEPARENT` and exports its own traces and logs to the collector, tagged with the call.
 */
export function claudeTelemetryEnv(trace: ProviderTrace | undefined): Record<string, string> {
  if (!trace) return {};
  return {
    [CLI_ENV.traceParent]: trace.traceParent,
    [CLI_ENV.resourceAttributes]: otelResourceAttributes(trace.resourceAttributes),
    [CLI_ENV.claudeTelemetry]: '1',
    [CLI_ENV.claudeEnhancedTelemetry]: '1',
    [CLI_ENV.tracesExporter]: 'otlp',
    [CLI_ENV.logsExporter]: 'otlp',
    [CLI_ENV.metricsExporter]: 'none',
    [CLI_ENV.otlpProtocol]: 'http/protobuf',
    ...(trace.otlpEndpoint ? { [CLI_ENV.otlpEndpoint]: trace.otlpEndpoint } : {}),
  };
}

const numberOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const stringOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * What the stream says beyond the product's `Usage` (§7.6): the CLI's version from `init`, the
 * whole `result` line as the raw usage, its times and stop reason, and the pieces that were thrown
 * away until now (`modelUsage`, `permission_denials`, the cache creation by TTL).
 */
export function claudeDetails(
  objects: readonly Record<string, unknown>[],
  command: { args: readonly string[]; cwd: string },
  end: ProcessEnd | undefined,
): AgentResultDetails {
  const init = objects.find((o) => o.type === 'system' && o.subtype === 'init');
  const result = objects.findLast((o) => o.type === 'result');
  const lastMessage = objects.findLast((o) => o.type === 'assistant' && isObject(o.message))?.message as
    | Record<string, unknown>
    | undefined;
  const usage = result && isObject(result.usage) ? result.usage : undefined;
  const extra: Record<string, unknown> = {};
  if (result?.modelUsage !== undefined) extra.modelUsage = result.modelUsage;
  if (result?.permission_denials !== undefined) extra.permission_denials = result.permission_denials;
  if (usage?.cache_creation !== undefined) extra.cache_creation = usage.cache_creation;
  const details: AgentResultDetails = {
    cliCommand: [...command.args],
    cliCwd: command.cwd,
    ...(end ? { exitCode: end.code, stderr: end.stderr } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
  const cliVersion = stringOf(init?.claude_code_version);
  if (cliVersion !== undefined) details.cliVersion = cliVersion;
  if (result !== undefined) details.rawUsage = result;
  const durationApiMs = numberOf(result?.duration_api_ms);
  if (durationApiMs !== undefined) details.durationApiMs = durationApiMs;
  const ttftMs = numberOf(result?.ttft_ms);
  if (ttftMs !== undefined) details.ttftMs = ttftMs;
  const stopReason = stringOf(result?.stop_reason) ?? stringOf(lastMessage?.stop_reason);
  if (stopReason !== undefined) details.stopReason = stopReason;
  return details;
}

/** Levels of `--effort` as `claude --help` lists them: "(low, medium, high, xhigh, max)". */
export function parseClaudeEfforts(help: string): string[] {
  const m = /--effort <level>[\s\S]*?\(([^)]*)\)/.exec(help);
  return m?.[1]
    ? m[1]
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
    : [];
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

/** Normalized kind of one `stream-json` line. */
export function normalizeClaudeEvent(line: string): ProviderEvent {
  const e = parse(line);
  if (!e) return { kind: 'error', raw: line };
  const message = isObject(e.message) ? e.message : {};
  const usage = isObject(message.usage) ? message.usage : isObject(e.usage) ? e.usage : {};
  const tokens = typeof usage.output_tokens === 'number' ? { tokens: usage.output_tokens } : {};
  switch (e.type) {
    case 'system':
      // While it thinks, the CLI estimates the thinking tokens so far (2.1.282): that is the live progress.
      if (e.subtype === 'thinking_tokens' && typeof e.estimated_tokens === 'number') {
        return { kind: 'thinking', raw: line, tokens: e.estimated_tokens };
      }
      return { kind: 'started', raw: line };
    case 'rate_limit_event':
      return { kind: 'usage', raw: line };
    case 'assistant': {
      const content = Array.isArray(message.content) ? message.content : [];
      const thinking = content.some((c) => isObject(c) && (c.type === 'thinking' || c.type === 'redacted_thinking'));
      return { kind: thinking ? 'thinking' : 'message', raw: line, ...tokens };
    }
    case 'result':
      return { kind: 'result', raw: line, ...tokens };
    default:
      return { kind: 'message', raw: line };
  }
}

function sessionOf(lines: readonly string[]): string | undefined {
  for (const line of lines) {
    const e = parse(line);
    if (e && typeof e.session_id === 'string') return e.session_id;
  }
  return undefined;
}

export function createClaudeProvider(options: CliProviderOptions = {}): Provider {
  const launcher = options.launcher ?? nodeLauncher;
  const origin = () => options.environment ?? processEnv();
  let resolution: Promise<ClaudeExecutable | undefined> | undefined;
  const resolve = (): Promise<ClaudeExecutable | undefined> => {
    if (options.executable) return Promise.resolve({ executable: options.executable, previousArgs: [] });
    resolution ??= resolveClaudeExecutable(origin()).then((r) => {
      if (!r) resolution = undefined;
      return r;
    });
    return resolution;
  };

  /** Short command with no model call (version, sign-in, help). */
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
    id: CLAUDE_PROVIDER,
    label: 'Claude',
    sessions: true,

    async discover() {
      const base = { provider: CLAUDE_PROVIDER, label: 'Claude', sessions: true } as const;
      const executable = await resolve();
      if (!executable) {
        return {
          ...base,
          installed: false,
          version: null,
          ready: false,
          message: "Claude Code (`claude`) isn't installed or isn't on the PATH.",
          models: [],
        };
      }
      const [version, auth, help] = [
        await quick(executable, ['--version']),
        await quick(executable, ['auth', 'status']),
        await quick(executable, ['--help']),
      ];
      const signedIn = (() => {
        try {
          return (JSON.parse(auth?.stdout ?? '') as { loggedIn?: unknown }).loggedIn === true;
        } catch {
          return false;
        }
      })();
      const efforts = parseClaudeEfforts(help?.stdout ?? '');
      const models: ProviderModel[] = CLAUDE_MODELS.map((m) => ({ ...m, efforts, defaultEffort: null }));
      return {
        ...base,
        installed: version !== null,
        version: /^(\S+)/.exec(version?.stdout.trim() ?? '')?.[1] ?? null,
        ready: signedIn,
        message: signedIn ? null : "Claude isn't signed in: run `claude auth login`.",
        models,
        ...(help?.code === 0 && efforts.length > 0 ? {} : { listed: false }),
      };
    },

    async run(inv) {
      // What is known of the launch so far: it travels with every outcome, even a failed one.
      let details: AgentResultDetails | undefined;
      const error = (failureKind: Exclude<FailureKind, 'invalid_output'>, message: string, rawEvents = ''): AgentResult => ({
        state: 'error',
        failureKind,
        message,
        rawEvents,
        provider: CLAUDE_PROVIDER,
        model: inv.model,
        ...(details ? { details } : {}),
      });
      if (inv.signal?.aborted) return error('cancelled', 'Run cancelled before launching the Claude CLI.');
      let temporary: string | undefined;
      try {
        const executable = await resolve();
        if (!executable) return error('infra', 'The Claude CLI (`claude`) was not found on the PATH.');
        // The engine decides the id of a new session (§5.4); without one, the adapter does.
        const ownSession = inv.session.mode === 'fresh' ? (inv.session.id ?? randomUUID()) : null;
        const args = [...executable.previousArgs, ...claudeArguments(inv, ownSession)];
        if (process.platform === 'win32' && lineLength(executable.executable, args) > WINDOWS_LINE_LIMIT) {
          return error('infra', 'The Claude CLI command line exceeds the Windows limit: shorten the agent or the schema.');
        }
        let cwd: string;
        if (inv.session.mode === 'none') {
          temporary = await mkdtemp(join(options.temporaryDirectory ?? tmpdir(), 'demiurgo-claude-'));
          cwd = temporary;
        } else {
          cwd = inv.session.directory;
          await mkdir(cwd, { recursive: true });
        }
        details = claudeDetails([], { args, cwd }, undefined);
        const lines: string[] = [];
        const start = Date.now();
        const proc = launcher({
          executable: executable.executable,
          args,
          cwd,
          env: allowedEnv(origin(), [], claudeTelemetryEnv(inv.trace)),
          input: inv.input,
          onStdout: lineSplitter((line) => {
            lines.push(line);
            inv.onEvent?.(normalizeClaudeEvent(line));
          }),
        });
        const outcome = await waitForOutcome(proc, inv.timeMs, inv.signal, options.terminationWaitMs);
        // What the process printed (partial if it was cut off), or what arrived line by line.
        const rawEvents = () => (outcome.type === 'failure' ? lines.join('\n') : (outcome.end?.stdout ?? lines.join('\n')));
        const objectsOf = (stdout: string) =>
          stdout
            .split('\n')
            .map((l) => l.trim())
            .flatMap((l) => {
              const o = parse(l);
              return o ? [{ line: l, object: o }] : [];
            });
        switch (outcome.type) {
          case 'cutoff':
            details = claudeDetails(
              objectsOf(rawEvents()).map((x) => x.object),
              { args, cwd },
              outcome.end,
            );
            return error(
              outcome.reason,
              outcome.reason === 'timeout'
                ? `No answer from Claude in ${Math.round(inv.timeMs / 1000)} s: the process was terminated.`
                : 'Run cancelled: the Claude CLI was terminated.',
              rawEvents(),
            );
          case 'failure':
            return isExecutableNotFound(outcome.error)
              ? error('infra', `The Claude CLI was not found at "${executable.executable}".`)
              : error('infra', `Could not launch the Claude CLI: ${messageOf(outcome.error)}`);
          case 'end': {
            // The whole stdout (not only the streamed lines): the last line may have no newline.
            const parsed = objectsOf(outcome.end.stdout);
            const all = parsed.map((x) => x.line);
            details = claudeDetails(
              parsed.map((x) => x.object),
              { args, cwd },
              outcome.end,
            );
            const result: AgentResult = {
              ...normalizeClaudeOutput({ ...outcome.end, stdout: `[${all.join(',')}]` }, inv.model, Date.now() - start, {
                provider: CLAUDE_PROVIDER,
                detailed: true,
                rawEvents: outcome.end.stdout,
              }),
              details,
            };
            const sessionId = inv.session.mode === 'resumed' ? inv.session.id : (ownSession ?? sessionOf(all));
            return inv.session.mode === 'none' || !sessionId ? result : { ...result, sessionId };
          }
        }
      } catch (e) {
        return isExecutableNotFound(e)
          ? error('infra', 'The Claude CLI (`claude`) was not found.')
          : error('infra', `Failed to prepare or launch the Claude CLI: ${messageOf(e)}`);
      } finally {
        if (temporary !== undefined) {
          await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
        }
      }
    },
  };
}
