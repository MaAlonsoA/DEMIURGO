// Tags and counts (DESIGN.md §6.5). A Tag classifies (type, agent, area) and stays quiet; a status
// that must be noticed is a StatusBadge (status.tsx), never a Tag (R39, R74). Count is the accent
// pill of "needs you": a number with its meaning for screen readers.

import type { ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

export function Tag({ children, className, icon }: { children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1 rounded-xs border border-edge bg-sunken px-1.5 text-xs leading-5 font-medium text-fg-2',
        className,
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A record code or an id in mono ("FDR-INT-002 · v3"). */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-code text-xs text-fg-2 tabular-nums', className)}>{children}</span>;
}

/**
 * The accent count of what waits for the person. `label` is what screen readers hear
 * ("7 things need you"); hidden when zero unless `showZero`.
 */
export function Count({
  n,
  label,
  tone = 'accent',
  className,
  showZero,
}: {
  n: number;
  label: string;
  tone?: 'accent' | 'neutral' | 'danger';
  className?: string;
  showZero?: boolean;
}) {
  if (n <= 0 && !showZero) return null;
  return (
    <span
      data-count={n}
      className={cn(
        'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums',
        tone === 'accent' && 'bg-accent text-on-accent',
        tone === 'neutral' && 'bg-hover text-fg-2',
        tone === 'danger' && 'bg-danger text-on-danger',
        className,
      )}
    >
      <span aria-hidden>{n}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
