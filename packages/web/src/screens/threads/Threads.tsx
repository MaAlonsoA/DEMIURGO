// Threads (DESIGN.md §3.3, INV-THRS-*): every thread of the project as a tree — each one under the
// thread it was opened inside — with its state in words, what waits for the person and its last
// activity. The nesting is real tree semantics (a treegrid with levels, expand and collapse, arrow
// keys; R97, R98), not indentation only. A state filter narrows what is loaded; a failed load says
// so with Retry and is never shown as "no threads".

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, type MouseEvent, useMemo, useRef, useState } from 'react';
import { explorationsQuery, projectsQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Exploration } from '../../api/types.ts';
import { Count } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, ThreadsIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, usePageTitle } from '../../components/Page.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { EntityState } from '../../components/status.tsx';
import { Segmented } from '../../components/Tabs.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { cn } from '../../lib/cn.ts';
import { useProjectId, useTables } from '../../lib/hooks.ts';
import { OpenThreadDialog } from './OpenThreadDialog.tsx';
import { type StateFilter, type TreeRow, filterRows, stateCounts, threadTree, treeRows, visibleRows } from './tree.ts';

const FILTERS: { value: StateFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'concluded', label: 'Concluded' },
  { value: 'set_aside', label: 'Set aside' },
];

const FILTER_EMPTY: Record<Exclude<StateFilter, 'all'>, string> = {
  active: 'No active threads',
  concluded: 'No concluded threads',
  set_aside: 'No threads set aside',
};

export function ThreadsScreen() {
  const projectId = useProjectId();
  const tables = useTables();
  const threads = useQuery(explorationsQuery(projectId));
  const project = useQuery(projectsQuery).data?.find((p) => p.id === projectId);
  const [opening, setOpening] = useState(false);
  const [filter, setFilter] = useState<StateFilter>('all');
  const allowed = tables ? canCreate(tables, 'exploration.open') : false;
  usePageTitle(['Threads', project?.name]);

  const list = threads.data;
  const counts = stateCounts(list ?? []);
  const newThread = allowed ? (
    <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setOpening(true)}>
      New thread
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Threads"
        meta={
          list && list.length > 0 ? (
            <span className="tabular-nums">
              {list.length} {list.length === 1 ? 'thread' : 'threads'} · {counts.active} active
            </span>
          ) : (
            <span>Explore something with DEMIURGO: a question, an idea, a change.</span>
          )
        }
        actions={list?.length === 0 ? null : newThread}
      />
      <PageBody width="wide" className="flex flex-col gap-4">
        {threads.isPending ? (
          <RowsSkeleton label="Loading the threads" rows={4} />
        ) : !list ? (
          <ErrorNotice error={threads.error} onRetry={() => void threads.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState size="spacious" icon={<ThreadsIcon size={28} />} title="No threads yet" action={newThread}>
            {allowed ? 'Open one to explore something with DEMIURGO.' : 'Threads appear here when someone opens one.'}
          </EmptyState>
        ) : (
          <>
            {threads.isError ? (
              <ErrorNotice error={threads.error} onRetry={() => void threads.refetch()} focus={false} compact />
            ) : null}
            <Segmented
              label="Show threads"
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))}
            />
            <ThreadTree projectId={projectId} threads={list} filter={filter} onShowAll={() => setFilter('all')} />
          </>
        )}
      </PageBody>
      <OpenThreadDialog projectId={projectId} open={opening} onOpenChange={setOpening} />
    </>
  );
}

const COLUMNS = 'md:grid md:grid-cols-[minmax(0,1fr)_128px_136px_120px] md:gap-x-4';

/**
 * The threads as a treegrid: one row per thread, its level and whether it is expanded. The rows
 * form one tab stop: arrow keys move, Right and Left open and close a thread's children or go to
 * its parent, Enter opens the thread. A click anywhere on the row opens it too.
 */
