// Page layout pieces: the content column, the right column (the design system's aside-width),
// titles in its type styles, breadcrumbs and skeletons. Loading shows skeletons with the shape of
// the card, never a full-screen spinner (spec §7.1).

import { Link } from '@tanstack/react-router';
import { type KeyboardEvent, type PointerEvent, type ReactNode, useState } from 'react';
import { cn } from '../lib/cn.ts';
import { ChevronLeft } from './icons.tsx';

export function Page({
  children,
  aside,
  asideFooter,
  asidePanel = false,
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  /** Kept at the bottom of the right column while the page scrolls ("Ask DEMIURGO about this"). */
  asideFooter?: ReactNode;
  /** The right column as a panel: the height of the window, its own scroll, and resizable. */
  asidePanel?: boolean;
  className?: string;
}) {
  return (
    <div className="flex min-h-[calc(100vh-56px)]">
      <main id="main" className={cn('min-w-0 flex-1 px-10 pt-7 pb-24', className)}>
        {children}
      </main>
      {aside && asidePanel && <AsidePanel>{aside}</AsidePanel>}
      {aside && !asidePanel && (
        <aside
          className={cn(
            'w-[var(--aside-width)] shrink-0 border-l border-line bg-surface px-5 pt-7',
            asideFooter ? 'flex flex-col' : 'pb-24',
          )}
          aria-label="Side panel"
        >
          <div className="sticky top-[76px] flex flex-col gap-6">{aside}</div>
          {asideFooter && <div className="sticky bottom-0 z-10 mt-auto bg-surface pt-6 pb-5">{asideFooter}</div>}
        </aside>
      )}
    </div>
  );
}

const WIDTH_KEY = 'dm-aside-panel-width';
const MIN_WIDTH = 320;
const maxWidth = () => Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.6));
const clampWidth = (w: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));

function storedWidth(): number {
  try {
    const n = Number(window.localStorage.getItem(WIDTH_KEY));
    return n > 0 ? clampWidth(n) : 480;
  } catch {
    return 480;
  }
}

/** The right column that scrolls on its own and is dragged wider or narrower from its left edge. */
function AsidePanel({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(storedWidth);
  const keep = (w: number) => {
    const next = clampWidth(w);
    setWidth(next);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // Remembering the width is a convenience.
    }
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => keep(startWidth + (startX - ev.clientX));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') keep(width + 32);
    else if (e.key === 'ArrowRight') keep(width - 32);
    else return;
    e.preventDefault();
  };
  return (
    <aside
      style={{ width }}
      className="sticky top-14 flex h-[calc(100vh-56px)] shrink-0 flex-col self-start border-l border-line bg-surface"
      aria-label="Side panel"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a vertical splitter has no native element */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the side panel"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => keep(480)}
        className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none outline-none hover:bg-needs-line focus-visible:bg-needs-line"
      />
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-7 pb-5">{children}</div>
    </aside>
  );
}

export function PageTitle({
  eyebrow,
  title,
  subtitle,
  actions,
  display = false,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** The title of an overview page (display); otherwise the thing in focus (page-title). */
  display?: boolean;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex items-start justify-between gap-6', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <div className="dm-text-caption font-semibold text-muted">{eyebrow}</div>}
        <h1 className={display ? 'dm-text-display' : 'dm-text-page-title'}>{title}</h1>
        {subtitle && <div className="dm-text-body text-ink-2">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2.5 flex items-baseline justify-between gap-3', className)}>
      <h2 className="dm-text-small font-semibold text-ink-2">{children}</h2>
      {aside && <div className="dm-text-caption text-muted">{aside}</div>}
    </div>
  );
}

export function Panel({ children, className, title }: { children: ReactNode; className?: string; title?: ReactNode }) {
  return (
    <section className={cn('rounded-card border border-line bg-surface p-5', className)}>
      {title && <h2 className="dm-text-heading mb-3 font-normal">{title}</h2>}
      {children}
    </section>
  );
}

export type Crumb = { label: string; to?: string; params?: Record<string, string> };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="dm-text-small mb-3 flex items-center gap-2 text-muted">
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
          {i < items.length - 1 && <span className="dm-sep">/</span>}
        </span>
      ))}
    </nav>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block animate-pulse-soft rounded-tab bg-line-soft', className)} />;
}

/** Skeleton with the shape of a card. */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('flex h-[var(--card-height)] flex-col gap-2 rounded-card-md border border-line bg-surface p-3.5', className)}
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
        'dm-text-body rounded-card-md border border-dashed border-line-strong px-5 py-8 text-center text-muted',
        className,
      )}
    >
      {children}
    </div>
  );
}
