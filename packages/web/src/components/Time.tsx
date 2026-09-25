// Time in few words (DESIGN.md §6.6): relative words that stay fresh ("2 min ago"), with the
// absolute time in the element (`<time datetime>`, title) — and durations that tick while something
// works. One shared clock drives every relative time, so the page re-renders once a tick.

import { useSyncExternalStore } from 'react';
import { ago, dayTime, duration } from '../lib/time.ts';
import { cn } from '../lib/cn.ts';

type Listener = () => void;

function makeClock(ms: number) {
  let now = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<Listener>();
  return {
    subscribe: (l: Listener) => {
      listeners.add(l);
      if (!timer) {
        now = Date.now();
        timer = setInterval(() => {
          now = Date.now();
          for (const x of listeners) x();
        }, ms);
      }
      return () => {
        listeners.delete(l);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    get: () => now,
  };
}

const slow = makeClock(30_000);
const fast = makeClock(1_000);

/** The current time, refreshed every 30 s (relative words) or every second (`live`). */
export function useNow(live = false): number {
  const clock = live ? fast : slow;
  return useSyncExternalStore(clock.subscribe, clock.get, clock.get);
}

/** "2 min ago" in a <time>, with the day and time as its title. */
export function RelativeTime({
  iso,
  className,
  prefix,
}: {
  iso: string | null | undefined;
  className?: string;
  prefix?: string;
}) {
  const now = useNow();
  if (!iso) return null;
  return (
    <time dateTime={iso} title={dayTime(iso, now)} className={cn('tabular-nums', className)}>
      {prefix ? `${prefix} ` : ''}
      {ago(iso, now)}
    </time>
  );
}

/** "Thu 18:52" (or "24 Sep 18:52"). */
export function DayTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} className={cn('tabular-nums', className)}>
      {dayTime(iso)}
    </time>
  );
}

/** m:ss from `start` to `end`, ticking every second while there is no end. */
export function Elapsed({
  start,
  end,
  className,
}: {
  start: string | null | undefined;
  end?: string | null;
  className?: string;
}) {
  const now = useNow(!end);
  if (!start) return null;
  const ms = (end ? new Date(end).getTime() : now) - new Date(start).getTime();
  return <span className={cn('tabular-nums', className)}>{duration(ms)}</span>;
}
