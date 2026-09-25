// Empty states (DESIGN.md §5): what will appear here, why it is empty, and the one action that
// fills it (R38, R44, R57). Never shown together with an error.

import type { ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

export function EmptyState({
  icon,
  title,
  children,
  action,
  size = 'narrow',
  className,
  headingLevel = 2,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** narrow: inside a panel or a table; spacious: a whole page. */
  size?: 'narrow' | 'spacious';
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center',
        size === 'spacious' ? 'gap-3 px-6 py-16' : 'gap-2 rounded-lg border border-dashed border-edge-strong px-5 py-8',
        className,
      )}
    >
      {icon ? <div className={cn('text-fg-3', size === 'spacious' && 'mb-1')}>{icon}</div> : null}
      <H className={cn('font-semibold text-fg', size === 'spacious' ? 'text-xl' : 'text-base')}>{title}</H>
      {children ? (
        <div className={cn('max-w-md text-fg-2', size === 'spacious' ? 'text-md' : 'text-base')}>{children}</div>
      ) : null}
      {action ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
