// Shared pieces of the CLI providers: waiting for a process with a time limit and cancellation,
// and splitting its streamed stdout into lines (every CLI streams one JSON event per line).

import { setTimeout as sleep } from 'node:timers/promises';
import type { FailureKind } from '@demiurgo/domain';
import type { LaunchedProcess, ProcessEnd } from '../agents/process.ts';

/** Maximum wait, after ordering termination, to collect the process's partial output. */
export const TERMINATION_WAIT_MS = 5000;

export type Cutoff = Extract<FailureKind, 'timeout' | 'cancelled'>;

export type Outcome =
  | { type: 'end'; end: ProcessEnd }
  | { type: 'failure'; error: unknown }
  | { type: 'cutoff'; reason: Cutoff; end: ProcessEnd | undefined };

/** Waits for the process, or kills it when the time runs out or the signal aborts. */
export async function waitForOutcome(
  proc: LaunchedProcess,
  timeMs: number,
  signal: AbortSignal | undefined,
  terminationWaitMs: number = TERMINATION_WAIT_MS,
): Promise<Outcome> {
  const natural: Promise<Outcome> = proc.end.then(
    (end) => ({ type: 'end', end }),
    (error: unknown) => ({ type: 'failure', error }),
  );
  const state: { reason?: Cutoff } = {};
  const cutoff = Promise.withResolvers<null>();
  const cutOff = (reason: Cutoff) => {
    if (state.reason) return;
    state.reason = reason;
    proc.terminate();
    cutoff.resolve(null);
  };
  const timer = setTimeout(() => cutOff('timeout'), timeMs);
  const onAbort = () => cutOff('cancelled');
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    const first = await Promise.race([natural, cutoff.promise]);
    const reason = state.reason;
    if (reason === undefined && first) return first;
    // After ordering termination, a margin is given to collect the partial output.
    const after = await Promise.race([natural, sleep(terminationWaitMs, null, { ref: false })]);
    return { type: 'cutoff', reason: reason ?? 'cancelled', end: after?.type === 'end' ? after.end : undefined };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Turns streamed chunks into complete lines: a line split across chunks is joined, CRLF becomes
 * LF, and empty lines are skipped. The last line is only delivered once its newline arrives.
 */
export function lineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let pending = '';
  return (chunk) => {
    pending += chunk;
    let at = pending.indexOf('\n');
    while (at >= 0) {
      const line = pending.slice(0, at).replace(/\r$/, '');
      pending = pending.slice(at + 1);
      if (line.trim()) onLine(line);
      at = pending.indexOf('\n');
    }
  };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
