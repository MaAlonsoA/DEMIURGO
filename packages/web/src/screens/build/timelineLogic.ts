// Pure helpers of the build timeline view (Lanes and Path): the time scale, the ticks, which attempt is shown
// first and the state of each stage of an attempt. No React, no clock: `now` comes from the server's answer.

import type { BuildTimeline, TimelineAttempt, TimelineRequest } from '../../api/types.ts';

export const ms = (iso: string): number => new Date(iso).getTime();

/** The stages the Path draws, in order: the ones where time is real work or waiting. The mechanical ones (branch, commit, checks, pull request) are one quiet line. */
export const PATH_STAGES = ['prepare', 'builder', 'ci', 'review', 'merge', 'main'] as const;

const MIN_SPAN_MIN = 30;
const PAD_MIN = 1;

/** The time window the lanes draw: from the earliest start inside the asked window to now, never under 30 min. */
export function windowOf(tl: BuildTimeline): { from: number; to: number } {
  const now = ms(tl.now);
  const first = tl.requests.length > 0 ? Math.min(...tl.requests.map((r) => ms(r.start))) : now;
  let from = Math.max(ms(tl.since), first) - PAD_MIN * 60_000;
  const to = now + PAD_MIN * 60_000;
  if (to - from < MIN_SPAN_MIN * 60_000) from = to - MIN_SPAN_MIN * 60_000;
  return { from, to };
}

const STEPS_MIN = [5, 10, 15, 30, 60, 120, 180, 360];

/** Tick times (ms) at round clock minutes, spaced at least `minPx` apart at `pxPerMin`. */
export function ticksOf(from: number, to: number, pxPerMin: number, minPx = 72): number[] {
  const step = (STEPS_MIN.find((s) => s * pxPerMin >= minPx) ?? 360) * 60_000;
  const out: number[] = [];
  // Round to the local clock, not to UTC: the step divides the hour or the day.
  const offset = new Date(from).getTimezoneOffset() * 60_000;
  for (let t = Math.ceil((from - offset) / step) * step + offset; t <= to; t += step) out.push(t);
  return out;
}

/** «1 h 10 min», «14 min 30 s», «45 s»: compact, whole units. */
export function compact(valueMs: number): string {
  if (valueMs < 1000) return '<1 s';
  const total = Math.max(0, Math.round(valueMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min${s > 0 && m < 10 ? ` ${s} s` : ''}`;
  return `${s} s`;
}

export type Selection = { request: string; attempt: number };

/** What is shown before the person chooses: the build running now (its latest attempt), else the latest one. */
export function defaultSelection(tl: BuildTimeline): Selection | null {
  const running = tl.requests.filter((r) => r.running);
  const pick = running.length > 0 ? running[running.length - 1] : tl.requests[tl.requests.length - 1];
  const last = pick?.attempts[pick.attempts.length - 1];
  return pick && last ? { request: pick.id, attempt: last.n } : null;
}

/** The selection if it still exists in the data, else null. */
export function resolveSelection(tl: BuildTimeline, sel: Selection | null): { request: TimelineRequest; attempt: TimelineAttempt } | null {
  const chosen = sel ?? defaultSelection(tl);
  const request = tl.requests.find((r) => r.id === chosen?.request);
  const attempt = request?.attempts.find((a) => a.n === chosen?.attempt);
  if (request && attempt) return { request, attempt };
  if (sel) return resolveSelection(tl, null);
  return null;
}

export type StageState = 'done' | 'running' | 'failed' | 'changes' | 'cancelled' | 'pending';

/** Per stage of an attempt: its state and the time spent in it (waiting for CI counts as the stage's time). */
export function stageStates(attempt: TimelineAttempt): Map<string, { state: StageState; ms: number; wait: boolean }> {
  const out = new Map<string, { state: StageState; ms: number; wait: boolean }>();
  for (const seg of attempt.segments) {
    const prev = out.get(seg.stage);
    const state: StageState =
      seg.outcome === 'running' || seg.outcome === 'waiting' || seg.outcome === 'started'
        ? 'running'
        : seg.outcome === 'failed'
          ? 'failed'
          : seg.outcome === 'changes_requested'
            ? 'changes'
            : seg.outcome === 'cancelled'
              ? 'cancelled'
              : 'done';
    out.set(seg.stage, {
      state,
      ms: (prev?.ms ?? 0) + (ms(seg.end) - ms(seg.start)),
      wait: (prev?.wait ?? false) || seg.kind === 'wait' || seg.kind === 'main',
    });
  }
  return out;
}
