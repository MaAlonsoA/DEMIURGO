// Marks of the visual language, drawn by the design system: CertaintyDot says how sure, StatusMark
// says it is not active (grey) or clashes (rust), Working says someone is on it. Every mark has its
// Tooltip with the legend's phrase, and registers itself so the legend shows only what is on screen.

import { CertaintyDot, type Certainty, type Status, StatusMark, Working } from '@demiurgo/design-system';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { EPISTEMIC_MARK, MARKS, type MarkKind, OBSERVATION_WORDS, stateWord } from '../words.ts';
import { useLegendMark } from './legend-store.ts';
import { Tip } from './Tip.tsx';

const CERTAINTY: Partial<Record<MarkKind, Certainty>> = {
  confirmed: 'confirmed',
  assumed: 'assumed',
  proposed: 'proposed',
  open: 'open',
  unknown: 'unknown',
};

const STATUS: Partial<Record<MarkKind, Status>> = {
  parked: 'parked',
  dropped: 'dropped',
  replaced: 'replaced',
  stale: 'out-of-date',
  conflict: 'conflict',
  problem: 'conflict',
};

/** The glyph alone, without tooltip or legend (the legend draws its entries with it). The design
    system's dots come in two sizes: 12px, and 10px inside cards and lists. */
export function MarkGlyph({ kind, size = 10 }: { kind: MarkKind; size?: number }): ReactNode {
  const certainty = CERTAINTY[kind];
  if (certainty) return <CertaintyDot state={certainty} size={size >= 12 ? 'md' : 'sm'} title="" />;
  const status = STATUS[kind];
  if (status) return <StatusMark status={status} title="" />;
  switch (kind) {
    case 'working':
      return <Working />;
    case 'inactive':
      // Finished or stopped (a cancelled run): the design system's dot in its inactive grey.
      return <span className="dm-dot dm-dot--sm bg-inactive-soft" />;
    default:
      // Done: a quiet ink tick.
      return (
        <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
          <path d="M2.5 6.5l2.3 2.3L9.5 3.8" fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" />
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

/** Someone is working on it now: the design system's Working (amber dot, halo and what is
    happening), with the Working tooltip and its place in the legend. */
export function WorkingMark({ label = MARKS.working.name, children }: { label?: string; children: ReactNode }) {
  useLegendMark('mark:working');
  return (
    <Tip text={`${label} · ${MARKS.working.phrase}`}>
      <span data-mark="working" className="inline-flex shrink-0 tabular-nums">
        <Working>{children}</Working>
      </span>
    </Tip>
  );
}

/** The word's color follows its mark: blue for Proposed, grey when not active, rust for a problem,
    amber while working (brand book, Color). */
const WORD_TONE: Partial<Record<MarkKind, string>> = {
  proposed: 'text-needs-strong',
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
    <span
      className={cn('dm-text-caption inline-flex items-center gap-1.5 font-medium', WORD_TONE[kind] ?? 'text-ink', className)}
    >
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

/** Tag of an observation of DEMIURGO: claim or hypothesis (Proposed), unknown (?). */
export function ObservationChip({ kind }: { kind: string }) {
  const w = OBSERVATION_WORDS[kind] ?? { word: kind, mark: 'unknown' as const };
  return (
    <span className="dm-text-caption inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-2 font-medium text-ink-2">
      <Mark kind={w.mark} label={w.word} />
      {w.word.toLowerCase()}
    </span>
  );
}
