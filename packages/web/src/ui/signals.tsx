// Bars, the blue "Needs you" count and "who" (canvas S3A and S3B).

import type { ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { WHO_PHRASES, type Who, whoOf } from '../words.ts';
import { useLegendMark } from './legend-store.ts';
import { Tip } from './Tip.tsx';

/** Stage of the first bar: empty (not ready), ink (ready to build) or rust (was ready, now in doubt). */
export type Stage = 'not-ready' | 'ready' | 'doubt';

export const STAGE_WORDS: Record<Stage, { name: string; phrase: string }> = {
  'not-ready': { name: 'Not ready', phrase: 'Something still blocks it. Not built.' },
  ready: { name: 'Ready to build', phrase: 'Confirmed, nothing blocks it. Not built yet.' },
  doubt: { name: 'In doubt', phrase: 'It was ready to build, and now something blocks it.' },
};

export function BarsGlyph({ stage }: { stage: Stage }) {
  return (
    <span className="inline-flex shrink-0 gap-[3px]" aria-hidden="true">
      <span
        className={cn(
          'h-1.5 w-2.5 rounded-[2px]',
          stage === 'ready' && 'bg-ink',
          stage === 'doubt' && 'bg-problem-fill',
          stage === 'not-ready' && 'border border-bar-empty',
        )}
      />
      {/* Built and verified do not exist until Pillar 2: they are dashed. */}
      <span className="h-1.5 w-2.5 rounded-[2px] border border-dashed border-bar-empty" />
      <span className="h-1.5 w-2.5 rounded-[2px] border border-dashed border-bar-empty" />
    </span>
  );
}

/** The track of three bars of a feature: ready · built · verified. Only features have bars. */
export function StageBars({ stage, detail }: { stage: Stage; detail?: string }) {
  useLegendMark(`bars:${stage}`);
  const w = STAGE_WORDS[stage];
  return (
    <Tip text={detail ? `${w.name} · ${detail}` : `${w.name} · ${w.phrase}`}>
      <span role="img" aria-label={w.name} data-stage={stage} className="inline-flex items-center">
        <BarsGlyph stage={stage} />
      </span>
    </Tip>
  );
}

export function NeedsGlyph({ count, size = 'md' }: { count: number | string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-needs font-bold text-white tabular-nums',
        size === 'sm' ? 'h-5 min-w-5 px-1.5 text-[11px]' : 'h-[22px] min-w-[22px] px-1.5 text-xs',
      )}
    >
      {count}
    </span>
  );
}

/** The blue count: one symbol and one phrase in the whole app. Only when something waits for you. */
export function NeedsBubble({ count, detail, size }: { count: number; detail?: string; size?: 'sm' | 'md' }) {
  useLegendMark(count > 0 ? 'needs' : null);
  if (count <= 0) return null;
  return (
    <Tip text={detail ?? `Needs you: ${count} ${count === 1 ? 'thing waits' : 'things wait'} for you.`}>
      <span role="img" aria-label={`Needs you: ${count}`} data-needs={count} className="inline-flex">
        <NeedsGlyph count={count} {...(size ? { size } : {})} />
      </span>
    </Tip>
  );
}

export function WhoGlyph({ kind, size = 18 }: { kind: Who['kind']; size?: number }): ReactNode {
  const box = { width: size, height: size };
  const icon = Math.round(size * 0.55);
  switch (kind) {
    case 'you':
      return (
        <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-ink text-white" style={box}>
          <svg width={icon} height={icon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="8" r="4.5" />
            <path d="M3 22a9 9 0 0 1 18 0z" />
          </svg>
        </span>
      );
    case 'demiurgo':
      return (
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-[5px] bg-ink font-bold text-white"
          style={{ ...box, fontSize: Math.round(size * 0.55) }}
        >
          D
        </span>
      );
    case 'agent':
      return (
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-ink text-ink"
          style={box}
        >
          <svg
            width={icon}
            height={icon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M9 3v5M15 3v5" />
            <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
            <path d="M12 17v4" />
          </svg>
        </span>
      );
    case 'automatic':
      return (
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink text-ink"
          style={box}
        >
          <svg
            width={icon}
            height={icon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
          </svg>
        </span>
      );
  }
}

/** Who did it: You, DEMIURGO (with its model), Agent (with its name) or Automatic. */
export function WhoMark({
  actor,
  model,
  size,
  withName = false,
  className,
}: {
  actor: string;
  model?: string | null;
  size?: number;
  withName?: boolean;
  className?: string;
}) {
  const who = whoOf(actor, model);
  useLegendMark(`who:${who.kind}`);
  const label = whoLabel(who);
  return (
    <Tip text={`${label} · ${WHO_PHRASES[who.kind]}`}>
      <span role="img" aria-label={label} data-who={who.kind} className={cn('inline-flex items-center gap-1.5', className)}>
        <WhoGlyph kind={who.kind} {...(size ? { size } : {})} />
        {withName && <span className="text-ink-2">{who.kind === 'agent' ? who.name : who.name}</span>}
      </span>
    </Tip>
  );
}

export function whoLabel(who: Who): string {
  if (who.kind === 'demiurgo') return who.detail ? `DEMIURGO · ${who.detail}` : 'DEMIURGO';
  if (who.kind === 'agent') return `Agent · ${who.name}`;
  if (who.kind === 'automatic') return who.detail ? `Automatic · ${who.detail}` : 'Automatic';
  return 'You';
}