function ThreadTree({
  projectId,
  threads,
  filter,
  onShowAll,
}: {
  projectId: string;
  threads: readonly Exploration[];
  filter: StateFilter;
  onShowAll: () => void;
}) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const all = useMemo(() => treeRows(filterRows(threadTree(threads), filter)), [threads, filter]);
  const rows = visibleRows(all, collapsed);

  if (rows.length === 0 && filter !== 'all') {
    return (
      <EmptyState title={FILTER_EMPTY[filter]} action={<Button onClick={onShowAll}>Show all threads</Button>}>
        Nothing in this state among the {threads.length} {threads.length === 1 ? 'thread' : 'threads'} of the project.
      </EmptyState>
    );
  }

  const current = rows.find((r) => r.thread.id === focusId) ?? rows[0];
  const open = (id: string) =>
    void navigate({ to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId: id } });
  const toggle = (id: string, to?: boolean) =>
    setCollapsed((c) => {
      const next = new Set(c);
      const collapse = to ?? !next.has(id);
      if (collapse) next.add(id);
      else next.delete(id);
      return next;
    });
  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    grid.current?.querySelector<HTMLElement>(`[data-thread-row="${id}"]`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, row: TreeRow, i: number) => {
    const isCollapsed = collapsed.has(row.thread.id);
    switch (e.key) {
      case 'ArrowDown':
        focusRow(rows[i + 1]?.thread.id);
        break;
      case 'ArrowUp':
        focusRow(rows[i - 1]?.thread.id);
        break;
      case 'Home':
        focusRow(rows[0]?.thread.id);
        break;
      case 'End':
        focusRow(rows.at(-1)?.thread.id);
        break;
      case 'ArrowRight':
        if (!row.hasChildren) return;
        if (isCollapsed) toggle(row.thread.id, false);
        else focusRow(rows[i + 1]?.thread.id);
        break;
      case 'ArrowLeft':
        if (row.hasChildren && !isCollapsed) toggle(row.thread.id, true);
        else focusRow(row.parentId ?? undefined);
        break;
      case 'Enter':
        open(row.thread.id);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onRowClick = (e: MouseEvent<HTMLDivElement>, id: string) => {
    // The title link and the expand button do their own thing.
    if ((e.target as HTMLElement).closest('a,button')) return;
    open(id);
  };

  return (
    <>
      <p id="threads-keys" className="sr-only">
        Arrow keys move between threads. Right and Left show or hide the threads inside one. Enter opens it.
      </p>
      <div
        ref={grid}
        role="treegrid"
        aria-label="Threads"
        aria-describedby="threads-keys"
        aria-rowcount={rows.length + 1}
        className="overflow-hidden rounded-lg border border-edge"
      >
        <div role="rowgroup" className="hidden border-b border-edge bg-sunken md:block">
          <div role="row" aria-rowindex={1} className={cn(COLUMNS, 'h-9 items-center px-3 text-sm font-medium text-fg-2')}>
            <span role="columnheader">Thread</span>
            <span role="columnheader">State</span>
            <span role="columnheader">Waiting on you</span>
            <span role="columnheader">Last activity</span>
          </div>
        </div>
        <div role="rowgroup" className="divide-y divide-edge-subtle">
          {rows.map((row, i) => {
            const t = row.thread;
            const isCollapsed = collapsed.has(t.id);
            const indent = Math.min(row.depth, 6) * 20;
            return (
              <div
                key={t.id}
                role="row"
                aria-rowindex={i + 2}
                aria-level={row.depth + 1}
                aria-setsize={row.setSize}
                aria-posinset={row.posInSet}
                aria-expanded={row.hasChildren ? !isCollapsed : undefined}
                tabIndex={current?.thread.id === t.id ? 0 : -1}
                data-thread-row={t.id}
                data-depth={row.depth}
                onFocus={(e) => {
                  if (e.target === e.currentTarget) setFocusId(t.id);
                }}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget) onKeyDown(e, row, i);
                }}
                onClick={(e) => onRowClick(e, t.id)}
                className={cn(
                  COLUMNS,
                  'flex min-h-11 cursor-pointer items-center px-3 py-2 outline-offset-[-2px] hover:bg-hover',
                )}
              >
                <div role="gridcell" className="flex w-full min-w-0 flex-col gap-1 md:w-auto" style={{ paddingLeft: indent }}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    {row.hasChildren ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={`${isCollapsed ? 'Show' : 'Hide'} the threads inside “${t.purpose}”`}
                        onClick={() => toggle(t.id)}
                        className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-xs text-fg-2 hover:bg-sunken hover:text-fg"
                      >
                        {isCollapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
                      </button>
                    ) : (
                      <span aria-hidden className="inline-block h-6 w-6 shrink-0" />
                    )}
                    <ThreadsIcon size={15} className="shrink-0 text-fg-3" />
                    <Link
                      to="/p/$projectId/threads/$explorationId"
                      params={{ projectId, explorationId: t.id }}
                      tabIndex={-1}
                      className="line-clamp-2 min-w-0 font-medium text-fg hover:underline"
                    >
                      {t.purpose}
                    </Link>
                  </div>
                  {/* Under 768 px the other columns fold into one line under the title. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[30px] text-sm text-fg-2 md:hidden">
                    <EntityState entity="exploration" state={t.state} />
                    <Waiting n={t.open_questions} />
                    <RelativeTime iso={t.last_activity} />
                  </div>
                </div>
                <div role="gridcell" className="hidden md:block">
                  <EntityState entity="exploration" state={t.state} />
                </div>
                <div role="gridcell" className="hidden md:block">
                  <Waiting n={t.open_questions} dash />
                </div>
                <div role="gridcell" className="hidden text-sm text-fg-2 md:block">
                  <span className="sr-only">Last activity </span>
                  <RelativeTime iso={t.last_activity} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/**
 * What waits for the person in a thread. The server counts its shown questions that are open,
 * assumed or parked, so the words say so (the old "open questions" undercounted, INVENTORY Part C).
 */
function Waiting({ n, dash }: { n: number; dash?: boolean }) {
  if (n <= 0)
    return dash ? (
      <span className="text-sm text-fg-3">
        <span aria-hidden>—</span>
        <span className="sr-only">Nothing waits for you</span>
      </span>
    ) : null;
  return <Count n={n} label={`${n} ${n === 1 ? 'question waits' : 'questions wait'} for you (open, assumed or parked)`} />;
}
