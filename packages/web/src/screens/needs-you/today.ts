// "What you did today" (canvas S6C): the person's own events of today, told with the lines of the
// "What changed" lens, one per thing, in the order they happened.

import type { Changes } from '../../api/types.ts';
import { type LensContext, type LensLine, linesOf } from '../overview/lens/lines.ts';

function startOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** The changes, keeping only what a person did today (in this browser's day). */
export function ownToday(changes: Changes, now: Date): Changes {
  const since = startOfDay(now);
  return {
    latest: changes.latest,
    things: changes.things
      .map((t) => ({ ...t, events: t.events.filter((e) => e.actor.startsWith('human:') && Date.parse(e.at) >= since) }))
      .filter((t) => t.events.length > 0),
  };
}

export function todayLines(changes: Changes, now: Date, ctx: LensContext = {}): LensLine[] {
  return linesOf(ownToday(changes, now), ctx).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
