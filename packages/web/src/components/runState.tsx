// The state of a run as the person reads it (DESIGN.md §4.2). The server's states (queued, running,
// completed, failed, cancelled, interrupted) plus two readings of the UI, always worded as such:
// Late (queued for more than a minute) and Stalled (running, and this tab has heard nothing from
// its engine for 90 s). Failed and Interrupted keep apart: one is the content, the other DEMIURGO
// restarting (R09, R29, D-011).

import { lastProgressAt, lastTokenMoveAt, listeningSince, useRunProgress } from '../api/progress.ts';
import type { RunListItem } from '../api/types.ts';
import type { Locale } from '../i18n/locale.ts';
import { duration } from '../lib/time.ts';
import { type MarkKind, stateWordFor, useSafeLocale } from '../words.ts';
import { StatusBadge } from './status.tsx';
import { useNow } from './Time.tsx';

export const LATE_AFTER_MS = 60_000;
export const STALLED_AFTER_MS = 90_000;
/** Without history, a model that goes quiet this long (no events, no new tokens) reads as Stalled (convention nuestra). */
export const STALLED_NO_HISTORY_MS = 300_000;
/** With history, Stalled also needs the run to be over this many times the typical p80 duration (convention nuestra). */
export const STALLED_MARGIN = 2;
/** Without history, a token counter that has not moved for this long reads as «Writing the result…» (convention nuestra). */
export const WRITING_QUIET_MS = 20_000;
/** «Taking longer than usual» as soon as the run passes its typical p80 duration (convention nuestra: no slack, so the wait is never silent). */
export const SLOW_MARGIN = 1;
/** The history is only used from this many completed runs (convention nuestra). */
export const MIN_HISTORY = 3;

export type RunKind = 'queued' | 'late' | 'working' | 'stalled' | 'completed' | 'failed' | 'interrupted' | 'cancelled';

export type RunView = {
  kind: RunKind;
  word: string;
  mark: MarkKind;
  /** The UI's reading, in words ("No sign of activity for 2:10"), for late and stalled. */
  detail: string | null;
  active: boolean;
  /** «Usually takes about 8 min», when the action has enough history; else null. */
  usually: string | null;
  /** «Writing the result…»: the counter is quiet but the run is within its usual time; else null. */
  writing: string | null;
};

type RunLike = Pick<RunListItem, 'state' | 'created_at' | 'started_at' | 'finished_at'> & {
  typical?: RunListItem['typical'];
};

/** The typical duration, only when there are enough completed runs behind it. */
function history(run: RunLike) {
  const t = run.typical;
  return t && t.n >= MIN_HISTORY && t.median_s > 0 ? t : null;
}

const minutesOf = (s: number) => Math.max(1, Math.round(s / 60));

export function isActive(state: string): boolean {
  return state === 'queued' || state === 'running';
}

const RUN_WORDS_ES: Record<'late' | 'queued' | 'stalled' | 'working', string> = {
  late: 'Tarde',
  queued: 'En cola',
  stalled: 'Estancada',
  working: 'En curso',
};

/** Pure: the state to show for a run at `now`, given when this tab last heard from its engine. */
export function runView(
  run: RunLike,
  {
    now,
    lastProgress,
    lastTokenMove = null,
    since = listeningSince,
    locale = 'en',
  }: { now: number; lastProgress: number | null; lastTokenMove?: number | null; since?: number; locale?: Locale },
): RunView {
  const w = locale === 'es' ? RUN_WORDS_ES : { late: 'Late', queued: 'Queued', stalled: 'Stalled', working: 'Working' };
  if (run.state === 'queued') {
    const waited = now - new Date(run.created_at).getTime();
    if (waited > LATE_AFTER_MS)
      return {
        kind: 'late',
        word: w.late,
        mark: 'stale',
        detail: locale === 'es' ? `En cola desde hace ${duration(waited)}` : `Queued for ${duration(waited)}`,
        active: true,
        usually: null,
        writing: null,
      };
    return { kind: 'queued', word: w.queued, mark: 'working', detail: null, active: true, usually: null, writing: null };
  }
  if (run.state === 'running') {
    const started = run.started_at ? new Date(run.started_at).getTime() : since;
    const heard = lastProgress ?? Math.max(since, started);
    const silent = now - heard;
    const elapsed = now - started;
    const typical = history(run);
    const min = typical ? minutesOf(typical.median_s) : null;
    const usually = min === null ? null : locale === 'es' ? `Suele tardar unos ${min} min` : `Usually takes about ${min} min`;
    // With history, Stalled waits for the typical p80 plus the margin: a long single output is not a fault.
    const slow = typical !== null && elapsed > typical.p80_s * 1000 * SLOW_MARGIN;
    const slowWords =
      locale === 'es'
        ? `Tarda más de lo habitual (suele tardar unos ${min} min)`
        : `Taking longer than usual (usually about ${min} min)`;
    const quietSince = lastTokenMove ?? Math.max(since, started);
    const tokensQuiet = now - quietSince;
    // Thinking is not stalling: while events or tokens keep arriving the run is working. Stalled needs
    // both to be quiet, and either the typical duration far exceeded or, without history, a long silence.
    const stalled =
      Math.min(silent, tokensQuiet) > (typical === null ? STALLED_NO_HISTORY_MS : STALLED_AFTER_MS) &&
      (typical === null || elapsed > typical.p80_s * 1000 * STALLED_MARGIN);
    if (stalled)
      return {
        kind: 'stalled',
        word: w.stalled,
        mark: 'stale',
        detail: slow
          ? slowWords
          : locale === 'es'
            ? `Sin señales de actividad desde hace ${duration(silent)}`
            : `No sign of activity for ${duration(silent)}`,
        active: true,
        usually,
        writing: null,
      };
    const writing =
      typical && elapsed < typical.p80_s * 1000 && now - quietSince > WRITING_QUIET_MS
        ? locale === 'es'
          ? 'Escribiendo el resultado…'
          : 'Writing the result…'
        : null;
    return {
      kind: 'working',
      word: w.working,
      mark: 'working',
      detail: slow ? slowWords : null,
      active: true,
      usually,
      writing,
    };
  }
  const state = stateWordFor(locale, 'ai_run', run.state);
  const kind: RunKind =
    run.state === 'completed' || run.state === 'failed' || run.state === 'cancelled' || run.state === 'interrupted'
      ? run.state
      : 'failed';
  return { kind, word: state.word, mark: state.mark, detail: null, active: false, usually: null, writing: null };
}

/** The live state of one run: re-evaluated every second while active and on each progress message. */
export function useRunView(run: RunLike & { id: string }): RunView {
  const active = isActive(run.state);
  const now = useNow(active);
  const locale = useSafeLocale();
  useRunProgress(active ? run.id : undefined);
  return runView(run, { now, lastProgress: lastProgressAt(run.id), lastTokenMove: lastTokenMoveAt(run.id), locale });
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
  // A later run of the same action on the same scope that completed resolves it too (e.g. a turn
  // interrupted by a restart, answered by the thread's next turns).
  const superseded = (r: RunListItem) =>
    runs.some(
      (x) =>
        x.state === 'completed' &&
        // A retry resolves the run it retried, not others: only a fresh run moves the scope on.
        !x.retry_of &&
        x.action === r.action &&
        x.scope.type === r.scope.type &&
        x.scope.id === r.scope.id &&
        new Date(x.created_at).getTime() > new Date(r.created_at).getTime(),
    );
  return runs.filter(
    (r) =>
      (r.state === 'failed' || r.state === 'interrupted') &&
      !retried.has(r.id) &&
      !superseded(r) &&
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
