// The transcripts of the CLIs (spec §5.4, §7.4, §13): where Claude Code and Codex leave them, how a
// session's file is found, and what `callProvider` records and emits after each call: the path,
// size and fingerprint on the call span, and the bytes added since the previous call of that
// session as a `transcript_chunk` text with its offset. No real CLI is ever called.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ATTR, LOG, type Provider, jsonSchemaOf, sha256Hex } from '@demiurgo/domain';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../src/agents/simulated.ts';
import { type CallMeta, callProvider } from '../src/assignments/calls.ts';
import {
  captureTranscript,
  claudeConfigDir,
  claudeTranscriptPath,
  codexHome,
  encodeClaudeProjectDir,
  findClaudeTranscript,
  findCodexTranscript,
  homeOf,
  resetTranscriptOffsets,
} from '../src/observe/transcripts.ts';
import { useEnvironment } from './support/env.ts';

const folders: string[] = [];
afterAll(() => {
  for (const f of folders) rmSync(f, { recursive: true, force: true });
});
const temp = (prefix: string): string => {
  const f = mkdtempSync(join(tmpdir(), prefix));
  folders.push(f);
  return f;
};

describe('where the CLIs keep their transcripts', () => {
  it('Claude Code encodes the working directory by turning every non-alphanumeric character into a dash', () => {
    // As observed in ~/.claude/projects on Windows: drive colon and separators alike.
    expect(encodeClaudeProjectDir('D:\\Dev\\Demiurgo')).toBe('D--Dev-Demiurgo');
    expect(encodeClaudeProjectDir('D:\\Dev\\Demiurgo\\.claude\\worktrees\\agent-a1')).toBe(
      'D--Dev-Demiurgo--claude-worktrees-agent-a1',
    );
    expect(encodeClaudeProjectDir('C:\\Users\\Marcos\\AppData\\Local\\Demiurgo\\agent-sessions\\claude\\9bdc7f28')).toBe(
      'C--Users-Marcos-AppData-Local-Demiurgo-agent-sessions-claude-9bdc7f28',
    );
    expect(encodeClaudeProjectDir('/home/ana/proyecto ñ')).toBe('-home-ana-proyecto--');
    expect(claudeTranscriptPath('C:\\cfg', 'D:\\Dev\\Demiurgo', 'abc-1')).toBe(
      join('C:\\cfg', 'projects', 'D--Dev-Demiurgo', 'abc-1.jsonl'),
    );
  });

  it('the config folders come from CLAUDE_CONFIG_DIR / CODEX_HOME, else from the home of USERPROFILE or HOME', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: 'X:\\claude' })).toBe('X:\\claude');
    expect(claudeConfigDir({ USERPROFILE: 'C:\\Users\\ana' })).toBe(join('C:\\Users\\ana', '.claude'));
    expect(claudeConfigDir({ claude_config_dir: 'lower' })).toBe('lower');
    expect(codexHome({ CODEX_HOME: 'X:\\codex' })).toBe('X:\\codex');
    expect(codexHome({ HOME: '/home/ana' })).toBe(join('/home/ana', '.codex'));
    expect(homeOf({ HOME: '/home/ana', USERPROFILE: 'C:\\Users\\ana' })).toBe('C:\\Users\\ana');
    expect(homeOf({})).not.toBe('');
  });

  it('finds the Claude transcript at the encoded path, or anywhere under projects/ by session id, or not at all', async () => {
    const config = temp('dmg-claude-config-');
    const cwd = 'D:\\Dev\\Demiurgo';
    const expected = join(config, 'projects', 'D--Dev-Demiurgo');
    mkdirSync(expected, { recursive: true });
    writeFileSync(join(expected, 'sess-1.jsonl'), '{"type":"user"}\n');
    expect(await findClaudeTranscript(config, cwd, 'sess-1')).toBe(join(expected, 'sess-1.jsonl'));
    // A different encoding some day: the scan still finds it.
    const other = join(config, 'projects', 'some-other-encoding');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'sess-2.jsonl'), '{"type":"user"}\n');
    expect(await findClaudeTranscript(config, cwd, 'sess-2')).toBe(join(other, 'sess-2.jsonl'));
    expect(await findClaudeTranscript(config, cwd, 'sess-3')).toBeNull();
    expect(await findClaudeTranscript(join(config, 'missing'), cwd, 'sess-1')).toBeNull();
    // A subfolder named like the session (Claude keeps tool results there) is not the transcript.
    mkdirSync(join(expected, 'sess-4.jsonl'), { recursive: true });
    expect(await findClaudeTranscript(config, cwd, 'sess-4')).toBeNull();
    // Never a path traversal from a strange id.
    expect(await findClaudeTranscript(config, cwd, '../x')).toBeNull();
  });

  it('finds the Codex rollout under sessions/YYYY/MM/DD by thread id, newest day first', async () => {
    const home = temp('dmg-codex-home-');
    const thread = '0199a213-81c0-7800-8aa1-bbab2a035a53';
    const old = join(home, 'sessions', '2026', '09', '20');
    const recent = join(home, 'sessions', '2026', '09', '26');
    mkdirSync(old, { recursive: true });
    mkdirSync(recent, { recursive: true });
    writeFileSync(join(old, `rollout-2026-09-20T10-00-00-${thread}.jsonl`), '{}\n');
    writeFileSync(join(recent, `rollout-2026-09-26T09-30-00-${thread}.jsonl`), '{}\n');
    writeFileSync(join(recent, 'rollout-2026-09-26T09-31-00-01a0d5cf-6a58-7b02-b809-c7935ef0571b.jsonl'), '{}\n');
    expect(await findCodexTranscript(home, thread)).toBe(join(recent, `rollout-2026-09-26T09-30-00-${thread}.jsonl`));
    expect(await findCodexTranscript(home, '01a0d5cf-6a58-7b02-b809-c7935ef0571b')).toBe(
      join(recent, 'rollout-2026-09-26T09-31-00-01a0d5cf-6a58-7b02-b809-c7935ef0571b.jsonl'),
    );
    expect(await findCodexTranscript(home, 'unknown-thread')).toBeNull();
    expect(await findCodexTranscript(join(home, 'missing'), thread)).toBeNull();
    expect(await findCodexTranscript(home, '../etc')).toBeNull();
  });

  it('captureTranscript returns the whole file the first time, then only what was added; a rewritten file starts again', async () => {
    resetTranscriptOffsets();
    const dir = temp('dmg-transcript-');
    const path = join(dir, 't.jsonl');
    writeFileSync(path, 'línea 1\n');
    const first = await captureTranscript(path);
    expect(first).toMatchObject({ path, offset: 0, size: Buffer.byteLength('línea 1\n'), chunk: 'línea 1\n' });
    expect(first?.hash).toBe(sha256Hex('línea 1\n'));
    await appendFile(path, 'línea 2\n');
    const second = await captureTranscript(path);
    expect(second).toMatchObject({ offset: first?.size, chunk: 'línea 2\n' });
    expect(second?.size).toBe(Buffer.byteLength('línea 1\nlínea 2\n'));
    // Nothing new: an empty chunk at the end.
    expect(await captureTranscript(path)).toMatchObject({ offset: second?.size, chunk: '' });
    // Shorter than what was seen (rewritten): from 0 again.
    writeFileSync(path, 'x\n');
    expect(await captureTranscript(path)).toMatchObject({ offset: 0, chunk: 'x\n' });
    expect(await captureTranscript(join(dir, 'missing.jsonl'))).toBeNull();
  });
});

