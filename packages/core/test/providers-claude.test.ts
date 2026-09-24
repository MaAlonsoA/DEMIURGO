// Claude provider over `claude -p --output-format stream-json`. A scripted launcher replays the
// fixtures in `fixtures/claude/` (the stream ones are built from a recorded result: see their
// `synthetic` suffix): the real CLI is never called.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ProviderEvent, type ProviderInvocation, jsonSchemaOf } from '@demiurgo/domain';
import { afterAll, describe, expect, it } from 'vitest';
import { schemaForCli } from '../src/agents/claude-cli.ts';
import { CLAUDE_MODELS, claudeArguments, createClaudeProvider, parseClaudeEfforts } from '../src/providers/claude.ts';
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

const environment = { PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\ana', ...SENSITIVE_VARIABLES };
const provider = (launcher: ReturnType<typeof scriptedLauncher>['launcher']) =>
  createClaudeProvider({ launcher, executable: 'claude', environment });

describe('Claude provider', () => {
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
