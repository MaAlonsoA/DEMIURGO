// Activity (spec §4.9): every run of the project with its state (mark and word), what it did, its
// thread, when and how long, newest first; a filter by state (?state=).

import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { explorationsQuery, runsQuery } from '../../api/queries.ts';
import type { RunListItem } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { dayTime } from '../../lib/time.ts';
import { EmptyState, Page, PageTitle, Skeleton } from '../../ui/layout.tsx';
import { StateMark } from '../../ui/marks.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { ACTION_WORDS, STATE_WORDS, failureWord } from '../../words.ts';
import { useNow } from '../run/hooks.ts';
import { RUN_STATES, askedBy, runDuration } from '../run/runs.ts';
import { isActive } from '../thread/timeline.ts';

type RunState = (typeof RUN_STATES)[number];
const isRunState = (s: string | undefined): s is RunState => !!s && (RUN_STATES as readonly string[]).includes(s);

export function ActivityScreen() {
  const projectId = useProjectId();
  const search = useSearch({ strict: false }) as { state?: string };
  const filter = isRunState(search.state) ? search.state : undefined;
  const all = useQuery(runsQuery(projectId));
  const runs = useQuery(runsQuery(projectId, filter ? { state: filter } : {}));
  const threads = useQuery(explorationsQuery(projectId)).data;
  const now = useNow(runs.data?.some(isActive) ?? false);
  const purposeOf = (id: string | null) => (id ? threads?.find((t) => t.id === id)?.purpose : undefined);
  const count = (s: RunState) => all.data?.filter((r) => r.state === s).length ?? 0;
  const working = all.data?.filter(isActive).length ?? 0;

  return (
    <Page>
      <PageTitle
        title="Activity"
        subtitle={
          all.data && all.data.length > 0
            ? `${all.data.length} ${all.data.length === 1 ? 'run' : 'runs'} of DEMIURGO${working ? ` · ${working} working now` : ''}`
            : 'What DEMIURGO did and is doing, run by run.'
        }
      />
      <nav aria-label="Filter by state" className="mb-4 flex flex-wrap items-center gap-1">
        <FilterLink projectId={projectId} label="All" count={all.data?.length} current={!filter} />
        {RUN_STATES.map((s) => (
          <FilterLink
            key={s}
            projectId={projectId}
            state={s}
            label={STATE_WORDS.ai_run?.[s]?.word ?? s}
            count={count(s)}
            current={filter === s}
          />
        ))}
      </nav>

      {runs.isPending ? (
        <TableSkeleton />
      ) : runs.data && runs.data.length > 0 ? (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
                <th scope="col" className="w-[150px] py-2.5 pr-4 pl-5 font-semibold">
                  State
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  Run
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  Thread
                </th>
                <th scope="col" className="w-[170px] px-4 py-2.5 font-semibold">
                  Asked by
                </th>
                <th scope="col" className="w-[120px] px-4 py-2.5 font-semibold">
                  When
                </th>
                <th scope="col" className="w-[100px] py-2.5 pr-5 pl-4 text-right font-semibold">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => (
                <RunRow key={r.id} projectId={projectId} run={r} purpose={purposeOf(r.exploration_id)} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>
          {filter
            ? `No ${(STATE_WORDS.ai_run?.[filter]?.word ?? filter).toLowerCase()} runs.`
            : 'No runs yet. They appear when you ask DEMIURGO in a thread.'}
        </EmptyState>
      )}
    </Page>
  );
}

function FilterLink({
  projectId,
  state,
  label,
  count,
  current,
}: {
  projectId: string;
  state?: RunState;
  label: string;
  count: number | undefined;
  current: boolean;
}) {
  return (
    <Link
      to="/p/$projectId/activity"
      params={{ projectId }}
      search={state ? { state } : {}}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium',
        current ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span aria-hidden="true" className={cn('text-xs tabular-nums', current ? 'text-white' : 'text-muted')}>
          {count}
        </span>
      )}
    </Link>
  );
}

function RunRow({ projectId, run: r, purpose, now }: { projectId: string; run: RunListItem; purpose?: string; now: number }) {
  const failed = r.state === 'failed' || r.state === 'interrupted';
  return (
    <tr data-run-row={r.id} className="border-b border-line-soft align-baseline last:border-b-0 hover:bg-surface-2">
      <td className="pt-[13px] pr-4 pb-3 pl-5 align-top">
        <StateMark entity="ai_run" state={r.state} />
      </td>
      <td className="px-4 py-3">
        <span className="flex flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <Link
              to="/p/$projectId/runs/$runId"
              params={{ projectId, runId: r.id }}
              className="text-[14px] font-semibold text-ink underline-offset-2 hover:underline"
            >
              {ACTION_WORDS[r.action] ?? r.action}
            </Link>
            {r.model && <span className="text-xs text-muted">{r.model}</span>}
            {r.retry_of && (
              <span className="rounded-full border border-line px-1.5 text-[11px] font-medium text-ink-2">Retry</span>
            )}
          </span>
          {failed && <span className="text-xs text-problem">{failureWord(r.failure_kind, r.state)}</span>}
        </span>
      </td>
      <td className="max-w-[320px] px-4 py-3">
        {r.exploration_id && purpose ? (
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId: r.exploration_id }}
            className="line-clamp-2 text-[13px] text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            {purpose}
          </Link>
        ) : (
          <span className="text-[13px] text-muted">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-[13px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <WhoMark actor={r.requested_by} size={16} />
          <span className="truncate">{askedBy(r.requested_by)}</span>
        </span>
      </td>
      <td className="px-4 py-3 text-[13px] whitespace-nowrap text-ink-2">
        <time dateTime={r.created_at}>{dayTime(r.created_at, now)}</time>
      </td>
      <td className="py-3 pr-5 pl-4 text-right text-[13px] whitespace-nowrap text-ink-2 tabular-nums">
        {runDuration(r, now) || '—'}
      </td>
    </tr>
  );
}

function TableSkeleton() {
  return (
    <div role="status" aria-label="Loading the runs" className="rounded-[var(--radius-card)] border border-line bg-surface">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-6 border-b border-line-soft px-5 py-3.5 last:border-b-0">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="ml-auto h-3 w-24" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}
