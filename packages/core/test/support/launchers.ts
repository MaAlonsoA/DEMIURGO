// Fake launchers for the CLI providers: they record each command (and what its folder held at
// launch) and answer with recorded outputs, streaming stdout in two chunks like a real process.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LaunchCommand, Launcher, ProcessEnd } from '../../src/agents/process.ts';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

export const fixture = (path: string): string => readFileSync(join(FIXTURES, path), 'utf8');

export type Call = { command: LaunchCommand; cwdContents: string[]; terminations: number };

type Answer = Partial<ProcessEnd> | Error | 'hang' | 'hang-forever';

/**
 * Launcher that answers each command with `respond(command)`: an end (its stdout is streamed to
 * `onStdout` split in two chunks), an error (the process couldn't start), or a process that only
 * ends when it is terminated ('hang') or never ('hang-forever').
 */
export function scriptedLauncher(respond: (command: LaunchCommand) => Answer): { launcher: Launcher; calls: Call[] } {
  const calls: Call[] = [];
  const launcher: Launcher = (command) => {
    const call: Call = { command, cwdContents: safeList(command.cwd), terminations: 0 };
    calls.push(call);
    const answer = respond(command);
    if (answer === 'hang' || answer === 'hang-forever') {
      const end = Promise.withResolvers<ProcessEnd>();
      command.onStdout?.('{"type":"system"}\n');
      return {
        pid: 4321,
        end: end.promise,
        terminate: () => {
          call.terminations++;
          if (answer === 'hang') end.resolve({ code: null, signal: 'SIGKILL', stdout: '{"type":"system"}\n', stderr: '' });
        },
      };
    }
    if (answer instanceof Error) {
      return { pid: undefined, end: Promise.reject(answer), terminate: () => undefined };
    }
    const end = { code: 0, signal: null, stdout: '', stderr: '', ...answer };
    const half = Math.floor(end.stdout.length / 2);
    command.onStdout?.(end.stdout.slice(0, half));
    command.onStdout?.(end.stdout.slice(half));
    return {
      pid: 1234,
      end: Promise.resolve(end),
      terminate: () => {
        call.terminations++;
      },
    };
  };
  return { launcher, calls };
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function valueOf(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
}

/** Values of every occurrence of a repeated flag (`-c a -c b` → [a, b]). */
export function valuesOf(args: readonly string[], flag: string): string[] {
  return args.flatMap((a, i) => (a === flag && args[i + 1] !== undefined ? [args[i + 1] as string] : []));
}

export const SENSITIVE_VARIABLES = {
  DEMIURGO_DATABASE_URL: 'postgres://demiurgo:secret@127.0.0.1:55432/x',
  DATABASE_URL: 'postgres://other',
  PGPASSWORD: 'secret',
  ANTHROPIC_API_KEY: 'sk-ant-fake',
  ANTHROPIC_AUTH_TOKEN: 'fake-token',
  OPENAI_API_KEY: 'sk-openai-fake',
  CODEX_API_KEY: 'fake-codex',
  ANY_SECRET: 'must-not-pass',
};
