// One card template, three sizes (canvas S3B): the same six zones in the same places.
// 1 what it is · 2 how sure, how far · 3 needs you · 4 title and one line · 5 who and when · 6 signals.
// The border follows the shape: solid (decided or proposed), dashed (open or unknown), faded (not
// active), blue (selected).

import type { ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { type IconKind, TypeIcon } from './icons.tsx';
import { NeedsBubble } from './signals.tsx';

export type CardShape = 'solid' | 'dashed' | 'faded' | 'selected';

export type CardProps = {
  icon: IconKind;
  type: string;
  status?: ReactNode;
  bars?: ReactNode;
  needs?: number;
  needsDetail?: string;
  title: string;
  line?: ReactNode;
  who?: ReactNode;
  signals?: ReactNode;
  code?: string;
  shape?: CardShape;
  /** The "What changed" lens dims what did not change. */
  dimmed?: boolean;
  changed?: boolean;
  className?: string;
  children?: ReactNode;
};

const SHAPES: Record<CardShape, string> = {
  solid: 'border border-line bg-surface',
  dashed: 'border border-dashed border-inactive bg-surface',
  faded: 'border border-dashed border-inactive-light bg-surface/50 text-ink-3',
  selected: 'border-2 border-needs bg-surface shadow-[0_0_0_4px_var(--color-needs-ring)]',
};

function Kind({ icon, type, status, bars }: Pick<CardProps, 'icon' | 'type' | 'status' | 'bars'>) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
      <TypeIcon kind={icon} size={14} />
      {type}
      {status && (
        <>
          <span className="text-inactive-light" aria-hidden="true">
            ·
          </span>
          <span className="tracking-normal normal-case">{status}</span>
        </>
      )}
      {bars && <span className="ml-auto flex items-center">{bars}</span>}
    </span>
  );
}

/** Card size: the map and the overview. */
export function Card(p: CardProps) {
  return (
    <div
      data-card
      data-changed={p.changed ? 'true' : undefined}
      className={cn(
        'relative flex min-h-[140px] flex-col gap-1.5 rounded-[var(--radius-card)] p-3.5 text-left transition-opacity',
        SHAPES[p.shape ?? 'solid'],
        p.dimmed && 'opacity-40',
        p.className,
      )}
    >
      {p.needs ? (
        <span className="absolute -top-2.5 -right-2.5 rounded-full shadow-[0_0_0_3px_var(--color-paper)]">
          <NeedsBubble count={p.needs} {...(p.needsDetail ? { detail: p.needsDetail } : {})} />
        </span>
      ) : null}
      <Kind icon={p.icon} type={p.type} status={p.status} bars={p.bars} />
      <strong className="text-[15px] leading-snug font-semibold">{p.title}</strong>
      {p.line && <span className="line-clamp-2 text-[13px] text-ink-3">{p.line}</span>}
      {p.children}
      {(p.who || p.signals) && (
        <span className="mt-auto flex items-center justify-between gap-2 border-t border-line-soft pt-2 text-xs text-muted">
          <span className="flex min-w-0 items-center gap-1.5">{p.who}</span>
          <span className="flex items-center gap-3 font-semibold text-ink-2">{p.signals}</span>
        </span>
      )}
    </div>
  );
}

/** Node size: trees, lists and small things. */
export function Node(p: CardProps & { trailing?: ReactNode }) {
  return (
    <div
      data-card
      data-changed={p.changed ? 'true' : undefined}
      className={cn(
        'relative flex min-h-11 items-center gap-2.5 rounded-[10px] px-3 py-2 transition-opacity',
        SHAPES[p.shape ?? 'solid'],
        p.dimmed && 'opacity-40',
        p.className,
      )}
    >
      <span className="flex text-muted">
        <TypeIcon kind={p.icon} size={14} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold">{p.title}</span>
        {p.line && <span className="truncate text-xs text-ink-3">{p.line}</span>}
      </span>
      {p.code && <span className="font-mono text-[11px] text-muted">{p.code}</span>}
      {p.bars}
      {p.status}
      {p.trailing}
      {p.needs ? <NeedsBubble count={p.needs} size="sm" {...(p.needsDetail ? { detail: p.needsDetail } : {})} /> : null}
    </div>
  );
}

/** Detail size: when an element is selected (the peek and the pinned panel). */
export function Detail(p: CardProps & { actions?: ReactNode }) {
  return (
    <div
      data-card-detail
      className={cn('flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-[18px] py-4', p.className)}
    >
      <span className="flex items-center justify-between gap-3">
        <Kind icon={p.icon} type={p.type} status={p.status} />
        <span className="flex items-center gap-2.5">
          {p.bars}
          {p.code && <span className="font-mono text-[11px] text-muted">{p.code}</span>}
        </span>
      </span>
      <div className="flex flex-col gap-0.5">
        <strong className="text-lg leading-snug font-semibold">{p.title}</strong>
        {p.line && <span className="text-[13px] text-ink-3">{p.line}</span>}
      </div>
      {p.children}
      {(p.who || p.actions) && (
        <div className="flex items-center justify-between gap-2 border-t border-line-soft pt-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">{p.who}</span>
          <span className="flex items-center gap-2">{p.actions}</span>
        </div>
      )}
    </div>
  );
}

/** Code of a record, small and in mono: names go before codes (brief §6). */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[11px] text-muted', className)}>{children}</span>;
}