/** A provider that, like a CLI, appends its turn to the session's transcript and says where it is. */
function transcribingProvider(path: string, options: { locate?: boolean; fail?: boolean } = {}): Provider {
  const base = createSimulatedProvider();
  return {
    ...base,
    async run(inv) {
      await appendFile(path, `${JSON.stringify({ type: 'user', text: inv.input })}\n`);
      if (options.fail) {
        return {
          state: 'error',
          failureKind: 'agent_error',
          message: 'Nope.',
          rawEvents: '',
          provider: base.id,
          model: inv.model,
          sessionId: 'sess',
          details: { transcriptPath: path },
        };
      }
      const r = await base.run(inv);
      return options.locate === false ? r : { ...r, sessionId: 'sess', details: { ...r.details, transcriptPath: path } };
    },
  };
}

const meta = (sessionId: string, mode: 'fresh' | 'resumed'): CallMeta => ({
  projectId: null,
  runId: null,
  updateId: null,
  agent: 'echo',
  agentVersion: 'v1',
  promptHash: 'p',
  engineSource: 'agent',
  session: { id: sessionId, mode, baseRunId: null, basePackHash: null, deltaHash: null, keyHash: 'k' },
  attempt: 1,
  inputHash: null,
  schemaHash: null,
  schemaVersion: null,
  packHash: null,
  retryOf: null,
});

