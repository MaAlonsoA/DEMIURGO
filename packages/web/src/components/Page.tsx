// The page frame (DESIGN.md §2, §6.3). Every page has one header: breadcrumbs, an eyebrow (what it
// is and its state), the h1 (the focus target after navigation), a meta line, actions and, when the
// page has sub-views, its tabs. Bodies come in two widths: reading (768 px) and wide (1280 px).
// Side panels are labelled complementary landmarks (R94).

import { Link, type LinkProps } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';
import { cn } from '../lib/cn.ts';
import { ChevronRightIcon } from './icons.tsx';

export type Crumb = { label: ReactNode; link?: LinkProps };

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-sm text-fg-2">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumbs are positional
            <li key={i} className={cn('flex min-w-0 items-center gap-1', last ? 'text-fg' : 'shrink-0')}>
              {c.link && !last ? (
                <Link {...c.link} className="max-w-60 truncate hover:text-fg hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="truncate">
                  {c.label}
                </span>
              )}
              {!last ? <ChevronRightIcon size={12} className="shrink-0 text-fg-3" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The page title in the browser tab: "Needs you · DEVMIURGO · DEMIURGO" (the shell adds the count). */
export function usePageTitle(parts: (string | null | undefined)[]) {
  const title = parts.filter(Boolean).join(' · ');
  useEffect(() => {
    document.documentElement.dataset.pageTitle = title;
    window.dispatchEvent(new Event('dm:title'));
  }, [title]);
}

export function PageHeader({
  crumbs,
  eyebrow,
  title,
  meta,
  actions,
  tabs,
  children,
  className,
  titleSize = 'xl',
}: {
  crumbs?: Crumb[];
  /** What it is and its state, above the title (icons, a type word, a badge). */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Provenance, dates, counts: one line under the title. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Sub-view tabs (LinkTabs) at the bottom edge of the header. */
  tabs?: ReactNode;
  /** Anything else under the meta line (a progress bar, a notice). */
  children?: ReactNode;
  className?: string;
  titleSize?: 'lg' | 'xl' | '2xl';
}) {
  return (
    <header className={cn('border-b border-edge bg-panel', tabs ? 'pb-0' : 'pb-5', className)}>
      <div className="flex flex-col gap-3 px-4 pt-5 sm:px-6 lg:px-8">
        {crumbs ? <Breadcrumbs items={crumbs} /> : null}
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
            {eyebrow ? <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">{eyebrow}</div> : null}
            <h1
              id="page-title"
              tabIndex={-1}
              className={cn(
                'font-semibold text-fg outline-none',
                titleSize === 'lg' && 'text-lg',
                titleSize === 'xl' && 'text-xl',
                titleSize === '2xl' && 'text-2xl',
              )}
            >
              {title}
            </h1>
            {meta ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-2">{meta}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {children}
        {tabs ? <div className="mt-1">{tabs}</div> : null}
      </div>
    </header>
  );
}

/** The scrolling body of a page. `width`: reading column, wide page, or full width. */
export function PageBody({
  children,
  width = 'wide',
  className,
}: {
  children: ReactNode;
  width?: 'reading' | 'wide' | 'full';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 py-6 sm:px-6 lg:px-8',
        width === 'reading' && 'max-w-3xl',
        width === 'wide' && 'max-w-7xl',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Main content with a side column (stacked under 1280 px): the side column is a labelled
 * complementary region.
 */
export function WithAside({
  children,
  aside,
  asideLabel,
  asideWidth = 'md',
  className,
}: {
  children: ReactNode;
  aside: ReactNode;
  asideLabel: string;
  asideWidth?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-8 xl:flex-row xl:items-start', className)}>
      <div className="min-w-0 flex-1">{children}</div>
      <aside
        aria-label={asideLabel}
        className={cn(
          'flex w-full shrink-0 flex-col gap-6 xl:sticky xl:top-4',
          asideWidth === 'sm' && 'xl:w-72',
          asideWidth === 'md' && 'xl:w-80',
          asideWidth === 'lg' && 'xl:w-96',
        )}
      >
        {aside}
      </aside>
    </div>
  );
}

/** A titled region of a page (h2), with an optional note and actions on the right. */
export function Section({
  title,
  note,
  actions,
  children,
  className,
  id,
  level = 2,
}: {
  title: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  level?: 2 | 3;
}) {
  const H = level === 3 ? 'h3' : 'h2';
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <H id={id ? `${id}-title` : undefined} className={cn('font-semibold text-fg', level === 2 ? 'text-lg' : 'text-base')}>
            {title}
          </H>
          {note ? <p className="text-sm text-fg-2">{note}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
