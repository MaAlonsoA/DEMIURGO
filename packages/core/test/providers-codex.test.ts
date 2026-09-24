// Codex provider over `codex exec --json --output-schema`. A scripted launcher replays the fixtures
// in `fixtures/codex/` (models.json is recorded; the event streams are built from Codex's documented
// JSONL: see their `synthetic` suffix): the real CLI is never called.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ProviderEvent, type ProviderInvocation, jsonSchemaOf } from '@demiurgo/domain';
import { afterAll, describe, expect, it } from 'vitest';
import type { LaunchCommand } from '../src/agents/process.ts';
import {
  CODEX_DISABLED_FEATURES,
  codexArguments,
  createCodexProvider,
  parseCodexModels,
  tomlString,
} from '../src/providers/codex.ts';
import { strictSchema } from '../src/providers/schema-variants.ts';
import { SENSITIVE_VARIABLES, fixture, scriptedLauncher, valueOf, valuesOf } from './support/launchers.ts';

const folders: string[] = [];
afterAll(() => {
  for (const f of folders) rmSync(f, { recursive: true, force: true });
});
const folder = (): string => {
  const f = mkdtempSync(join(tmpdir(), 'dmg-codex-test-'));
  folders.push(f);
  return f;
};

const invocation = (over: Partial<ProviderInvocation> = {}): ProviderInvocation => ({
  system: 'You echo.\n\n## DEMIURGO rules for this run',
  input: 'Action: echo\n<untrusted_context>\n{}\n</untrusted_context>',
  schema: jsonSchemaOf('echo'),
  model: 'gpt-6-sol',
  effort: 'high',
  session: { mode: 'none' },
  timeMs: 60_000,
  ...over,
});

/** Writes what Codex would write with `-o`, and answers with the recorded event stream. */
function codexAnswer(stream: string, lastMessage: string | null, code = 0) {
  const schemas: unknown[] = [];
  const answer = (c: LaunchCommand) => {
    const schema = valueOf(c.args, '--output-schema');
    if (schema) schemas.push(JSON.parse(readFileSync(schema, 'utf8')));
    const last = valueOf(c.args, '-o');
    if (last && lastMessage !== null) writeFileSync(last, lastMessage);
    return { stdout: fixture(stream), code };
  };
  return { answer, schemas };
}

const environment = {
  PATH: 'C:\\bin',
  USERPROFILE: 'C:\\Users\\ana',
  CODEX_HOME: 'C:\\Users\\ana\\.codex',
  ...SENSITIVE_VARIABLES,
};
const provider = (launcher: ReturnType<typeof scriptedLauncher>['launcher']) =>
  createCodexProvider({ launcher, executable: 'codex', environment });

