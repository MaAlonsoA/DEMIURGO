// Quantities (DESIGN.md §4.3, §6): length for amounts, never color for magnitude (R58). A meter is
// "x of y" with its words beside it; the readiness badge is a word plus a three-step track whose
// meaning is in the word (the track is decorative).

import { cn } from '../lib/cn.ts';
import { StatusBadge } from './status.tsx';

/** "3 of 5 answered" with a thin bar; the text carries the value. */
export function Meter({
  value,
  max,
  label,
  className,
  tone = 'accent',
}: {
  value: number;
  max: number;
  /** Visible words ("3 of 5 answered"). */
  label: string;
  className?: string;
  tone?: 'accent' | 'success' | 'info';
}) {
  const pct = max > 0 ? Math.round((Math.min(value, max) / max) * 100) : 0;
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(value, max)}
        aria-label={label}
        className="h-1.5 w-full min-w-12 flex-1 overflow-hidden rounded-full bg-hover"
      >
        <span
          className={cn(
            'block h-full rounded-full',
            tone === 'accent' && 'bg-accent',
            tone === 'success' && 'bg-success',
            tone === 'info' && 'bg-info',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-xs text-fg-2 tabular-nums">{label}</span>
    </div>
  );
}

export type BarSegment = { key: string; value: number; tone: 'success' | 'accent' | 'info' | 'neutral'; label: string };

/** A stacked bar with a text legend under it (the product's progress). */
export function SegmentedBar({ segments, total, className }: { segments: BarSegment[]; total: number; className?: string }) {
  if (total <= 0) return null;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div aria-hidden className="flex h-2 w-full overflow-hidden rounded-full bg-hover">
        {segments.map((s) =>
          s.value > 0 ? (
            <span
              key={s.key}
              className={cn(
                'block h-full',
                s.tone === 'success' && 'bg-success',
                s.tone === 'accent' && 'bg-accent',
                s.tone === 'info' && 'bg-info',
                s.tone === 'neutral' && 'bg-edge-strong',
              )}
              style={{ width: `${(s.value / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
        {segments.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                'h-2 w-2 rounded-full',
                s.tone === 'success' && 'bg-success',
                s.tone === 'accent' && 'bg-accent',
                s.tone === 'info' && 'bg-info',
                s.tone === 'neutral' && 'bg-edge-strong',
              )}
            />
            <span className="tabular-nums">{s.value}</span> {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type Stage = 'ready' | 'not-ready' | 'doubt';

const STAGE_WORD: Record<Stage, string> = { ready: 'Ready to build', 'not-ready': 'Not ready', doubt: 'In doubt' };
const STAGE_PHRASE: Record<Stage, string> = {
  ready: 'Confirmed, nothing blocks it. Not built yet.',
  'not-ready': 'Something still blocks it. Not built.',
  doubt: 'It was ready to build, and now something blocks it.',
};

/**
 * Readiness of a feature: the word ("Ready to build", "Not ready · 3 things", "In doubt"), a badge
 * tone, and the ready · built · verified track (only the first step is live in H1).
 */
export function Readiness({
  stage,
  blocking,
  size = 'sm',
  track = true,
  className,
}: {
  stage: Stage;
  /** Number of reasons that block it. */
  blocking?: number;
  size?: 'sm' | 'md';
  track?: boolean;
  className?: string;
}) {
  const word =
    stage === 'not-ready' && blocking ? `Not ready · ${blocking} ${blocking === 1 ? 'thing' : 'things'}` : STAGE_WORD[stage];
  return (
    <span data-stage={stage} className={cn('inline-flex items-center gap-2', className)} title={STAGE_PHRASE[stage]}>
      <StatusBadge
        kind={stage === 'ready' ? 'done' : stage === 'doubt' ? 'conflict' : 'open'}
        word={word}
        size={size}
        title={STAGE_PHRASE[stage]}
      />
      {track ? (
        <span aria-hidden className="inline-flex gap-0.5">
          <span
            className={cn(
              'h-1.5 w-3 rounded-full',
              stage === 'ready' ? 'bg-success' : stage === 'doubt' ? 'bg-danger' : 'bg-edge-strong',
            )}
          />
          <span className="h-1.5 w-3 rounded-full bg-hover" />
          <span className="h-1.5 w-3 rounded-full bg-hover" />
        </span>
      ) : null}
    </span>
  );
}

export { STAGE_PHRASE, STAGE_WORD };
