// The design system's StageBars, the blue NeedsYou counter and WhoMark, with the app's tooltip and
// legend registration (canvas S3A and S3B).

import { NeedsYou, StageBars as DsStageBars, type Stage as DsStage, WhoMark as DsWhoMark } from '@demiurgo/design-system';
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

/** In H1 only the first bar lives: ready shows built and verified as still to come. */
const DS_STAGE: Record<Stage, DsStage> = { 'not-ready': 'not-ready', ready: 'first-only', doubt: 'in-doubt' };

export function BarsGlyph({ stage }: { stage: Stage }) {
  return <DsStageBars stage={DS_STAGE[stage]} title="" />;
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

/** The design system's blue counter. */
export function NeedsGlyph({ count }: { count: number }) {
  return <NeedsYou count={count} />;
}

/** The blue count: one symbol and one phrase in the whole app. Only when something waits for you. */
export function NeedsBubble({ count, detail }: { count: number; detail?: string }) {
  useLegendMark(count > 0 ? 'needs' : null);
  if (count <= 0) return null;
  return (
    <Tip text={detail ?? `Needs you: ${count} ${count === 1 ? 'thing waits' : 'things wait'} for you.`}>
      <span role="img" aria-label={`Needs you: ${count}`} data-needs={count} className="inline-flex tabular-nums">
        <NeedsYou count={count} />
      </span>
    </Tip>
  );
}

export function WhoGlyph({ kind, size = 18 }: { kind: Who['kind']; size?: number }) {
  return <DsWhoMark who={kind} size={size} title="" />;
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
        {withName && <span className="text-ink-2">{who.name}</span>}
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
