// The walk of Catch up (DESIGN.md §3.1, INV-CATCH-*): every thing seen since the walk started, in
// the order it was met, and what the person skipped. Things that arrive meanwhile are appended; a
// thing that left Needs you counts as done. The walk is kept in sessionStorage, so opening a
// package and coming back does not lose the position or the skips (INVENTORY Part D §2, UX problem).

import type { NeedItem } from './order.ts';

export type Step = { key: string; kind: NeedItem['kind']; title: string };
export type Walk = { steps: Step[]; skipped: string[]; at: number };
export type StepState = 'done' | 'skipped' | 'now' | 'next';

export const STEP_WORDS: Record<StepState, string> = { done: 'Done', skipped: 'Skipped', now: 'Now', next: 'Next' };

/** A walk left alone for this long starts again. */
const STALE_MS = 2 * 3_600_000;

export const emptyWalk = (): Walk => ({ steps: [], skipped: [], at: Date.now() });

/** The walk with the things it hasn't met yet appended, in the order given (Catch up order). */
export function extendWalk(walk: Walk, ordered: readonly NeedItem[], titleOf: (item: NeedItem) => string): Walk {
  const known = new Set(walk.steps.map((s) => s.key));
  const fresh = ordered.filter((i) => !known.has(i.key));
  if (fresh.length === 0) return walk;
  return { ...walk, steps: [...walk.steps, ...fresh.map((i) => ({ key: i.key, kind: i.kind, title: titleOf(i) }))] };
}

/** The step the person is on: the first one still in Needs you and not skipped. */
export function currentStep(walk: Walk, present: ReadonlySet<string>): Step | undefined {
  return walk.steps.find((s) => present.has(s.key) && !walk.skipped.includes(s.key));
}

export function stepState(step: Step, walk: Walk, present: ReadonlySet<string>, current: string | undefined): StepState {
  if (step.key === current) return 'now';
  if (!present.has(step.key)) return 'done';
  if (walk.skipped.includes(step.key)) return 'skipped';
  return 'next';
}

/** "3 of 10": how many were handled (done or skipped) plus the one on screen, of all met. */
export function walkProgress(walk: Walk, present: ReadonlySet<string>): { position: number; total: number; handled: number } {
  const handled = walk.steps.filter((s) => !present.has(s.key) || walk.skipped.includes(s.key)).length;
  const total = walk.steps.length;
  return { position: Math.min(handled + 1, total), total, handled };
}

/** The steps still ahead, the one on screen included. */
export function stepsLeft(walk: Walk, present: ReadonlySet<string>): Step[] {
  return walk.steps.filter((s) => present.has(s.key) && !walk.skipped.includes(s.key));
}

export const skip = (walk: Walk, key: string): Walk =>
  walk.skipped.includes(key) ? walk : { ...walk, skipped: [...walk.skipped, key], at: Date.now() };

const storageKey = (projectId: string) => `dm-catch-up:${projectId}`;

export function loadWalk(projectId: string, now = Date.now()): Walk | null {
  try {
    const raw = sessionStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const w = JSON.parse(raw) as Walk;
    if (!Array.isArray(w.steps) || !Array.isArray(w.skipped) || now - (w.at ?? 0) > STALE_MS) return null;
    return w;
  } catch {
    return null;
  }
}

export function saveWalk(projectId: string, walk: Walk): void {
  try {
    sessionStorage.setItem(storageKey(projectId), JSON.stringify({ ...walk, at: Date.now() }));
  } catch {
    // Storage may be unavailable: the walk then lasts while the page is open.
  }
}

export function clearWalk(projectId: string): void {
  try {
    sessionStorage.removeItem(storageKey(projectId));
  } catch {
    // Nothing kept, nothing to clear.
  }
}
