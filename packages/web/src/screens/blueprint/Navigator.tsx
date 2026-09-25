// The records navigator beside a record page (DESIGN.md §3.6, INV-BP-01…10): every record of the
// product grouped by type — bugs and the four stage types included — with the status of each
// feature and the certainty of the rest, the rules for the whole product as a Later note, and the
// parked ideas. The record on screen is marked (aria-current). It collapses to a thin strip, and on
// small screens it starts closed above the page. Tab reaches every link; ↑ and ↓ move inside it.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';
import { inboxQuery, stateQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import { Count } from '../../components/Badge.tsx';
import { IconButton } from '../../components/Button.tsx';
import { ChevronDownIcon, ChevronLeftIcon, PanelLeftIcon, PlusIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { StateIcon, StateText } from '../../components/status.tsx';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import { MARKS } from '../../words.ts';
import { type FeatureStatus, type NavRecord, navigatorOf } from './rail.ts';

const KEY = 'dm-records-nav';

/** Open by default where there is room for it (1440 px); the person's choice wins on wide screens. */
function initialOpen(): boolean {
  if (typeof window === 'undefined' || typeof matchMedia === 'undefined') return true;
  if (!matchMedia('(min-width: 1024px)').matches) return false;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'open') return true;
    if (stored === 'closed') return false;
  } catch {
    // No storage: the default below.
  }
  return matchMedia('(min-width: 1440px)').matches;
}

function remember(open: boolean) {
  if (typeof matchMedia !== 'undefined' && !matchMedia('(min-width: 1024px)').matches) return;
  try {
    localStorage.setItem(KEY, open ? 'open' : 'closed');
  } catch {
    // A per-visit choice then.
  }
}

/** ↑ and ↓ move between the links of the navigator (Tab still walks them in order). */
function moveFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>('a[href]')];
  const at = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (at === -1) return;
  const next = links[e.key === 'ArrowDown' ? Math.min(at + 1, links.length - 1) : Math.max(at - 1, 0)];
  e.preventDefault();
  next?.focus();
}

function FeatureStatusText({ status }: { status: FeatureStatus }) {
  switch (status.kind) {
    case 'needs':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-text">
          <span data-needs={status.count}>
            <Count n={status.count} label={status.detail} />
          </span>
          {status.word}
        </span>
      );
    case 'ready':
      return <StateText kind="done" word={status.word} className="text-xs" />;
    case 'doubt':
      return <StateText kind="conflict" word={status.word} className="text-xs" />;
    case 'draft':
      return <StateText kind="proposed" word={status.word} className="text-xs" />;
    default:
      return <StateText kind="open" word={status.word} className="text-xs" />;
  }
}

function RecordLink({ projectId, record }: { projectId: string; record: NavRecord }) {
  return (
    <li>
      <Link
        to="/p/$projectId/records/$code"
        params={{ projectId, code: record.code }}
        data-rail-record={record.code}
        data-feature-status={record.status?.kind}
        aria-current={record.current ? 'page' : undefined}
        className={cn(
          'flex flex-col gap-0.5 rounded-md border-l-2 px-2.5 py-1.5 text-sm transition-colors duration-[var(--m-fast)]',
          record.current ? 'border-accent bg-selected' : 'border-transparent hover:bg-hover',
        )}
      >
        <span className={cn('line-clamp-2 text-fg', record.current && 'font-semibold')}>{record.title}</span>
        {record.status ? (
          <FeatureStatusText status={record.status} />
        ) : (
          <span data-status={record.mark} className="inline-flex items-center gap-1 text-xs text-fg-2">
            <StateIcon kind={record.mark} size={12} />
            {MARKS[record.mark].name}
          </span>
        )}
      </Link>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <p id={id} className="px-2.5 text-xs font-medium text-fg-2">
        {title}
      </p>
      <ul aria-labelledby={id} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </div>
  );
}

