// The sidebar (DESIGN.md §2.1): the project, search, the sections in the order that asks for
// action first, and at the bottom the live status, Help and the person. Each section says in words
// — for screen readers and in its tooltip — what is going on there: how much needs you, how many
// agents work, stall or failed, whether the knowledge is behind. Quiet chrome, loud state (R31).

import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { inboxQuery, knowledgeQuery, runsQuery, sessionQuery } from '../api/queries.ts';
import { lastProgressAt } from '../api/progress.ts';
import { Count } from '../components/Badge.tsx';
import { AlertCircleIcon, DatabaseIcon, HelpIcon, PanelLeftIcon, SearchIcon } from '../components/icons.tsx';
import { isActive, runView, unresolvedFailures } from '../components/runState.tsx';
import { WorkingDot } from '../components/status.tsx';
import { useNow } from '../components/Time.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { type Translation, useMessages } from '../i18n/define.ts';
import { cn } from '../lib/cn.ts';
import { freshnessOf } from '../screens/knowledge/graph.ts';
import { hasDevTools, openDevPanel } from '../screens/dev/snapshots.ts';
import { useSafeLocale } from '../words.ts';
import { openCommandMenu } from './CommandMenu.tsx';
import { LiveStatus } from './Connection.tsx';
import { openHelp } from './Help.tsx';
import { NAV, type NavItem, navLabelFor, sectionOf } from './nav.ts';
import { PersonMenu } from './PersonMenu.tsx';
import { ProjectSwitcher } from './ProjectSwitcher.tsx';
import { SIDEBAR } from './words.i18n.ts';

type Signal = { indicator: ReactNode; words: string };
type SidebarWords = Translation<typeof SIDEBAR.en>;

function useNeedsSignal(projectId: string, t: SidebarWords): Signal {
  const total = useQuery(inboxQuery(projectId)).data?.total ?? 0;
  return {
    indicator: <Count n={total} label={t.needsYouIndicator(total)} />,
    words: total > 0 ? t.thingsWait(total) : t.nothingWaits,
  };
}

function useActivitySignal(projectId: string, t: SidebarWords): Signal {
  const runs = useQuery(runsQuery(projectId)).data ?? [];
  const active = runs.filter((r) => isActive(r.state));
  const now = useNow(active.length > 0);
  const views = active.map((r) => runView(r, { now, lastProgress: lastProgressAt(r.id) }));
  const working = views.length;
  const stuck = views.filter((v) => v.kind === 'stalled' || v.kind === 'late').length;
  const failed = unresolvedFailures(runs, now).length;
  const words = [
    working > 0 ? t.working(working) : null,
    stuck > 0 ? t.stalledOrLate(stuck) : null,
    failed > 0 ? t.failed(failed) : null,
  ].filter(Boolean);
  return {
    words: words.length > 0 ? words.join(' · ') : t.nothingRunning,
    indicator: (
      <span className="flex items-center gap-1.5" data-activity={`${working}:${stuck}:${failed}`}>
        {working > 0 ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs font-medium tabular-nums',
              stuck > 0 ? 'text-warning-text' : 'text-info-text',
            )}
          >
            <WorkingDot size={7} className={stuck > 0 ? 'bg-warning' : undefined} />
            {working}
          </span>
        ) : null}
        {failed > 0 ? <Count n={failed} tone="danger" label={t.failed(failed)} /> : null}
      </span>
    ),
  };
}

function useKnowledgeSignal(projectId: string, t: SidebarWords): Signal | null {
  const k = useQuery(knowledgeQuery(projectId)).data;
  if (!k) return null;
  const f = freshnessOf(k);
  const failed = k.updates.filter((u) => u.state === 'rejected').length;
  if (f === 'behind') return { indicator: <AlertCircleIcon size={15} className="text-danger-text" />, words: t.behind(failed) };
  if (f === 'updating') return { indicator: <WorkingDot size={7} />, words: t.updating(k.updates_in_progress) };
  return { indicator: null, words: t.upToDate(k.graph_version) };
}