describe('callProvider and the transcript', () => {
  const env = useEnvironment();
  beforeEach(() => {
    env().observer.reset();
    resetTranscriptOffsets();
  });

  const invocation = (input: string) => ({
    system: 'You echo.',
    input,
    schema: jsonSchemaOf('echo'),
    model: 'sim',
    effort: null,
    timeMs: 5000,
    session: { mode: 'fresh' as const, directory: temp('dmg-session-dir-'), id: 'sess' },
    task: { action: 'echo' as const, context: { hash: 'h', content: { input: { text: input } } } },
  });

  it('two calls on one session leave two chunks with increasing offsets, and the span carries path, size and hash', async () => {
    const dir = temp('dmg-transcripts-');
    const path = join(dir, 'sess.jsonl');
    writeFileSync(path, '');
    const provider = transcribingProvider(path);
    const sessionId = '4d3c2b1a-0f9e-4d7c-8b6a-5f4e3d2c1b0a';
    const deps = { db: env().services.db, observer: env().observer };
    await callProvider(deps, provider, meta(sessionId, 'fresh'), invocation('one'));
    await callProvider(deps, provider, meta(sessionId, 'resumed'), invocation('two'));

    const chunks = env()
      .observer.logs()
      .filter((l) => l.eventName === LOG.text && l.attributes[ATTR.textKind] === 'transcript_chunk');
    expect(chunks).toHaveLength(2);
    const firstLine = `${JSON.stringify({ type: 'user', text: 'one' })}\n`;
    const secondLine = `${JSON.stringify({ type: 'user', text: 'two' })}\n`;
    expect(chunks[0]?.body).toBe(firstLine);
    expect(chunks[1]?.body).toBe(secondLine);
    expect(chunks.map((c) => c.attributes[ATTR.transcriptOffset])).toEqual([0, Buffer.byteLength(firstLine)]);
    expect(chunks.every((c) => c.attributes[ATTR.sessionId] === sessionId)).toBe(true);
    expect(chunks.every((c) => c.attributes[ATTR.transcriptPath] === path)).toBe(true);

    const spans = env()
      .observer.spans()
      .filter((s) => s.name.startsWith('invoke_agent'));
    expect(spans).toHaveLength(2);
    expect(spans[0]?.attributes).toMatchObject({
      [ATTR.transcriptPath]: path,
      [ATTR.transcriptSize]: Buffer.byteLength(firstLine),
      [ATTR.transcriptHash]: sha256Hex(firstLine),
    });
    expect(spans[1]?.attributes).toMatchObject({
      [ATTR.transcriptSize]: Buffer.byteLength(firstLine + secondLine),
      [ATTR.transcriptHash]: sha256Hex(firstLine + secondLine),
    });
    // Each chunk is tagged with its call.
    expect(chunks.map((c) => c.attributes[ATTR.callId])).toEqual(spans.map((s) => s.attributes[ATTR.callId]));
  });

  it('a failed call still records its transcript; a missing file or no path leaves the attributes absent and the call intact', async () => {
    const dir = temp('dmg-transcripts-');
    const path = join(dir, 'sess.jsonl');
    writeFileSync(path, '');
    const deps = { db: env().services.db, observer: env().observer };
    const failed = await callProvider(deps, transcribingProvider(path, { fail: true }), meta('a', 'fresh'), invocation('x'));
    expect(failed.state).toBe('error');
    const [failedSpan] = env()
      .observer.spans()
      .filter((s) => s.name.startsWith('invoke_agent'));
    expect(failedSpan?.attributes[ATTR.transcriptPath]).toBe(path);
    expect(failedSpan?.attributes[ATTR.transcriptSize]).toBeGreaterThan(0);

    env().observer.reset();
    const gone = transcribingProvider(join(dir, 'never-written.jsonl'));
    // The provider names a file that a launcher failure never created.
    const provider: Provider = {
      ...gone,
      run: async (inv) => ({ ...(await gone.run(inv)), details: { transcriptPath: join(dir, 'missing.jsonl') } }),
    };
    const ok = await callProvider(deps, provider, meta('b', 'fresh'), invocation('y'));
    expect(ok.state).toBe('ok');
    const [span] = env()
      .observer.spans()
      .filter((s) => s.name.startsWith('invoke_agent'));
    expect(span?.attributes[ATTR.transcriptPath]).toBe(join(dir, 'missing.jsonl'));
    expect(span?.attributes).not.toHaveProperty(ATTR.transcriptSize);
    expect(span?.attributes).not.toHaveProperty(ATTR.transcriptHash);
    expect(
      env()
        .observer.logs()
        .filter((l) => l.attributes[ATTR.textKind] === 'transcript_chunk'),
    ).toHaveLength(0);

    env().observer.reset();
    await callProvider(deps, transcribingProvider(path, { locate: false }), meta('c', 'fresh'), invocation('z'));
    const [plain] = env()
      .observer.spans()
      .filter((s) => s.name.startsWith('invoke_agent'));
    expect(plain?.attributes).not.toHaveProperty(ATTR.transcriptPath);
  });
});
