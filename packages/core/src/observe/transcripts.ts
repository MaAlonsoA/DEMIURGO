// The transcripts of the CLIs (spec §5.4, §7.4, §13): Claude Code and Codex leave the whole
// conversation on disk, outside DEMIURGO. After each call with a session the adapter locates the
// file and `callProvider` records its path, size and fingerprint on the call span and emits, as a
// `transcript_chunk` text, what the file gained since the last call of that session. Nothing here
// ever fails a call: every error is swallowed and the transcript attributes are simply absent.
//
// Locations, as observed on the person's machine (docs/superpowers/specs/2026-09-26-fase4-verificaciones.md):
// - Claude Code: `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<encoded cwd>/<session_id>.jsonl`, where the
//   encoded cwd replaces every character that is not a letter or a digit with `-`
//   (`D:\Dev\Demiurgo` → `D--Dev-Demiurgo`, `C:\Users\Marcos\.claude` → `C--Users-Marcos--claude`).
// - Codex: `<CODEX_HOME or ~/.codex>/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDTHH-MM-SS-<thread_id>.jsonl`,
//   plus `session_index.jsonl` (one `{ id, thread_name, updated_at }` per thread) next to `sessions/`.

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Env = Readonly<Record<string, string | undefined>>;

/** A variable by name, case-insensitively (Windows environments are). */
function envValue(env: Env, name: string): string | undefined {
  const direct = env[name];
  if (direct !== undefined) return direct;
  const upper = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) if (key.toUpperCase() === upper && value !== undefined) return value;
  return undefined;
}

/** The person's home as the CLIs see it: `USERPROFILE` on Windows, `HOME` elsewhere, or the OS's answer. */
export function homeOf(env: Env): string {
  return envValue(env, 'USERPROFILE') || envValue(env, 'HOME') || homedir();
}

/** Where Claude Code keeps its state: `CLAUDE_CONFIG_DIR` or `~/.claude`. */
export function claudeConfigDir(env: Env): string {
  return envValue(env, 'CLAUDE_CONFIG_DIR') || join(homeOf(env), '.claude');
}

/** Where Codex keeps its state: `CODEX_HOME` or `~/.codex`. */
export function codexHome(env: Env): string {
  return envValue(env, 'CODEX_HOME') || join(homeOf(env), '.codex');
}

/** Claude Code's folder name for a working directory: every non-alphanumeric character becomes `-`. */
export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

/** The transcript Claude Code writes for a session run in `cwd`. */
export function claudeTranscriptPath(configDir: string, cwd: string, sessionId: string): string {
  return join(configDir, 'projects', encodeClaudeProjectDir(cwd), `${sessionId}.jsonl`);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function subdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function files(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * The Claude Code transcript of a session, if it exists: at the encoded path first and, should the
 * encoding ever change, wherever `projects/` holds a `<sessionId>.jsonl`. Null when not found.
 */
export async function findClaudeTranscript(configDir: string, cwd: string, sessionId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return null;
  const expected = claudeTranscriptPath(configDir, cwd, sessionId);
  if (await isFile(expected)) return expected;
  const projects = join(configDir, 'projects');
  for (const project of await subdirectories(projects)) {
    const candidate = join(projects, project, `${sessionId}.jsonl`);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

const descending = (names: string[]): string[] => [...names].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

/**
 * The Codex rollout of a thread, if it exists: `sessions/YYYY/MM/DD/rollout-*-<threadId>.jsonl`,
 * searched from the newest day backwards. Null when not found.
 */
export async function findCodexTranscript(codexHomeDir: string, threadId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]+$/.test(threadId)) return null;
  const sessions = join(codexHomeDir, 'sessions');
  const suffix = `-${threadId}.jsonl`;
  for (const year of descending(await subdirectories(sessions))) {
    for (const month of descending(await subdirectories(join(sessions, year)))) {
      for (const day of descending(await subdirectories(join(sessions, year, month)))) {
        const dir = join(sessions, year, month, day);
        const name = (await files(dir)).find((f) => f.startsWith('rollout-') && f.endsWith(suffix));
        if (name) return join(dir, name);
      }
    }
  }
  return null;
}

/** What a call added to a transcript: the file as it is now and the bytes since the previous call. */
export type TranscriptCapture = {
  path: string;
  /** Size in bytes now. */
  size: number;
  /** SHA-256 of the whole file now. */
  hash: string;
  /** Byte offset the chunk starts at (0 when this process had not seen the file). */
  offset: number;
  /** The bytes from `offset` to `size`, as text; empty when nothing was added. */
  chunk: string;
};

// The last size seen per transcript path, in this process only: after a restart the next chunk
// starts at 0 again (a full re-emission the evidence ingester deduplicates by session and offset).
const seen = new Map<string, number>();

export function resetTranscriptOffsets(): void {
  seen.clear();
}

/**
 * Reads the transcript and returns what it holds beyond the last offset seen for that path. A file
 * shorter than the last offset (rewritten) starts again at 0. Null when the file cannot be read.
 */
export async function captureTranscript(path: string): Promise<TranscriptCapture | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return null;
  }
  const size = bytes.byteLength;
  const previous = seen.get(path) ?? 0;
  const offset = previous <= size ? previous : 0;
  seen.set(path, size);
  return {
    path,
    size,
    hash: createHash('sha256').update(bytes).digest('hex'),
    offset,
    chunk: bytes.subarray(offset, size).toString('utf8'),
  };
}
