// Page layout pieces: the content column, the right column, titles, breadcrumbs and skeletons.
// Loading shows skeletons with the shape of the card, never a full-screen spinner (spec §7.1).

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { ChevronLeft } from './icons.tsx';

export function Page({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className="flex min-h-[calc(100vh-56px)]">
      <main id="main" className={cn('min-w-0 flex-1 px-10 pt-7 pb-24', className)}>
        {children}
      </main>
      {aside && (
        <aside className="w-[360px] shrink-0 border-l border-line bg-surface px-5 pt-7 pb-24" aria-label="Side panel">
          <div className="sticky top-[76px] flex flex-col gap-6">{aside}</div>
        </aside>
      )}
    </div>
  );
}

export function PageTitle({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex items-start justify-between gap-6', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <div className="text-xs font-semibold text-muted">{eyebrow}</div>}
        <h1 className="text-[28px] leading-tight font-semibold">{title}</h1>
        {subtitle && <div className="text-[15px] text-ink-2">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2.5 flex items-baseline justify-between gap-3', className)}>
      <h2 className="text-[13px] font-semibold text-ink-2">{children}</h2>
      {aside && <div className="text-xs text-muted">{aside}</div>}
    </div>
  );
}

export function Panel({ children, className, title }: { children: ReactNode; className?: string; title?: ReactNode }) {
  return (
    <section className={cn('rounded-[var(--radius-panel)] border border-line bg-surface p-5', className)}>
      {title && <h2 className="mb-3 text-[15px] font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export type Crumb = { label: string; to?: string; params?: Record<string, string> };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-2 text-[13px] text-muted">
      <ChevronLeft size={12} />
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex items-center gap-2">
          {c.to ? (
            // biome-ignore lint: dynamic route strings
            <Link to={c.to as never} params={c.params as never} className="hover:text-ink">
              {c.label}
            </Link>
          ) : (
            <span className="font-semibold text-ink" aria-current="page">
              {c.label}
            </span>
          )}
          {i < items.length - 1 && <span className="text-inactive-light">/</span>}
        </span>
      ))}
    </nav>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block animate-pulse-soft rounded-md bg-line-soft', className)} />;
}

/** Skeleton with the shape of a card. */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('flex h-[140px] flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3.5', className)}
    >
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="mt-auto h-3 w-1/3" />
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-2/5" />
      <Skeleton className="h-4 w-3/5" />
      <div className="mt-4 grid grid-cols-3 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}

export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-dashed border-line-strong px-5 py-8 text-center text-sm text-muted',
        className,
      )}
    >
      {children}
    </div>
  );
}
