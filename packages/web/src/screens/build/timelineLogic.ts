// Pure helpers of the build timeline view (Lanes and Path): the time scale, the ticks, which attempt is shown
// first and the state of each stage of an attempt. No React, no clock: `now` comes from the server's answer.

import type { BuildTimeline, FlowShares, TimelineAttempt, TimelineRequest, TimelineSegment } from '../../api/types.ts';

export const ms = (iso: string): number => new Date(iso).getTime();

/** The stages the Path draws, in order: the ones where time is real work or waiting. The mechanical ones (branch, commit, checks, pull request) are one quiet line. */
export const PATH_STAGES = ['prepare', 'builder', 'ci', 'review', 'merge', 'main'] as const;

/**
 * The columns of the Path stepper: CI and review share one column as two parallel branches (fork after Build, join
 * before Merge). Practice: fork/join notation of UML activity diagrams and the parallel gateway of BPMN. An attempt
 * from before the parallel run (ci, then review) has the same layout; its branches just do not overlap in time.
 */
export const PATH_COLUMNS = [['prepare'], ['builder'], ['ci', 'review'], ['merge'], ['main']] as const;

/** True when a review segment overlaps a CI segment in time: the two ran at the same time in this attempt. */
export function reviewOverlapsCi(attempt: TimelineAttempt): boolean {
  const ci = attempt.segments.filter((s) => s.stage === 'ci');
  return attempt.segments.some((r) => r.stage === 'review' && ci.some((c) => ms(r.start) < ms(c.end) && ms(c.start) < ms(r.end)));
}

const FLAT_RANK: Record<TimelineSegment['kind'], number> = { builder: 0, review: 1, prep: 2, light: 3, wait: 4, main: 5 };

/**
 * The segments as consecutive, non-overlapping pieces, for a single bar (the attempt ladder): where two overlap
 * the piece takes the one that ranks first (builder, review, then the rest). Uncovered time is left out.
 */
export function flattenSegments(segments: readonly TimelineSegment[]): TimelineSegment[] {
  const cuts = [...new Set(segments.flatMap((s) => [ms(s.start), ms(s.end)]))].sort((a, b) => a - b);
  const out: TimelineSegment[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k] as number;
    const b = cuts[k + 1] as number;
    const top = segments.filter((s) => ms(s.start) <= a && ms(s.end) >= b).sort((x, y) => FLAT_RANK[x.kind] - FLAT_RANK[y.kind])[0];
    if (!top) continue;
    const prev = out.at(-1);
    if (prev && prev.stage === top.stage && prev.kind === top.kind && ms(prev.end) === a) prev.end = new Date(b).toISOString();
    else out.push({ ...top, start: new Date(a).toISOString(), end: new Date(b).toISOString() });
  }
  return out;
}

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

const STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360];

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

/**
 * The attempt a link asks for: the request by id, else the latest request of the task; the attempt asked, else its last.
 * Null when nothing is asked or the request is not in the timeline window.
 */
