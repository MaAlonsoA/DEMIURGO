// Claude provider over `claude -p --output-format stream-json`. A scripted launcher replays the
// fixtures in `fixtures/claude/` (the stream ones are built from a recorded result: see their
// `synthetic` suffix): the real CLI is never called.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI_ENV, type ProviderEvent, type ProviderInvocation, type ProviderTrace, jsonSchemaOf } from '@demiurgo/domain';
import { afterAll, describe, expect, it } from 'vitest';
import { schemaForCli } from '../src/agents/claude-cli.ts';
import {
  CLAUDE_MODELS,
  claudeArguments,
  claudeTelemetryEnv,
  createClaudeProvider,
  parseClaudeEfforts,
} from '../src/providers/claude.ts';
import { SENSITIVE_VARIABLES, fixture, scriptedLauncher, valueOf } from './support/launchers.ts';

const folders: string[] = [];
afterAll(() => {
  for (const f of folders) rmSync(f, { recursive: true, force: true });
});
const sessionFolder = (): string => {
  const f = mkdtempSync(join(tmpdir(), 'dmg-claude-session-'));
  folders.push(f);
  return f;
};

const ECHO = 'Hola, DEMIURGO: esto es una prueba de eco grabada como fixture.';

const invocation = (over: Partial<ProviderInvocation> = {}): ProviderInvocation => ({
  system: 'You echo.\n\n## DEMIURGO rules for this run',
  input: 'Action: echo\n<untrusted_context>\n{}\n</untrusted_context>',
  schema: jsonSchemaOf('echo'),
  model: 'haiku',
  effort: 'high',
  session: { mode: 'none' },
  timeMs: 60_000,
  ...over,
});