function NavLink({
  item,
  projectId,
  current,
  signal,
  compact,
  onNavigate,
}: {
  item: NavItem;
  projectId: string;
  current: boolean;
  signal?: Signal | null;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const label = navLabelFor(useSafeLocale(), item.key);
  const link = (
    <Link
      to={item.to as '/p/$projectId'}
      params={{ projectId }}
      aria-current={current ? 'page' : undefined}
      data-nav={item.key}
      onClick={onNavigate}
      className={cn(
        'group flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2 text-base transition-colors duration-[var(--m-fast)]',
        current ? 'bg-selected font-medium text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
        compact && 'justify-center px-0',
      )}
    >
      <item.icon size={17} className={cn('shrink-0', current ? 'text-accent-text' : 'text-fg-3 group-hover:text-fg-2')} />
      {!compact ? <span className="min-w-0 flex-1 truncate">{label}</span> : <span className="sr-only">{label}</span>}
      {signal?.indicator ? <span className={cn('shrink-0', compact && 'absolute right-1 top-1')}>{signal.indicator}</span> : null}
      {signal?.words ? <span className="sr-only">: {signal.words}</span> : null}
    </Link>
  );
  return compact || signal?.words ? (
    <Tooltip content={signal?.words ? `${label} · ${signal.words}` : label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

export function Sidebar({
  projectId,
  compact,
  onToggle,
  onNavigate,
}: {
  projectId: string;
  compact?: boolean;
  /** Collapse or expand (desktop only). */
  onToggle?: () => void;
  /** Called after following a link (closes the drawer on small screens). */
  onNavigate?: () => void;
}) {
  const t = useMessages(SIDEBAR);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = sectionOf(pathname);
  const needs = useNeedsSignal(projectId, t);
  const activity = useActivitySignal(projectId, t);
  const knowledge = useKnowledgeSignal(projectId, t);
  const devTools = hasDevTools(useQuery(sessionQuery).data);
  const signals: Partial<Record<NavItem['key'], Signal | null>> = { needs, activity, knowledge };

  const group = (g: NavItem['group'], title: string | null) => (
    <div className="flex flex-col gap-0.5">
      {title && !compact ? <p className="px-2 pt-3 pb-1 text-xs font-medium text-fg-3">{title}</p> : null}
      {title && compact ? <hr className="mx-2 my-2 border-0 border-t border-edge" /> : null}
      {NAV.filter((n) => n.group === g).map((n) => (
        <NavLink
          key={n.key}
          item={n}
          projectId={projectId}
          current={section === n.key}
          signal={signals[n.key] ?? null}
          {...(compact ? { compact } : {})}
          {...(onNavigate ? { onNavigate } : {})}
        />
      ))}
    </div>
  );

  return (
    <nav aria-label={t.sections} className="flex h-full min-h-0 flex-col gap-1 px-2 py-3">
      <div className={cn('flex items-center gap-1 px-1 pb-1', compact && 'flex-col px-0')}>
        <Link
          to="/"
          aria-label={t.home}
          className={cn(
            'inline-flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-sm font-semibold text-fg',
            compact && 'flex-none',
          )}
        >
          <span
            aria-hidden
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-xs bg-accent text-xs text-on-accent"
          >
            D
          </span>
          {!compact ? <span className="truncate">DEMIURGO</span> : null}
        </Link>
        {onToggle ? (
          <Tooltip content={compact ? t.expand : t.collapse} side="right">
            <button
              type="button"
              aria-label={compact ? t.expand : t.collapse}
              aria-expanded={!compact}
              onClick={onToggle}
              className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
            >
              <PanelLeftIcon size={16} />
            </button>
          </Tooltip>
        ) : null}
      </div>
      <ProjectSwitcher projectId={projectId} {...(compact ? { compact } : {})} />
      <button
        type="button"
        onClick={openCommandMenu}
        aria-label={t.search}
        aria-keyshortcuts="Control+K Meta+K"
        className={cn(
          'mb-1 flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md border border-edge bg-panel px-2 text-base text-fg-3 hover:border-edge-strong hover:text-fg-2',
          compact && 'justify-center px-0',
        )}
      >
        <SearchIcon size={16} className="shrink-0" />
        {!compact ? (
          <>
            <span className="flex-1 text-left">{t.search}</span>
            <kbd className="rounded-xs border border-edge px-1 font-ui text-xs">{t.ctrlK}</kbd>
          </>
        ) : null}
      </button>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {group('work', null)}
        {group('knowledge', t.knowledgeGroup)}
        {group('settings', t.settingsGroup)}
      </div>
      <div className={cn('flex flex-col gap-1 border-t border-edge pt-2', compact && 'items-center')}>
        <div className={cn('flex items-center gap-1', compact ? 'flex-col' : 'justify-between px-2')}>
          <LiveStatus {...(compact ? { compact } : {})} />
          <div className={cn('flex items-center gap-0.5', compact && 'flex-col')}>
            {devTools ? (
              <Tooltip content={t.devTools} side="right">
                <button
                  type="button"
                  aria-label={t.devTools}
                  onClick={openDevPanel}
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
                >
                  <DatabaseIcon size={16} />
                </button>
              </Tooltip>
            ) : null}
            <Tooltip content={t.help} side="right">
              <button
                type="button"
                aria-label={t.helpLabel}
                aria-keyshortcuts="?"
                onClick={openHelp}
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
              >
                <HelpIcon size={17} />
              </button>
            </Tooltip>
          </div>
        </div>
        <PersonMenu {...(compact ? { compact } : {})} />
      </div>
    </nav>
  );
}
