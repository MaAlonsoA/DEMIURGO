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
const listeners = new Set<() => void>();

export function recordProgress(p: RunProgress): void {
  byRun.set(p.run_id, p);
  for (const l of listeners) l();
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
