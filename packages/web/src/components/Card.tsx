// Surfaces and read-only structures (DESIGN.md §6.6): a card, a key-value list (dl), and a
// vertical timeline whose connector is decorative — each event says what happened in words (R37).

import type { ReactNode, Ref } from 'react';
import { cn } from '../lib/cn.ts';

export function Card({
  children,
  className,
  as: As = 'div',
  tone,
  padding = 'md',
  ref,
  tabIndex,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
  /** A tinted card for a state (a failure, a draft ready). */
  tone?: 'accent' | 'danger' | 'warning' | 'info' | 'success';
  padding?: 'none' | 'sm' | 'md';
  ref?: Ref<HTMLElement>;
  /** -1 to let the page move the focus here (e.g. after an action). */
  tabIndex?: number;
} & Record<`data-${string}`, unknown> & { 'aria-label'?: string; 'aria-labelledby'?: string }) {
  return (
    <As
      ref={ref as never}
      tabIndex={tabIndex}
      className={cn(
        'rounded-lg border',
        !tone && 'border-edge bg-panel',
        tone === 'accent' && 'border-accent-edge bg-accent-soft',
        tone === 'danger' && 'border-danger-edge bg-danger-soft',
        tone === 'warning' && 'border-warning-edge bg-warning-soft',
        tone === 'info' && 'border-info-edge bg-info-soft',
        tone === 'success' && 'border-success-edge bg-success-soft',
        padding === 'sm' && 'p-3',
        padding === 'md' && 'p-4',
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}

export type KeyValueItem = { key: string; label: ReactNode; value: ReactNode; hint?: ReactNode };

/** Facts as a definition list: label on the left, value on the right; hints in visible text. */
export function KeyValue({ items, className }: { items: KeyValueItem[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(96px,auto)_1fr] gap-x-4 gap-y-2 text-sm', className)}>
      {items.map((i) => (
        <div key={i.key} className="contents" data-fact={i.key}>
          <dt className="text-fg-2">{i.label}</dt>
          <dd className="min-w-0 text-fg">
            <span className="break-words">{i.value}</span>
            {i.hint ? <span className="block text-xs text-fg-3">{i.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type TimelineItem = { key: string; icon: ReactNode; body: ReactNode; meta?: ReactNode };

/** Events top to bottom; the line between their icons is decoration only. */
export function Timeline({ items, className, label }: { items: TimelineItem[]; className?: string; label?: string }) {
  return (
    <ol aria-label={label} className={cn('relative flex flex-col', className)}>
      {items.map((i, n) => (
        <li key={i.key} className="relative flex gap-3 pb-4 last:pb-0">
          {n < items.length - 1 ? <span aria-hidden className="absolute top-6 bottom-0 left-[11px] w-px bg-edge" /> : null}
          <span className="relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-edge bg-panel text-fg-2">
            {i.icon}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
            <div className="text-sm text-fg">{i.body}</div>
            {i.meta ? <div className="text-xs text-fg-3">{i.meta}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A labelled divider inside a list ("Answered · 3"). */
export function Divider({ children, className }: { children?: ReactNode; className?: string }) {
  if (!children) return <hr className={cn('border-0 border-t border-edge', className)} />;
  return (
    <div className={cn('flex items-center gap-3 text-xs font-medium text-fg-3', className)}>
      <span className="shrink-0">{children}</span>
      <span aria-hidden className="h-px flex-1 bg-edge" />
    </div>
  );
}