/** The parent's own telemetry: it must never reach the child. */
const PARENT_TELEMETRY = {
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://parent:4318',
  OTEL_RESOURCE_ATTRIBUTES: 'service.name=parent',
  TRACEPARENT: '00-11111111111111111111111111111111-2222222222222222-01',
};
const environment = { PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\ana', ...SENSITIVE_VARIABLES, ...PARENT_TELEMETRY };
const provider = (launcher: ReturnType<typeof scriptedLauncher>['launcher']) =>
  createClaudeProvider({ launcher, executable: 'claude', environment });

const TRACE: ProviderTrace = {
  traceParent: '00-0199a2130000700080000000000000ab-00f067aa0ba902b7-01',
  resourceAttributes: { 'demiurgo.call.id': 'call-1', 'demiurgo.run.id': 'run-1', 'deployment.environment.name': 'test' },
  otlpEndpoint: 'http://127.0.0.1:4318',
  environment: 'test',
};

describe('Claude provider', () => {
  it('a fresh session uses the id and name the engine decided', async () => {
    const directory = sessionFolder();
    const { launcher, calls } = scriptedLauncher(() => ({ stdout: fixture('claude/stream-ok.synthetic.jsonl') }));
    const id = '0199a213-81c0-4800-8aa1-bbab2a035a53';
    const r = await provider(launcher).run(
      invocation({ session: { mode: 'fresh', directory, id, name: 'demiurgo explorer 0199a213' } }),
    );
    const args = calls[0]?.command.args ?? [];
    expect(valueOf(args, '--session-id')).toBe(id);
    expect(valueOf(args, '--name')).toBe('demiurgo explorer 0199a213');
    expect(r.sessionId).toBe(id);
    expect(claudeArguments(invocation({ session: { mode: 'fresh', directory, id } }), id)).not.toContain('--name');
  });

  it("with a trace the child gets the OTel variables per call; without one, none, and never the parent's", async () => {
    const { launcher, calls } = scriptedLauncher(() => ({ stdout: fixture('claude/stream-ok.synthetic.jsonl') }));
    await provider(launcher).run(invocation({ trace: TRACE }));
    const traced = calls[0]?.command.env ?? {};
    expect(traced).toMatchObject({
      [CLI_ENV.traceParent]: TRACE.traceParent,
      [CLI_ENV.resourceAttributes]: 'demiurgo.call.id=call-1,demiurgo.run.id=run-1,deployment.environment.name=test',
      [CLI_ENV.otlpEndpoint]: 'http://127.0.0.1:4318',
      [CLI_ENV.otlpProtocol]: 'http/protobuf',
      [CLI_ENV.tracesExporter]: 'otlp',
      [CLI_ENV.logsExporter]: 'otlp',
      [CLI_ENV.metricsExporter]: 'none',
      [CLI_ENV.claudeTelemetry]: '1',
      [CLI_ENV.claudeEnhancedTelemetry]: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    });
    expect(traced[CLI_ENV.resourceAttributes]).not.toContain('parent');

    await provider(launcher).run(invocation());
    const plain = calls[1]?.command.env ?? {};
    expect(Object.keys(plain).filter((key) => key.toUpperCase().startsWith('OTEL_'))).toEqual([]);
    expect(plain).not.toHaveProperty(CLI_ENV.traceParent);
    expect(plain).not.toHaveProperty(CLI_ENV.claudeTelemetry);
    expect(claudeTelemetryEnv(undefined)).toEqual({});
    expect(claudeTelemetryEnv({ ...TRACE, otlpEndpoint: null })).not.toHaveProperty(CLI_ENV.otlpEndpoint);
  });

  it('the details carry what the stream says: version, argv, cwd, exit code, times, stop reason and the raw result', async () => {
    const { launcher, calls } = scriptedLauncher(() => ({ stdout: fixture('claude/stream-ok.synthetic.jsonl'), stderr: 'warn' }));
    const r = await provider(launcher).run(invocation());
    expect(r.state).toBe('ok');
    expect(r.details).toMatchObject({
      cliVersion: '2.1.282',
      cliCommand: calls[0]?.command.args,
      cliCwd: calls[0]?.command.cwd,
      exitCode: 0,
      stderr: 'warn',
      durationApiMs: 3610,
      ttftMs: 3267,
      stopReason: 'tool_use',
      rawUsage: expect.objectContaining({ type: 'result', usage: expect.objectContaining({ input_tokens: 1500 }) }),
      extra: expect.objectContaining({
        modelUsage: expect.any(Object),
        permission_denials: [],
        cache_creation: expect.any(Object),
      }),
    });
    const failed = scriptedLauncher(() => ({ stdout: fixture('claude/stream-error.synthetic.jsonl'), code: 1 }));
    const e = await provider(failed.launcher).run(invocation());
    expect(e.details).toMatchObject({ exitCode: 1, cliCommand: expect.arrayContaining(['-p']) });
  });

  it('AC-AGE-001-01 AC-AGE-002-06 invokes claude -p with stream-json, --json-schema, model, effort and full isolation', async () => {
    const { launcher, calls } = scriptedLauncher(() => ({ stdout: fixture('claude/stream-ok.synthetic.jsonl') }));
    await provider(launcher).run(invocation());
    const { args, env, input } = calls[0]?.command ?? { args: [], env: {}, input: '' };
    expect(args.slice(0, 4)).toEqual(['-p', '--output-format', 'stream-json', '--verbose']);
    expect(valueOf(args, '--json-schema')).toBe(JSON.stringify(schemaForCli(jsonSchemaOf('echo'))));
    expect(valueOf(args, '--model')).toBe('haiku');
    expect(valueOf(args, '--effort')).toBe('high');
    expect(valueOf(args, '--system-prompt')).toBe(invocation().system);
    expect(valueOf(args, '--tools')).toBe('');
    expect(valueOf(args, '--setting-sources')).toBe('');
    expect(args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--safe-mode', '--no-session-persistence']));
    expect(input).toBe(invocation().input);
    for (const key of Object.keys(SENSITIVE_VARIABLES)) expect(env).not.toHaveProperty(key);
    expect(env).toMatchObject({ PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\ana' });
  });

  it('AC-AGE-002-06 without effort --effort is not passed', () => {
    expect(claudeArguments(invocation({ effort: null }), null)).not.toContain('--effort');
  });

  it('AC-AGE-002-09 a fresh session sets its own id and runs in the stable folder, a resumed one resumes it', async () => {
    const directory = sessionFolder();
    const { launcher, calls } = scriptedLauncher(() => ({ stdout: fixture('claude/stream-ok.synthetic.jsonl') }));
    const fresh = await provider(launcher).run(invocation({ session: { mode: 'fresh', directory } }));
    const first = calls[0]?.command;
    const id = valueOf(first?.args ?? [], '--session-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first?.cwd).toBe(directory);
    expect(first?.args).not.toContain('--no-session-persistence');
    expect(fresh.sessionId).toBe(id);
    expect(existsSync(directory)).toBe(true);

    const resumed = await provider(launcher).run(invocation({ session: { mode: 'resumed', directory, id: 'abc-123' } }));
    const second = calls[1]?.command;
    expect(valueOf(second?.args ?? [], '--resume')).toBe('abc-123');
    expect(second?.args).not.toContain('--session-id');
    expect(second?.cwd).toBe(directory);
    expect(resumed.sessionId).toBe('abc-123');
  });

  it('after a call with a session the details name the transcript Claude Code left under its config folder', async () => {
    const directory = sessionFolder();
    const config = sessionFolder();
    const id = '0199a213-81c0-4800-8aa1-bbab2a035a53';
    const { launcher } = scriptedLauncher(() => ({ stdout: fixture('claude/stream-ok.synthetic.jsonl') }));
    const withConfig = createClaudeProvider({
      launcher,
      executable: 'claude',
      environment: { ...environment, CLAUDE_CONFIG_DIR: config },
    });
    // Not written yet (the CLI did not persist anything): no path.
    const before = await withConfig.run(invocation({ session: { mode: 'fresh', directory, id } }));
    expect(before.details).not.toHaveProperty('transcriptPath');
    // What the CLI writes: projects/<cwd with every non-alphanumeric character as a dash>/<session id>.jsonl.
    const project = join(config, 'projects', directory.replace(/[^A-Za-z0-9]/g, '-'));
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, `${id}.jsonl`), '{"type":"user"}\n');
    const fresh = await withConfig.run(invocation({ session: { mode: 'fresh', directory, id } }));
    expect(fresh.details?.transcriptPath).toBe(join(project, `${id}.jsonl`));
    const resumed = await withConfig.run(invocation({ session: { mode: 'resumed', directory, id } }));
    expect(resumed.details?.transcriptPath).toBe(join(project, `${id}.jsonl`));
    // Without a session there is no transcript to look for.
    const none = await withConfig.run(invocation());
    expect(none.details).not.toHaveProperty('transcriptPath');
  });

  it('AC-AGE-001-02 AC-AGE-002-10 the stream fixture gives ok with usage, provenance, observed model and ordered events', async () => {
    const events: ProviderEvent[] = [];
    const { launcher } = scriptedLauncher(() => ({ stdout: fixture('claude/stream-ok.synthetic.jsonl') }));
    const r = await provider(launcher).run(invocation({ onEvent: (e) => events.push(e) }));
    expect(r).toMatchObject({
      state: 'ok',
      rawOutput: { reply: ECHO },
      provider: 'claude',
      model: 'claude-haiku-4-5-20251001',
      usage: {
        inputTokens: 1500,
        cachedInputTokens: 0,
        outputTokens: 287,
        reasoningTokens: 210,
        turns: 2,
        durationMs: 3648,
        declaredCostUsd: 0.002935,
        provenance: {
          inputTokens: 'claude:result.usage.input_tokens+cache_*',
          outputTokens: 'claude:result.usage.output_tokens',
          reasoningTokens: 'claude:result.usage.output_tokens_details.thinking_tokens',
        },
      },
    });
    expect(events.map((e) => e.kind)).toEqual(['started', 'thinking', 'message', 'message', 'result']);
    expect(events.at(-1)?.tokens).toBe(287);
    expect(JSON.parse(events[0]?.raw ?? '{}')).toMatchObject({ type: 'system', subtype: 'init' });
  });

  it('AC-AGE-001-02 AC-AGE-002-10 the recorded real stream (haiku, 2.1.282) normalizes to ok, with thinking tokens live', async () => {
    const events: ProviderEvent[] = [];
    const { launcher } = scriptedLauncher(() => ({ stdout: fixture('claude/fresh.recorded.jsonl') }));
    const r = await provider(launcher).run(invocation({ onEvent: (e) => events.push(e) }));
    expect(r).toMatchObject({
      state: 'ok',
      rawOutput: { reply: 'Hola, DEMIURGO: primera llamada real del spike.' },
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 1461, outputTokens: 286, reasoningTokens: 214, turns: 2 },
    });
    const thinking = events.filter((e) => e.kind === 'thinking');
    expect(thinking.map((e) => e.tokens)).toEqual([50, 100, 275, 3]);
    expect(events.at(-1)?.kind).toBe('result');
    const resumed = scriptedLauncher(() => ({ stdout: fixture('claude/resumed.recorded.jsonl') }));
    expect(await provider(resumed.launcher).run(invocation())).toMatchObject({
      state: 'ok',
      rawOutput: { reply: 'Segunda llamada: continúa la sesión.' },
    });
  });

  it('AC-AGE-001-02 the error stream gives agent_error with its message', async () => {
    const { launcher } = scriptedLauncher(() => ({ stdout: fixture('claude/stream-error.synthetic.jsonl'), code: 1 }));
    const r = await provider(launcher).run(invocation({ model: 'claude-modelo-inexistente-demiurgo' }));
    expect(r).toMatchObject({ state: 'error', failureKind: 'agent_error', provider: 'claude' });
    expect(r.state === 'error' ? r.message : '').toMatch(/HTTP 404/);
  });

  it('AC-AGE-001-02 without claude on the PATH the failure is infra and nothing is launched', async () => {
    const empty = sessionFolder();
    const { launcher, calls } = scriptedLauncher(() => ({ stdout: '' }));
    const r = await createClaudeProvider({ launcher, environment: { PATH: empty } }).run(invocation());
    expect(r).toMatchObject({ state: 'error', failureKind: 'infra' });
    expect(calls).toHaveLength(0);
  });

  it('AC-AGE-001-03 when time runs out the process is terminated and the failure is timeout', async () => {
    const { launcher, calls } = scriptedLauncher(() => 'hang');
    const r = await provider(launcher).run(invocation({ timeMs: 30 }));
    expect(r).toMatchObject({ state: 'error', failureKind: 'timeout' });
    expect(calls[0]?.terminations).toBe(1);
  });

  it('AC-AGE-001-03 when the signal aborts the failure is cancelled; if it was already aborted nothing is launched', async () => {
    const hung = scriptedLauncher(() => 'hang');
    const control = new AbortController();
    setTimeout(() => control.abort(), 30);
    expect(await provider(hung.launcher).run(invocation({ signal: control.signal }))).toMatchObject({
      state: 'error',
      failureKind: 'cancelled',
    });
    const idle = scriptedLauncher(() => 'hang');
    expect(await provider(idle.launcher).run(invocation({ signal: AbortSignal.abort() }))).toMatchObject({
      failureKind: 'cancelled',
    });
    expect(idle.calls).toHaveLength(0);
  });

  it('AC-AGE-002-01 discovery reads version, sign-in and efforts without calling a model', async () => {
    const { launcher, calls } = scriptedLauncher((c) => {
      if (c.args.includes('--version')) return { stdout: fixture('claude/version.txt') };
      if (c.args.includes('auth')) return { stdout: fixture('claude/auth-status.json') };
      return { stdout: fixture('claude/help.txt') };
    });
    const catalog = await provider(launcher).discover();
    expect(catalog).toMatchObject({
      provider: 'claude',
      installed: true,
      version: '2.1.282',
      ready: true,
      message: null,
      sessions: true,
    });
    expect(catalog.models.map((m) => m.id)).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
    expect(catalog.models[0]).toMatchObject({ efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: null });
    expect(calls.every((c) => !c.command.args.includes('-p'))).toBe(true);
    expect(CLAUDE_MODELS).toHaveLength(4);
  });

  it('AC-AGE-002-08 when the efforts cannot be read, discovery says so instead of offering none', async () => {
    const { launcher } = scriptedLauncher((c) => {
      if (c.args.includes('--version')) return { stdout: fixture('claude/version.txt') };
      if (c.args.includes('auth')) return { stdout: fixture('claude/auth-status.json') };
      return { stderr: 'boom', code: 1 };
    });
    expect(await provider(launcher).discover()).toMatchObject({ installed: true, ready: true, listed: false });
  });

  it('AC-AGE-002-01 signed out, discovery says so and the provider is not ready', async () => {
    const { launcher } = scriptedLauncher((c) => {
      if (c.args.includes('--version')) return { stdout: fixture('claude/version.txt') };
      if (c.args.includes('auth')) return { stdout: fixture('claude/auth-status-signed-out.json'), code: 1 };
      return { stdout: fixture('claude/help.txt') };
    });
    const catalog = await provider(launcher).discover();
    expect(catalog).toMatchObject({ installed: true, ready: false, message: "Claude isn't signed in: run `claude auth login`." });
  });

  it('AC-AGE-002-01 not installed, discovery says so', async () => {
    const empty = sessionFolder();
    const { launcher } = scriptedLauncher(() => ({ stdout: '' }));
    const catalog = await createClaudeProvider({ launcher, environment: { PATH: empty } }).discover();
    expect(catalog).toMatchObject({ installed: false, ready: false, models: [] });
    expect(catalog.message).toMatch(/isn't installed/);
  });

  it('AC-AGE-002-01 the efforts are parsed from the help text', () => {
    expect(parseClaudeEfforts(fixture('claude/help.txt'))).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(parseClaudeEfforts('no such flag')).toEqual([]);
  });
});
