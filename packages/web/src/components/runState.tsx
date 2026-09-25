// The state of a run as the person reads it (DESIGN.md §4.2). The server's states (queued, running,
// completed, failed, cancelled, interrupted) plus two readings of the UI, always worded as such:
// Late (queued for more than a minute) and Stalled (running, and this tab has heard nothing from
// its engine for 90 s). Failed and Interrupted keep apart: one is the content, the other DEMIURGO
// restarting (R09, R29, D-011).

import { listeningSince, lastProgressAt, useRunProgress } from '../api/progress.ts';
import type { RunListItem } from '../api/types.ts';
import { duration } from '../lib/time.ts';
import { type MarkKind, stateWord } from '../words.ts';
import { StatusBadge } from './status.tsx';
import { useNow } from './Time.tsx';

export const LATE_AFTER_MS = 60_000;
export const STALLED_AFTER_MS = 90_000;

export type RunKind = 'queued' | 'late' | 'working' | 'stalled' | 'completed' | 'failed' | 'interrupted' | 'cancelled';

export type RunView = {
  kind: RunKind;
  word: string;
  mark: MarkKind;
  /** The UI's reading, in words ("No sign of activity for 2:10"), for late and stalled. */
  detail: string | null;
  active: boolean;
};

type RunLike = Pick<RunListItem, 'state' | 'created_at' | 'started_at' | 'finished_at'>;

export function isActive(state: string): boolean {
  return state === 'queued' || state === 'running';
}

/** Pure: the state to show for a run at `now`, given when this tab last heard from its engine. */
export function runView(
  run: RunLike,
  { now, lastProgress, since = listeningSince }: { now: number; lastProgress: number | null; since?: number },
): RunView {
  if (run.state === 'queued') {
    const waited = now - new Date(run.created_at).getTime();
    if (waited > LATE_AFTER_MS)
      return { kind: 'late', word: 'Late', mark: 'stale', detail: `Queued for ${duration(waited)}`, active: true };
    return { kind: 'queued', word: 'Queued', mark: 'working', detail: null, active: true };
  }
  if (run.state === 'running') {
    const started = run.started_at ? new Date(run.started_at).getTime() : since;
    const heard = lastProgress ?? Math.max(since, started);
    const silent = now - heard;
    if (silent > STALLED_AFTER_MS)
      return {
        kind: 'stalled',
        word: 'Stalled',
        mark: 'stale',
        detail: `No sign of activity for ${duration(silent)}`,
        active: true,
      };
    return { kind: 'working', word: 'Working', mark: 'working', detail: null, active: true };
  }
  const w = stateWord('ai_run', run.state);
  const kind: RunKind =
    run.state === 'completed' || run.state === 'failed' || run.state === 'cancelled' || run.state === 'interrupted'
      ? run.state
      : 'failed';
  return { kind, word: w.word, mark: w.mark, detail: null, active: false };
}

/** The live state of one run: re-evaluated every second while active and on each progress message. */
export function useRunView(run: RunLike & { id: string }): RunView {
  const active = isActive(run.state);
  const now = useNow(active);
  useRunProgress(active ? run.id : undefined);
  return runView(run, { now, lastProgress: lastProgressAt(run.id) });
}

/** The badge of a run's state, Late and Stalled included. */
export function RunStateBadge({
  run,
  size = 'sm',
  withDetail,
  className,
}: {
  run: RunLike & { id: string };
  size?: 'sm' | 'md';
  /** Also say the reading ("No sign of activity for 2:10") next to the badge. */
  withDetail?: boolean;
  className?: string;
}) {
  const v = useRunView(run);
  return (
    <span className={className ? `inline-flex items-center gap-2 ${className}` : 'inline-flex items-center gap-2'}>
      <StatusBadge kind={v.mark} word={v.word} size={size} />
      {withDetail && v.detail ? <span className="text-sm text-warning-text">{v.detail}</span> : null}
    </span>
  );
}

/** Failed or interrupted in the last 24 h and never retried: what the sidebar counts (D-011). */
export function unresolvedFailures(runs: readonly RunListItem[], now: number): RunListItem[] {
  const retried = new Set(runs.map((r) => r.retry_of).filter((id): id is string => Boolean(id)));
  return runs.filter(
    (r) =>
      (r.state === 'failed' || r.state === 'interrupted') &&
      !retried.has(r.id) &&
      now - new Date(r.finished_at ?? r.created_at).getTime() < 24 * 3_600_000,
  );
}

/** Which attempt a run is: 1 for an original, n for the (n-1)th retry of it. */
export function attemptOf(run: Pick<RunListItem, 'retry_of'>, runs: readonly Pick<RunListItem, 'id' | 'retry_of'>[]): number {
  const byId = new Map(runs.map((r) => [r.id, r]));
  let n = 1;
  let at = run.retry_of;
  const seen = new Set<string>();
  while (at && !seen.has(at)) {
    seen.add(at);
    n += 1;
    at = byId.get(at)?.retry_of ?? null;
  }
  return n;
}