describe('Codex provider', () => {
  it('AC-AGE-002-06 invokes codex exec with JSON events, output schema, model, effort, instructions and no tools', async () => {
    const { answer, schemas } = codexAnswer('codex/exec-ok.synthetic.jsonl', fixture('codex/last-message.json'));
    const { launcher, calls } = scriptedLauncher(answer);
    await provider(launcher).run(invocation());
    const { args, env, input, cwd } = calls[0]?.command ?? { args: [], env: {}, input: '', cwd: '' };
    expect(args[0]).toBe('exec');
    expect(args).toEqual(
      expect.arrayContaining(['--json', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--ephemeral']),
    );
    expect(valueOf(args, '-m')).toBe('gpt-6-sol');
    expect(valuesOf(args, '-c')).toEqual(
      expect.arrayContaining([
        'model_reasoning_effort="high"',
        `developer_instructions=${JSON.stringify(invocation().system)}`,
        'sandbox_mode="read-only"',
        'web_search="disabled"',
      ]),
    );
    expect(valuesOf(args, '--disable')).toEqual([...CODEX_DISABLED_FEATURES]);
    expect(valueOf(args, '-C')).toBe(cwd);
    expect(args.at(-1)).toBe('-');
    expect(input).toBe(invocation().input);
    expect(schemas).toEqual([strictSchema(jsonSchemaOf('echo'))]);
    for (const key of Object.keys(SENSITIVE_VARIABLES)) expect(env).not.toHaveProperty(key);
    expect(env).toMatchObject({ CODEX_HOME: 'C:\\Users\\ana\\.codex' });
  });

  it('AC-AGE-002-06 the strict schema drops the keywords strict mode rejects and keeps the structure', () => {
    const strict = strictSchema(jsonSchemaOf('exploration_chat'));
    const text = JSON.stringify(strict);
    for (const k of ['"$schema"', '"minLength"', '"maxLength"', '"maxItems"', '"format"', '"pattern"'])
      expect(text).not.toContain(k);
    expect(strict).toMatchObject({ type: 'object', additionalProperties: false, required: expect.arrayContaining(['reply']) });
  });

  it('a system prompt with quotes, backslashes, newlines and tags survives as a TOML string', () => {
    const system = 'Say "hi" \\ then\nclose </untrusted_context> and ${x} \'single\'';
    const toml = tomlString(system);
    expect(JSON.parse(toml)).toBe(system);
    expect(toml).not.toContain('\n');
    const args = codexArguments(invocation({ system }), { schema: 's.json', last: 'l.json' }, 'dir');
    expect(valuesOf(args, '-c')).toContain(`developer_instructions=${toml}`);
  });

  it('AC-AGE-002-09 a resumed session uses exec resume with its id, without -C, and keeps the schema', () => {
    const args = codexArguments(
      invocation({ session: { mode: 'resumed', directory: 'dir', id: '0199a213-81c0' } }),
      { schema: 's.json', last: 'l.json' },
      'dir',
    );
    expect(args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(args.slice(-2)).toEqual(['0199a213-81c0', '-']);
    expect(args).not.toContain('-C');
    expect(args).not.toContain('--ephemeral');
    expect(valueOf(args, '--output-schema')).toBe('s.json');
    const fresh = codexArguments(invocation({ session: { mode: 'fresh', directory: 'dir' } }), { schema: 's', last: 'l' }, 'dir');
    expect(fresh).not.toContain('--ephemeral');
  });

  it('AC-AGE-001-02 AC-AGE-002-10 the exec fixture gives ok with the session, usage, provenance and ordered events', async () => {
    const events: ProviderEvent[] = [];
    const directory = folder();
    const { answer } = codexAnswer('codex/exec-ok.synthetic.jsonl', fixture('codex/last-message.json'));
    const { launcher, calls } = scriptedLauncher(answer);
    const r = await provider(launcher).run(invocation({ session: { mode: 'fresh', directory }, onEvent: (e) => events.push(e) }));
    expect(r).toMatchObject({
      state: 'ok',
      rawOutput: JSON.parse(fixture('codex/last-message.json')),
      provider: 'codex',
      model: 'gpt-6-sol',
      sessionId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
      usage: {
        inputTokens: 2451,
        cachedInputTokens: 1920,
        outputTokens: 84,
        reasoningTokens: 40,
        turns: 1,
        provenance: {
          inputTokens: 'codex:turn.completed.usage.input_tokens',
          reasoningTokens: 'codex:turn.completed.usage.reasoning_output_tokens',
          declaredCostUsd: 'not_reported',
        },
      },
    });
    expect(calls[0]?.command.cwd).toBe(directory);
    expect(existsSync(directory)).toBe(true);
    expect(events.map((e) => e.kind)).toEqual(['started', 'started', 'thinking', 'message', 'usage']);
    expect(events.at(-1)?.tokens).toBe(84);
  });

  it('AC-AGE-001-02 a failed turn gives agent_error with its message', async () => {
    const { answer } = codexAnswer('codex/exec-failed.synthetic.jsonl', null, 1);
    const { launcher } = scriptedLauncher(answer);
    const r = await provider(launcher).run(invocation({ model: 'gpt-x' }));
    expect(r).toMatchObject({ state: 'error', failureKind: 'agent_error', provider: 'codex' });
    expect(r.state === 'error' ? r.message : '').toMatch(/gpt-x' model is not supported/);
  });

  it('AC-AGE-001-02 an answer without a final message is agent_error and keeps the raw events', async () => {
    const { answer } = codexAnswer('codex/exec-ok.synthetic.jsonl', null);
    const { launcher } = scriptedLauncher(answer);
    const r = await provider(launcher).run(invocation());
    // The last agent message in the stream is used when -o wrote nothing.
    expect(r).toMatchObject({ state: 'ok', rawOutput: JSON.parse(fixture('codex/last-message.json')) });
    const bare = scriptedLauncher(() => ({ stdout: '{"type":"thread.started","thread_id":"t"}\n', code: 0 }));
    const r2 = await provider(bare.launcher).run(invocation());
    expect(r2).toMatchObject({
      state: 'error',
      failureKind: 'agent_error',
      rawEvents: expect.stringContaining('thread.started'),
    });
  });

  it('AC-AGE-001-03 when time runs out the process is terminated and the failure is timeout', async () => {
    const { launcher, calls } = scriptedLauncher(() => 'hang');
    const r = await provider(launcher).run(invocation({ timeMs: 30 }));
    expect(r).toMatchObject({ state: 'error', failureKind: 'timeout' });
    expect(calls[0]?.terminations).toBe(1);
  });

  it('AC-AGE-002-01 discovery lists the models Codex offers with their efforts, without calling a model', async () => {
    const { launcher, calls } = scriptedLauncher((c) => {
      if (c.args.includes('--version')) return { stdout: fixture('codex/version.txt') };
      if (c.args.includes('login')) return { stdout: fixture('codex/login-status.txt') };
      return { stdout: fixture('codex/models.json') };
    });
    const catalog = await provider(launcher).discover();
    expect(catalog).toMatchObject({ provider: 'codex', installed: true, version: '0.156.1', ready: true, sessions: true });
    expect(catalog.models.map((m) => m.id)).toEqual(parseCodexModels(fixture('codex/models.json')).map((m) => m.id));
    expect(calls.every((c) => c.command.args[0] !== 'exec')).toBe(true);
  });

  it('AC-AGE-002-01 only the listed models, with their efforts and default effort', () => {
    const models = parseCodexModels(fixture('codex/models.json'));
    expect(models.some((m) => m.id === 'gpt-reserve' || m.id === 'codex-auto-review')).toBe(false);
    expect(models.find((m) => m.id === 'gpt-6-sol')).toEqual({
      id: 'gpt-6-sol',
      label: 'GPT-6-Sol',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      defaultEffort: 'medium',
    });
    expect(parseCodexModels('not json')).toEqual([]);
  });

  it('AC-AGE-002-01 signed out, discovery says so', async () => {
    const { launcher } = scriptedLauncher((c) => {
      if (c.args.includes('--version')) return { stdout: fixture('codex/version.txt') };
      if (c.args.includes('login')) return { stdout: 'Not logged in', code: 1 };
      return { stdout: fixture('codex/models.json') };
    });
    expect(await provider(launcher).discover()).toMatchObject({
      installed: true,
      ready: false,
      message: "Codex isn't signed in: run `codex login`.",
    });
  });
});