export function RecordsNavigator({ projectId, code }: { projectId: string; code: string }) {
  const [open, setOpen] = useState(initialOpen);
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId)).data;
  const tables = useTables();
  const nav = navigatorOf(state.data, inbox, code);
  const listId = useId();
  const toggle = () =>
    setOpen((o) => {
      remember(!o);
      return !o;
    });

  return (
    <nav
      aria-label="Records"
      onKeyDown={moveFocus}
      data-open={open ? 'true' : 'false'}
      className={cn(
        'flex shrink-0 flex-col border-b border-edge bg-panel lg:sticky lg:top-2 lg:max-h-[calc(100vh-16px)] lg:self-start lg:overflow-y-auto lg:border-r lg:border-b-0',
        open ? 'lg:w-64' : 'lg:w-12',
      )}
    >
      {/* Closed on a wide screen: a strip with the way to open it. */}
      <div className={cn('hidden justify-center py-3', !open && 'lg:flex')}>
        <IconButton label="Show the records" onClick={toggle} aria-expanded={false} aria-controls={listId}>
          <PanelLeftIcon size={17} />
        </IconButton>
      </div>
      {/* Small screens: a full-width disclosure above the page. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={listId}
        className="flex h-11 w-full cursor-pointer items-center justify-between px-4 text-sm font-medium text-fg hover:bg-hover lg:hidden"
      >
        All records
        <ChevronDownIcon size={16} className={cn('text-fg-2 transition-transform', open && 'rotate-180')} />
      </button>
      <div id={listId} hidden={!open} className="flex flex-col gap-5 px-2 pt-2 pb-8 lg:pt-4">
        <div className="flex items-center justify-between gap-1">
          <Link
            to="/p/$projectId"
            params={{ projectId }}
            activeOptions={{ exact: true }}
            className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold text-fg hover:bg-hover"
          >
            <ChevronLeftIcon size={14} className="shrink-0 text-fg-3" />
            <span className="truncate">{nav.project || 'The product'}</span>
          </Link>
          <span className="hidden lg:inline-flex">
            <IconButton label="Hide the records" size="sm" onClick={toggle} aria-expanded aria-controls={listId}>
              <PanelLeftIcon size={16} />
            </IconButton>
          </span>
        </div>
        {tables && canCreate(tables, 'record.create') ? (
          <Link
            to="/p/$projectId/records/new"
            params={{ projectId }}
            className="-mt-3 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium text-accent-text hover:bg-hover"
          >
            <PlusIcon size={14} />
            New record
          </Link>
        ) : null}
        {state.error ? (
          <ErrorNotice error={state.error} compact focus={false} onRetry={() => void state.refetch()} />
        ) : !state.data ? (
          <Skeleton label="Loading the records">
            <div className="flex flex-col gap-2 px-2.5">
              <Bone className="h-3 w-16" />
              <Bone className="h-4 w-40" />
              <Bone className="h-4 w-32" />
              <Bone className="h-4 w-36" />
            </div>
          </Skeleton>
        ) : (
          <>
            {nav.groups.map((g) => (
              <Group key={g.key} title={g.title}>
                {g.records.length === 0 ? <li className="px-2.5 text-xs text-fg-2">No features yet.</li> : null}
                {g.records.map((r) => (
                  <RecordLink key={r.code} projectId={projectId} record={r} />
                ))}
              </Group>
            ))}
            <div className="flex flex-col gap-1">
              <p className="px-2.5 text-xs font-medium text-fg-2">Rules for the whole product</p>
              <p data-later className="mx-1 rounded-md border border-dashed border-edge-strong px-2.5 py-2 text-xs text-fg-2">
                <span className="font-medium text-fg">Later</span> · Rules that every feature follows come in a later increment.
              </p>
            </div>
            {nav.parked.length > 0 ? (
              <Group title="Parked ideas">
                {nav.parked.map((t) => (
                  <li key={t.id}>
                    <Link
                      to="/p/$projectId/threads/$explorationId"
                      params={{ projectId, explorationId: t.id }}
                      className="flex flex-col gap-0.5 rounded-md border-l-2 border-transparent px-2.5 py-1.5 text-sm hover:bg-hover"
                    >
                      <span className="line-clamp-2 text-fg">{t.purpose}</span>
                      <span data-status="parked" className="inline-flex items-center gap-1 text-xs text-fg-2">
                        <StateIcon kind="parked" size={12} />
                        Set aside
                      </span>
                    </Link>
                  </li>
                ))}
              </Group>
            ) : null}
          </>
        )}
      </div>
    </nav>
  );
}