export function selectionFromSearch(tl: BuildTimeline, search: { task?: string; request?: string; attempt?: number }): Selection | null {
  if (!search.task && !search.request) return null;
  const request = search.request
    ? tl.requests.find((r) => r.id === search.request)
    : [...tl.requests].reverse().find((r) => r.task_code === search.task);
  const attempt = request?.attempts.find((a) => a.n === search.attempt) ?? request?.attempts[request.attempts.length - 1];
  return request && attempt ? { request: request.id, attempt: attempt.n } : null;
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

/** The Path column each stage sits in (index into PATH_COLUMNS). */
export const STAGE_COLUMN: Record<string, number> = { prepare: 0, builder: 1, ci: 2, review: 2, merge: 3, main: 4 };

/**
 * How many Path columns an attempt draws in the chain. An attempt that ended before the later stages stops after its
 * last reached stage (its pending tail is not drawn). A merged attempt, and the last one while it is still going,
 * draw everything (the last also shows CI on main, pending); an earlier unfinished one stops at Merge.
 */
export function attemptColumns(attempt: TimelineAttempt, isLast: boolean): number {
  const terminal = attempt.result === 'failed' || attempt.result === 'changes_requested' || attempt.result === 'cancelled';
  if (attempt.merged_at) return PATH_COLUMNS.length;
  if (!terminal) return isLast ? PATH_COLUMNS.length : PATH_COLUMNS.length - 1;
  let last = 0;
  for (const [stage, st] of stageStates(attempt)) if (st.state !== 'pending') last = Math.max(last, STAGE_COLUMN[stage] ?? 0);
  const endCol = attempt.ended_by ? STAGE_COLUMN[attempt.ended_by.stage] : undefined;
  if (endCol !== undefined) last = Math.max(last, endCol);
  return last + 1;
}

export type ChainBlock = { n: number; x: number; cols: number; width: number };

/** Where each attempt block of the chain starts (x) and how wide it is; `gap` is the space the rework connector crosses. */
export function chainLayout(attempts: readonly TimelineAttempt[], nodeW: number, gap: number): { blocks: ChainBlock[]; width: number } {
  const blocks: ChainBlock[] = [];
  let x = 0;
  attempts.forEach((a, i) => {
    const cols = attemptColumns(a, i === attempts.length - 1);
    blocks.push({ n: a.n, x, cols, width: cols * nodeW });
    x += cols * nodeW + gap;
  });
  return { blocks, width: Math.max(0, x - gap) };
}

/** The scrollLeft that makes a block visible (centred when it was out of view); unchanged when it already is. */
export function scrollTargetFor(blockX: number, blockW: number, scrollLeft: number, viewW: number): number {
  if (viewW <= 0 || (blockX >= scrollLeft && blockX + blockW <= scrollLeft + viewW)) return scrollLeft;
  return Math.max(0, blockX + blockW / 2 - viewW / 2);
}

/** «build 40 % · CI 50 % · review 3 % · wait 7 %»: the shares that are not 0, in that order. */
export function sharesLine(shares: FlowShares, names: Record<keyof FlowShares, string>): string {
  return (['build', 'ci', 'review', 'wait'] as const)
    .filter((k) => shares[k] > 0)
    .map((k) => `${names[k]} ${shares[k]} %`)
    .join(' · ');
}

/** The tightest zoom: pixels per minute. */
export const MAX_PX_PER_MIN = 300;
/** Space after «now» at the right end of the chart, in px. */
export const CHART_TAIL = 90;

export const clampPx = (px: number, minPx: number, maxPx = MAX_PX_PER_MIN): number => Math.min(maxPx, Math.max(Math.min(minPx, maxPx), px));

/** Pixels per minute that fit `spanMin` minutes in `availablePx`. */
export function fitPx(spanMin: number, availablePx: number): number {
  return availablePx > 0 && spanMin > 0 ? availablePx / spanMin : 0.05;
}

/** New scrollLeft after zooming from `oldPx` to `newPx` keeping the time under `anchorX` (px from the chart's visible left edge) still. */
export function zoomScroll(scrollLeft: number, anchorX: number, oldPx: number, newPx: number): number {
  return Math.max(0, ((scrollLeft + anchorX) * newPx) / oldPx - anchorX);
}

/** Zoom and scroll that show [start, end] (ms) with a 10 % margin each side in `availablePx`, in a chart that starts at `from`. */
export function fitRange(from: number, start: number, end: number, availablePx: number, minPx: number): { px: number; scrollLeft: number } {
  const spanMin = Math.max(1, (end - start) / 60_000);
  const margin = spanMin * 0.1;
  const px = clampPx(fitPx(spanMin + 2 * margin, availablePx), minPx);
  return { px, scrollLeft: Math.max(0, ((start - from) / 60_000 - margin) * px) };
}

/** The time range (ms) the chart shows: `viewPx` of chart area starting `scrollLeft` px from the chart's left edge. */
export function visibleRange(from: number, scrollLeft: number, viewPx: number, pxPerMin: number): { start: number; end: number } {
  const start = from + (scrollLeft / pxPerMin) * 60_000;
  return { start, end: start + (Math.max(0, viewPx) / pxPerMin) * 60_000 };
}

/** The latest moment anything happened in the row (end of its last attempt or segment). */
export function lastActivity(r: TimelineRequest): number {
  let last = ms(r.end);
  for (const a of r.attempts) {
    last = Math.max(last, ms(a.end));
    for (const s of a.segments) last = Math.max(last, ms(s.end));
  }
  return last;
}

/** True when any segment (attempt bar, wait, CI on main) of the row intersects the range; an attempt without segments counts by its own span. */
export function intersectsRange(r: TimelineRequest, range: { start: number; end: number }): boolean {
  const hit = (a: string, b: string) => ms(a) <= range.end && ms(b) >= range.start;
  return r.attempts.some((a) => (a.segments.length > 0 ? a.segments.some((s) => hit(s.start, s.end)) : hit(a.start, a.end)));
}

/** «Failed or needs you»: its latest attempt failed or got changes requested, or the queue stopped waiting for this task. */
export function needsAttention(r: TimelineRequest, needsYou: string | null): boolean {
  const last = r.attempts[r.attempts.length - 1];
  return r.task_code === needsYou || last?.result === 'failed' || last?.result === 'changes_requested';
}

/** Every word typed must appear in the task code, task title, feature code or feature title. */
export function matchesText(r: TimelineRequest, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [r.task_code, r.task_title, r.feature?.code, r.feature?.title].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export type RowFilter = {
  /** The visible time range; null until the box is measured (no range filtering). */
  range: { start: number; end: number } | null;
  text: string;
  running: boolean;
  attention: boolean;
  needsYou: string | null;
  /** The row chosen in the Path stays even when it is outside the range (text and status filters still apply). */
  pinned: string | null;
  /** «Zoom to attempt»: only this row. */
  focus: string | null;
};

/**
 * The rows to draw, most recent activity first. Filters combine: visible range, text, «Running», «Failed or needs you».
 * Practice: the filter bar of trace and timeline tools (Jaeger search by service and tags, Grafana and Honeycomb
 * filters, GitHub Actions run filters by status).
 */
export function filterRows(rows: TimelineRequest[], f: RowFilter): TimelineRequest[] {
  return rows
    .filter((r) => {
      if (f.focus) return r.id === f.focus;
      if (!matchesText(r, f.text)) return false;
      if (f.running && !r.running) return false;
      if (f.attention && !needsAttention(r, f.needsYou)) return false;
      return !f.range || r.id === f.pinned || intersectsRange(r, f.range);
    })
    .sort((a, b) => lastActivity(b) - lastActivity(a));
}

/** Window of row indexes [start, end) to draw for a box scrolled `scrollTop` px with `viewH` px visible; rows sit under a `headH` header. */
export function rowWindow(count: number, scrollTop: number, viewH: number, rowH: number, headH: number, overscan = 4): { start: number; end: number } {
  const first = Math.floor((scrollTop - headH) / rowH) - overscan;
  const last = Math.ceil((scrollTop + viewH - headH) / rowH) + overscan;
  const start = Math.min(count, Math.max(0, first));
  return { start, end: Math.min(count, Math.max(start, last)) };
}
