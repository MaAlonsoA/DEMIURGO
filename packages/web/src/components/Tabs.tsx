// Tabs and segmented filters (DESIGN.md §6.6). Route tabs are links in a labelled nav with
// aria-current (each view has a URL); in-page tabs follow the APG tabs pattern with automatic
// activation on arrow keys (R96). Segmented links filter a list and show their counts in text.

import { Link, type LinkProps } from '@tanstack/react-router';
import { Tabs as T } from 'radix-ui';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

export type LinkTab = {
  label: ReactNode;
  /** Router link props for this tab. */
  link: LinkProps;
  current: boolean;
  count?: number;
  key: string;
};

const tabBase =
  'relative inline-flex h-10 shrink-0 items-center gap-1.5 px-1 text-base font-medium whitespace-nowrap transition-colors duration-[var(--m-fast)]';

/** Tabs that are links (sub-views with their own URL). */
export function LinkTabs({ label, tabs, className }: { label: string; tabs: LinkTab[]; className?: string }) {
  return (
    <nav aria-label={label} className={cn('-mb-px flex gap-5 overflow-x-auto', className)}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          {...t.link}
          aria-current={t.current ? 'page' : undefined}
          data-tab={t.key}
          className={cn(
            tabBase,
            t.current
              ? 'text-fg after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent'
              : 'text-fg-2 hover:text-fg',
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="text-sm text-fg-3 tabular-nums">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** In-page tabs (APG): a tablist, arrow keys move and select, each panel is focusable. */
export function Tabs({
  label,
  value,
  onChange,
  tabs,
  children,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  tabs: { value: string; label: ReactNode; count?: number }[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <T.Root value={value} onValueChange={onChange} className={className}>
      <T.List aria-label={label} className="-mb-px flex gap-5 overflow-x-auto border-b border-edge">
        {tabs.map((t) => (
          <T.Trigger
            key={t.value}
            value={t.value}
            className={cn(
              tabBase,
              'cursor-pointer text-fg-2 hover:text-fg data-[state=active]:text-fg',
              'data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-accent',
            )}
          >
            {t.label}
            {t.count !== undefined ? <span className="text-sm text-fg-3 tabular-nums">{t.count}</span> : null}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  );
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <T.Content value={value} tabIndex={0} className={cn('pt-5 outline-none focus-visible:outline-2', className)}>
      {children}
    </T.Content>
  );
}

export type Segment = { key: string; label: ReactNode; count?: number; link: LinkProps; current: boolean };

/** A filter as a row of links with visible counts ("Failed 4"); the current one is marked. */
export function SegmentedLinks({ label, segments, className }: { label: string; segments: Segment[]; className?: string }) {
  return (
    <nav aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {segments.map((s) => (
        <Link
          key={s.key}
          {...s.link}
          aria-current={s.current ? 'page' : undefined}
          data-segment={s.key}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors duration-[var(--m-fast)]',
            s.current
              ? 'border-fg bg-fg text-panel'
              : 'border-edge-strong bg-panel text-fg-2 hover:border-edge-control hover:text-fg',
          )}
        >
          {s.label}
          {s.count !== undefined ? (
            <span className={cn('tabular-nums', s.current ? 'text-panel' : 'text-fg-3')}>{s.count}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

/** A segmented control inside the page (not a URL): radio semantics. */
export function Segmented<V extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: ReactNode; count?: number }[];
  className?: string;
}) {
  // APG radio group: one tab stop (the checked option); arrows move the choice and the focus.
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    const group = e.currentTarget.parentElement;
    requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus());
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex flex-wrap gap-1.5', className)}>
      {options.map((o, index) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-value={o.value}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, index)}
            className={cn(
              'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors duration-[var(--m-fast)]',
              on ? 'border-fg bg-fg text-panel' : 'border-edge-strong bg-panel text-fg-2 hover:border-edge-control hover:text-fg',
            )}
          >
            {o.label}
            {o.count !== undefined ? (
              <span className={cn('tabular-nums', on ? 'text-panel' : 'text-fg-3')}>{o.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
