// Live progress of the runs (FDR-AGE-002): the project's SSE stream sends `run.progress` while a
// provider works (not an event of the log). The last one of each run is kept in memory and shown as
// «Thinking… 1,240 tokens · 0:12».

import { useSyncExternalStore } from 'react';

export type RunProgress = {
  run_id: string;
  call_id: string;
  provider: string;
  model: string;
  started_at: string;
  events: number;
  tokens: number | null;
  last_kind: string | null;
};

const byRun = new Map<string, RunProgress>();
/** When this tab last heard from each run's provider (for "Stalled", DESIGN.md §4.2). */
const seenAt = new Map<string, number>();
/** When this tab started listening: a run with no message yet counts its silence from here. */
export const listeningSince = Date.now();
const listeners = new Set<() => void>();

/**
 * Keeps the progress of a run, never going back within one call: a message that arrives late (fewer
 * events) is dropped, and the tokens shown only grow. A new call of the run (a fresh retry) starts again.
 */
export function recordProgress(p: RunProgress, at = Date.now()): void {
  seenAt.set(p.run_id, at);
  const shown = byRun.get(p.run_id);
  if (shown && shown.call_id === p.call_id) {
    if (p.events < shown.events) return;
    const tokens = Math.max(shown.tokens ?? 0, p.tokens ?? 0);
    byRun.set(p.run_id, { ...p, tokens: tokens > 0 ? tokens : null });
  } else {
    byRun.set(p.run_id, p);
  }
  for (const l of listeners) l();
}

export function progressOf(runId: string): RunProgress | undefined {
  return byRun.get(runId);
}

/** When this tab last received progress of a run, or null if it never did. */
export function lastProgressAt(runId: string): number | null {
  return seenAt.get(runId) ?? null;
}

export function useRunProgress(runId: string | undefined): RunProgress | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (runId ? byRun.get(runId) : undefined),
  );
}

const KIND_WORDS: Record<string, string> = {
  started: 'Starting',
  thinking: 'Thinking',
  message: 'Writing',
  usage: 'Finishing',
  result: 'Finishing',
  error: 'Something went wrong',
};

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** «Thinking… 1,240 tokens · 0:12»: what the provider is doing, what it has written and for how long. */
export function progressText(p: RunProgress, now: number): string {
  const doing = KIND_WORDS[p.last_kind ?? 'started'] ?? 'Working';
  const tokens = p.tokens ? ` ${p.tokens.toLocaleString('en-GB')} tokens ·` : '';
  return `${doing}…${tokens} ${clock(now - new Date(p.started_at).getTime())}`;
}
