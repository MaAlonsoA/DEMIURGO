// Small dependency-free SVG charts of the Observability screen. They follow Shneiderman's visual
// information-seeking mantra, «Overview first, zoom and filter, then details-on-demand» (B. Shneiderman,
// «The Eyes Have It», IEEE Symposium on Visual Languages, 1996): a chart says the headline, the table behind
// it stays one click away. Colors come only from the theme tokens (fill-*/stroke-* classes); every chart is
// role="img" with an aria-label that summarises its data, and nothing is told by color alone (labels and
// numbers sit next to the marks).

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

export type Tone = 'accent' | 'success' | 'danger' | 'warning' | 'info' | 'muted';

const FILL: Record<Tone, string> = {
  accent: 'fill-accent',
  success: 'fill-success',
  danger: 'fill-danger',
  warning: 'fill-warning',
  info: 'fill-info',
  muted: 'fill-fg-3',
};
const TEXT: Record<Tone, string> = {
  accent: 'text-accent-text',
  success: 'text-success-text',
  danger: 'text-danger-text',
  warning: 'text-warning-text',
  info: 'text-info-text',
  muted: 'text-fg-2',
};

export type BarRow = {
  key: string;
  label: ReactNode;
  /** Plain-text label for the aria summary. */
  name: string;
  /** null: no bar (not enough data); the display text says why. */
  value: number | null;
  /** The number shown at the right end of the row. */
  display: string;
  tone?: Tone;
};

/**
 * Horizontal bars on one shared scale (0 to `max`), with an optional target marker drawn as a vertical rule on
 * every row so the eye compares each bar with it.
 */
export function BarRows({ rows, max = 1, target, summary }: { rows: BarRow[]; max?: number; target?: number; summary: string }) {
  const at = (v: number) => Math.max(0, Math.min(100, (v / (max || 1)) * 100));
  return (
    <ul className="flex flex-col gap-2" aria-label={summary}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(6rem,12rem)_1fr_minmax(5rem,auto)] items-center gap-3 text-sm">
          <span className="min-w-0 break-words text-fg">{r.label}</span>
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-3 w-full" role="img" aria-label={`${r.name}: ${r.display}`}>
            <rect x="0" y="0" width="100" height="10" className="fill-sunken" />
            {r.value === null ? null : <rect x="0" y="0" width={at(r.value)} height="10" className={FILL[r.tone ?? 'accent']} />}
            {target === undefined ? null : (
              <line x1={at(target)} x2={at(target)} y1="-1" y2="11" className="stroke-fg" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          <span className={cn('text-right tabular-nums', r.value === null ? 'text-fg-3' : 'text-fg-2')}>{r.display}</span>
        </li>
      ))}
    </ul>
  );
}

export type Part = { key: string; label: string; value: number; tone: Tone };

/** One bar split into proportions, with a legend that carries the words and the numbers. */
export function StackedBar({ parts, summary }: { parts: Part[]; summary: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  let x = 0;
  return (
    <div className="flex flex-col gap-2">
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-3 w-full" role="img" aria-label={summary}>
        <rect x="0" y="0" width="100" height="10" className="fill-sunken" />
        {total === 0
          ? null
          : parts.map((p) => {
              const w = (p.value / total) * 100;
              const rect = <rect key={p.key} x={x} y="0" width={w} height="10" className={FILL[p.tone]} />;
              x += w;
              return w > 0 ? rect : null;
            })}
      </svg>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-fg-2">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <rect width="10" height="10" className={FILL[p.tone]} />
            </svg>
            <span>{p.label}</span>
            <span className="tabular-nums text-fg">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A line over time; missing points (null) leave a gap. An optional target is a dashed horizontal rule. */
export function Sparkline({ values, summary, target, min, max }: { values: (number | null)[]; summary: string; target?: number; min?: number; max?: number }) {
  const real = values.filter((v): v is number => v !== null);
  if (real.length === 0) return null;
  const lo = min ?? Math.min(...real, ...(target === undefined ? [] : [target]));
  const hi = max ?? Math.max(...real, ...(target === undefined ? [] : [target]));
  const span = hi - lo || 1;
  const x = (i: number) => (values.length === 1 ? 50 : (i / (values.length - 1)) * 100);
  const y = (v: number) => 22 - ((v - lo) / span) * 20;
  const segments: string[] = [];
  let run: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) segments.push(run.join(' '));
      run = [];
    } else run.push(`${x(i)},${y(v)}`);
  });
  if (run.length) segments.push(run.join(' '));
  const last = values.length - 1 - [...values].reverse().findIndex((v) => v !== null);
  const lastValue = values[last] ?? lo;
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-10 w-full" role="img" aria-label={summary}>
      <line x1="0" x2="100" y1="23" y2="23" className="stroke-edge" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {target === undefined ? null : (
        <line x1="0" x2="100" y1={y(target)} y2={y(target)} className="stroke-fg-3" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      )}
      {segments.map((pts) =>
        pts.includes(' ') ? <polyline key={pts} points={pts} fill="none" className="stroke-accent" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null,
      )}
      <line x1={x(last)} x2={x(last)} y1={y(lastValue)} y2={y(lastValue)} className="stroke-accent" strokeWidth="7" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A big number with its label and, when there is one, how it moved. */
export function Stat({ value, label, delta, deltaTone = 'muted' }: { value: ReactNode; label: ReactNode; delta?: ReactNode; deltaTone?: Tone }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-2xl font-semibold tabular-nums text-fg">{value}</div>
      <div className="text-sm text-fg-2">{label}</div>
      {delta ? <div className={cn('text-sm tabular-nums', TEXT[deltaTone])}>{delta}</div> : null}
    </div>
  );
}
