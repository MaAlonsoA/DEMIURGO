// Marks of the visual language (canvas S3A): the dots say how sure, the grey marks say it is not
// active, rust says there is a problem. Every mark has its tooltip, with the legend's phrase, and
// registers itself so the legend shows only what is on screen.

import type { ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { EPISTEMIC_MARK, MARKS, type MarkKind, OBSERVATION_WORDS, stateWord } from '../words.ts';
import { useLegendMark } from './legend-store.ts';
import { Tip } from './Tip.tsx';

const px = (n: number) => ({ width: n, height: n });

/** The glyph alone, without tooltip or legend (the legend draws its entries with it). */
export function MarkGlyph({ kind, size = 10 }: { kind: MarkKind; size?: number }): ReactNode {
  switch (kind) {
    case 'confirmed':
      return <span className="inline-block shrink-0 rounded-full bg-ink" style={px(size)} />;
    case 'assumed':
      return (
        <span
          className="inline-block shrink-0 rounded-full border-[1.5px] border-ink"
          style={{ ...px(size), background: 'linear-gradient(90deg, var(--color-ink) 50%, transparent 50%)' }}
        />
      );
    case 'proposed':
      return <span className="inline-block shrink-0 rounded-full border-2 border-needs" style={px(size)} />;
    case 'open':
      return <span className="inline-block shrink-0 rounded-full border-[1.5px] border-dashed border-ink-2" style={px(size)} />;
    case 'unknown':
      return (
        <span
          className="inline-flex shrink-0 items-center justify-center text-[12px] leading-none font-bold text-ink-2"
          style={px(size + 2)}
        >
          ?
        </span>
      );
    case 'parked':
      return (
        <svg width={size + 2} height={size + 2} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
          <rect x="2" y="1.5" width="3" height="9" rx="1" fill="var(--color-inactive)" />
          <rect x="7" y="1.5" width="3" height="9" rx="1" fill="var(--color-inactive)" />
        </svg>
      );
    case 'dropped':
      return (
        <svg width={size + 2} height={size + 2} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
          <circle cx="6" cy="6" r="5" fill="none" stroke="var(--color-inactive)" strokeWidth="1.5" />
          <path d="M2.6 9.4l6.8-6.8" stroke="var(--color-inactive)" strokeWidth="1.5" />
        </svg>
      );
    case 'replaced':
      return (
        <svg width={size + 3} height={size + 3} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
          <circle cx="4.4" cy="7.2" r="3.4" fill="var(--color-inactive-light)" />
          <circle cx="7.6" cy="4.8" r="3.4" fill="#FFFFFF" stroke="var(--color-inactive)" strokeWidth="1.2" />
        </svg>
      );
    case 'stale':
      return (
        <svg width={size + 3} height={size + 3} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
          <circle cx="12" cy="12" r="9" fill="none" stroke="var(--color-inactive)" strokeWidth="2" />
          <path d="M12 7v5l3 2" fill="none" stroke="var(--color-inactive)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'conflict':
    case 'problem':
      return (
        <svg width={size + 4} height={size + 4} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
          <path d="M12 3l9.5 17h-19z" fill="none" stroke="var(--color-problem)" strokeWidth="2" strokeLinejoin="round" />
          <path d="M12 10v4M12 17.5v.01" stroke="var(--color-problem)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'working':
      return (
        <span
          className="inline-block shrink-0 animate-pulse-soft rounded-full bg-working"
          style={{ ...px(size - 2), boxShadow: '0 0 0 3px var(--color-working-bg)' }}
        />
      );
    case 'inactive':
      return <span className="inline-block shrink-0 rounded-full bg-inactive-light" style={px(size)} />;
    case 'done':
      return (
        <svg width={size + 2} height={size + 2} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
          <path d="M2.5 6.5l2.3 2.3L9.5 3.8" fill="none" stroke="var(--color-ink)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}

/** A mark with its tooltip; it appears in the legend while it is on screen. */
export function Mark({ kind, size = 10, label }: { kind: MarkKind; size?: number; label?: string }) {
  useLegendMark(`mark:${kind}`);
  const m = MARKS[kind];
  return (
    <Tip text={`${label ?? m.name} · ${m.phrase}`}>
      <span role="img" aria-label={label ?? m.name} data-mark={kind} className="inline-flex items-center">
        <MarkGlyph kind={kind} size={size} />
      </span>
    </Tip>
  );
}

const WORD_TONE: Partial<Record<MarkKind, string>> = {
  proposed: 'text-needs-hover',
  stale: 'text-muted',
  parked: 'text-muted',
  dropped: 'text-muted',
  replaced: 'text-muted',
  inactive: 'text-muted',
  problem: 'text-problem',
  conflict: 'text-problem',
  working: 'text-working-text',
};

/** Mark and word together, as in zone 2 of the card: "○ Proposed". */
export function MarkWord({ kind, word, className }: { kind: MarkKind; word: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', WORD_TONE[kind] ?? 'text-ink', className)}>
      <Mark kind={kind} label={word} />
      <span>{word}</span>
    </span>
  );
}

/** The mark and word of an entity's state (spec §6). */
export function StateMark({
  entity,
  state,
  fallback,
  className,
}: {
  entity: string;
  state: string;
  fallback?: string;
  className?: string;
}) {
  const w = stateWord(entity, state, fallback);
  return <MarkWord kind={w.mark} word={w.word} {...(className ? { className } : {})} />;
}

/** Epistemic status as the API gives it (confirmed, proposed, pending, unknown). */
export function EpistemicMark({ status, withWord = false }: { status: string | null; withWord?: boolean }) {
  const kind = EPISTEMIC_MARK[status ?? 'unknown'] ?? 'unknown';
  return withWord ? <MarkWord kind={kind} word={MARKS[kind].name} /> : <Mark kind={kind} />;
}

/** Chip of an observation of DEMIURGO: claim or hypothesis (Proposed), unknown (?). */
export function ObservationChip({ kind }: { kind: string }) {
  const w = OBSERVATION_WORDS[kind] ?? { word: kind, mark: 'unknown' as const };
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-2">
      <Mark kind={w.mark} size={8} label={w.word} />
      {w.word.toLowerCase()}
    </span>
  );
}
