// How a state looks (DESIGN.md §4 and §5). Every state has one tone, one icon and one word; the word
// comes from the product dictionary (words.ts), the tone and the icon from here. The icon's shape
// carries the meaning and the tone only reinforces it, so no state depends on color alone
// (WCAG 1.4.1; R73, R36, R39).

import type { ComponentType } from 'react';
import { EPISTEMIC_MARK, MARKS, type MarkKind, stateWord } from '../words.ts';
import { cn } from '../lib/cn.ts';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  ClockIcon,
  HourglassIcon,
  type IconProps,
  MinusCircleIcon,
  PauseCircleIcon,
  ReplacedIcon,
  SparklesIcon,
  XCircleIcon,
} from './icons.tsx';

/** The six tones of the language: what a state asks of the person, not how it looks. */
export type Tone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

/** Classes of each tone: a soft tint for badges and rows, the text color, the edge and the solid fill. */
export const TONE: Record<Tone, { soft: string; text: string; edge: string; solid: string; icon: string }> = {
  neutral: { soft: 'bg-sunken', text: 'text-fg-2', edge: 'border-edge', solid: 'bg-fg-3', icon: 'text-fg-3' },
  accent: {
    soft: 'bg-accent-soft',
    text: 'text-accent-text',
    edge: 'border-accent-edge',
    solid: 'bg-accent',
    icon: 'text-accent-text',
  },
  info: { soft: 'bg-info-soft', text: 'text-info-text', edge: 'border-info-edge', solid: 'bg-info', icon: 'text-info-text' },
  success: {
    soft: 'bg-success-soft',
    text: 'text-success-text',
    edge: 'border-success-edge',
    solid: 'bg-success',
    icon: 'text-success-text',
  },
  warning: {
    soft: 'bg-warning-soft',
    text: 'text-warning-text',
    edge: 'border-warning-edge',
    solid: 'bg-warning',
    icon: 'text-warning-text',
  },
  danger: {
    soft: 'bg-danger-soft',
    text: 'text-danger-text',
    edge: 'border-danger-edge',
    solid: 'bg-danger',
    icon: 'text-danger-text',
  },
};

type Look = { tone: Tone; icon: ComponentType<IconProps> | 'working' };

/** Tone and icon of each kind of state (the kinds are the product's, words.ts MarkKind). */
export const LOOK: Record<MarkKind, Look> = {
  confirmed: { tone: 'success', icon: CheckCircleIcon },
  done: { tone: 'success', icon: CheckCircleIcon },
  assumed: { tone: 'warning', icon: SparklesIcon },
  proposed: { tone: 'accent', icon: CircleDotIcon },
  open: { tone: 'neutral', icon: CircleIcon },
  unknown: { tone: 'neutral', icon: CircleDashedIcon },
  parked: { tone: 'neutral', icon: PauseCircleIcon },
  dropped: { tone: 'neutral', icon: MinusCircleIcon },
  inactive: { tone: 'neutral', icon: MinusCircleIcon },
  replaced: { tone: 'neutral', icon: ReplacedIcon },
  stale: { tone: 'warning', icon: HourglassIcon },
  conflict: { tone: 'danger', icon: AlertTriangleIcon },
  problem: { tone: 'danger', icon: XCircleIcon },
  working: { tone: 'info', icon: 'working' },
};

/** The breathing dot of work in progress: it never spins, so a long run doesn't look frantic. */
export function WorkingDot({ size = 8, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 animate-breathe rounded-full bg-info', className)}
      style={{ width: size, height: size }}
    />
  );
}

/** The icon of a kind of state, in its tone. Decorative: the word next to it names the state. */
export function StateIcon({ kind, size = 14, className }: { kind: MarkKind; size?: number; className?: string }) {
  const look = LOOK[kind];
  if (look.icon === 'working')
    return (
      <span className={cn('inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}>
        <WorkingDot size={Math.max(6, Math.round(size * 0.55))} />
      </span>
    );
  const Icon = look.icon;
  return <Icon size={size} className={cn('shrink-0', TONE[look.tone].icon, className)} />;
}

type BadgeSize = 'sm' | 'md';

/**
 * A status pill (R39 lozenge, R36 state label): icon + word in the state's tone. Its phrase from the
 * dictionary is the tooltip for pointer users; the word alone carries the state.
 */
export function StatusBadge({
  kind,
  word,
  size = 'sm',
  className,
  title,
}: {
  kind: MarkKind;
  word?: string;
  size?: BadgeSize;
  className?: string;
  title?: string;
}) {
  const look = LOOK[kind];
  const t = TONE[look.tone];
  const label = word ?? MARKS[kind].name;
  return (
    <span
      data-status={kind}
      title={title ?? `${MARKS[kind].name} · ${MARKS[kind].phrase}`}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-5 px-1.5 text-xs' : 'h-6 px-2 text-sm',
        t.soft,
        t.text,
        t.edge,
        className,
      )}
    >
      <StateIcon kind={kind} size={size === 'sm' ? 12 : 14} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** The state of an entity from the tables (record_version, question, proposal, ai_run…), as a badge. */
export function EntityState({
  entity,
  state,
  size,
  className,
}: {
  entity: string;
  state: string;
  size?: BadgeSize;
  className?: string;
}) {
  const w = stateWord(entity, state);
  return <StatusBadge kind={w.mark} word={w.word} {...(size ? { size } : {})} {...(className ? { className } : {})} />;
}

/** How sure the product is of something (the API's epistemic status), as a badge. */
export function Certainty({ status, size, className }: { status: string; size?: BadgeSize; className?: string }) {
  const kind = EPISTEMIC_MARK[status] ?? 'unknown';
  return <StatusBadge kind={kind} {...(size ? { size } : {})} {...(className ? { className } : {})} />;
}

/** Icon + word inline, without the pill: for dense rows where a pill would be noise (R73: ≥3 cues). */
export function StateText({ kind, word, className }: { kind: MarkKind; word?: string; className?: string }) {
  const look = LOOK[kind];
  return (
    <span data-status={kind} className={cn('inline-flex items-center gap-1.5 text-sm', TONE[look.tone].text, className)}>
      <StateIcon kind={kind} size={14} />
      <span>{word ?? MARKS[kind].name}</span>
    </span>
  );
}

/** Other statuses with a clock: queued work that hasn't started. */
export const QueuedIcon = ClockIcon;
