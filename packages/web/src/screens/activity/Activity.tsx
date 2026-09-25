// Activity (DESIGN.md §3.4, J3; INV-ACT-01…11): every run of DEMIURGO in the project, newest
// first. The header counts what is working and what failed and was not retried; "Right now" lists
// what is queued or working with its live progress, Late and Stalled included; usage sits in a
// collapsible panel titled with its period; the filter by state is a row of links with visible
// counts. In the table the whole row opens the run, a retry says which attempt it is and links to
// the one it retries, a failure is in words — and a failed load says so, with Retry, never "No
// runs yet" (INVENTORY §2 #5).

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { MouseEvent } from 'react';
import { explorationsQuery, projectsQuery, runsQuery } from '../../api/queries.ts';
import type { RunListItem } from '../../api/types.ts';
import { buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ActivityIcon, ThreadsIcon } from '../../components/icons.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, usePageTitle } from '../../components/Page.tsx';
import { RunStateBadge, attemptOf, isActive } from '../../components/runState.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { SegmentedLinks } from '../../components/Tabs.tsx';
import { DayTime, useNow } from '../../components/Time.tsx';
import { Who } from '../../components/Who.tsx';
import { useProjectId } from '../../lib/hooks.ts';
import { ACTION_WORDS, STATE_WORDS, failureWord } from '../../words.ts';
import { RUN_STATES, runDuration } from '../run/runs.ts';
import { RUNS_LIMIT, activityLine, countsByState, emptyFilterWords, isRunState } from './summary.ts';
import { RightNow } from './RightNow.tsx';
import { ProjectUsage } from './Usage.tsx';

const stateWordOf = (s: string) => STATE_WORDS.ai_run?.[s]?.word ?? s;

export function ActivityScreen() {
  const projectId = useProjectId();
  const search = useSearch({ strict: false }) as { state?: string };
  const filter = isRunState(search.state) ? search.state : undefined;
  const all = useQuery(runsQuery(projectId));
  const runs = useQuery(runsQuery(projectId, filter ? { state: filter } : {}));
  const threads = useQuery(explorationsQuery(projectId)).data;
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  usePageTitle(['Activity', project?.name]);
  const everything = all.data ?? [];
  const now = useNow(everything.some((r) => isActive(r.state)));
  const counts = all.data ? countsByState(all.data) : null;
  const purposeOf = (id: string | null) => (id ? threads?.find((t) => t.id === id)?.purpose : undefined);
  const retry = () => {
    void all.refetch();
    void runs.refetch();
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <ActivityIcon size={14} className="text-fg-3" />
            What the agents do
          </span>
        }
        title="Activity"
        meta={all.data ? <span data-activity-summary>{activityLine(all.data, now)}</span> : null}
      />
      <PageBody>
        <div className="flex flex-col gap-8">
          <RightNow projectId={projectId} runs={everything.filter((r) => isActive(r.state))} purposeOf={purposeOf} />
          <ProjectUsage projectId={projectId} />
          <Section title="Runs" id="runs" note="Newest first. Open one to see what it did, step by step.">
            <SegmentedLinks
              label="Filter by state"
              segments={[
                {
                  key: 'all',
                  label: 'All',
                  ...(all.data ? { count: all.data.length } : {}),
                  link: { to: '/p/$projectId/activity', params: { projectId }, search: {} },
                  current: !filter,
                },
                ...RUN_STATES.map((s) => ({
                  key: s,
                  label: stateWordOf(s),
                  ...(counts ? { count: counts[s] } : {}),
                  link: { to: '/p/$projectId/activity' as const, params: { projectId }, search: { state: s } },
                  current: filter === s,
                })),
              ]}
            />
            {runs.isPending ? (
              <RowsSkeleton label="Loading the runs" rows={5} />
            ) : runs.error && !runs.data ? (
              <ErrorNotice error={runs.error} onRetry={retry} />
            ) : runs.data.length === 0 ? (
              filter ? (
                <EmptyState
                  title={emptyFilterWords(stateWordOf(filter))}
                  action={
                    <Link to="/p/$projectId/activity" params={{ projectId }} search={{}} className={buttonClass()}>
                      Show all runs
                    </Link>
                  }
                >
                  None of the runs of this project is in this state.
                </EmptyState>
              ) : (
                <EmptyState
                  icon={<ActivityIcon size={24} />}
                  title="No runs yet"
                  action={
                    <Link to="/p/$projectId/threads" params={{ projectId }} className={buttonClass({ variant: 'primary' })}>
                      <ThreadsIcon size={14} />
                      Open the threads
                    </Link>
                  }
                >
                  They appear when you ask DEMIURGO in a thread.
                </EmptyState>
              )
            ) : (
              <>
                <RunsTable projectId={projectId} runs={runs.data} all={everything} purposeOf={purposeOf} now={now} />
                {runs.data.length >= RUNS_LIMIT ? (
                  <Notice tone="info">
                    Showing the latest {RUNS_LIMIT} runs. Older runs are not listed here; their threads still show them.
                  </Notice>
                ) : null}
              </>
            )}
          </Section>
        </div>
      </PageBody>
    </>
  );
}

const th = 'px-4 py-2.5 text-xs font-medium text-fg-2 whitespace-nowrap';
const td = 'px-4 py-3 align-top max-md:p-0';

function RunsTable({
  projectId,
  runs,
  all,
  purposeOf,
  now,
}: {
  projectId: string;
  runs: RunListItem[];
  all: RunListItem[];
  purposeOf: (id: string | null) => string | undefined;
  now: number;
}) {
  const navigate = useNavigate();
  // The whole row opens the run; its link stays the accessible way in (and the one keyboards use).
  const open = (e: MouseEvent<HTMLTableRowElement>, runId: string) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    if (window.getSelection()?.toString()) return;
    void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId } });
  };
  return (
    <div className="md:rounded-lg md:border md:border-edge">
      <table className="w-full border-collapse text-left text-sm max-md:block">
        <caption className="sr-only">Runs of DEMIURGO, newest first</caption>
        <thead className="max-md:sr-only">
          <tr className="border-b border-edge">
            <th scope="col" className={`${th} w-40`}>
              State
            </th>
            <th scope="col" className={th}>
              Run
            </th>
            <th scope="col" className={th}>
              Thread
            </th>
            <th scope="col" className={`${th} w-44`}>
              Requested by
            </th>
            <th scope="col" className={`${th} w-28`}>
              When
            </th>
            <th scope="col" className={`${th} w-24 text-right`}>
              Duration
            </th>
          </tr>
        </thead>
        <tbody className="max-md:flex max-md:flex-col max-md:gap-2">
          {runs.map((r) => (
            <RunRow
              key={r.id}
              projectId={projectId}
              run={r}
              all={all}
              purpose={purposeOf(r.exploration_id)}
              now={now}
              onOpen={open}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunRow({
  projectId,
  run: r,
  all,
  purpose,
  now,
  onOpen,
}: {
  projectId: string;
  run: RunListItem;
  all: RunListItem[];
  purpose: string | undefined;
  now: number;
  onOpen: (e: MouseEvent<HTMLTableRowElement>, runId: string) => void;
}) {
  const failed = r.state === 'failed' || r.state === 'interrupted';
  const attempt = r.retry_of ? attemptOf(r, all) : 1;
  const action = ACTION_WORDS[r.action] ?? r.action;
  const agentModel = [r.agent, r.model ?? r.requested_model].filter(Boolean).join(' · ');
  return (
    <tr
      data-run-row={r.id}
      onClick={(e) => onOpen(e, r.id)}
      className="cursor-pointer border-b border-edge-subtle last:border-b-0 hover:bg-hover max-md:flex max-md:flex-wrap max-md:items-start max-md:gap-x-3 max-md:gap-y-1.5 max-md:rounded-lg max-md:border max-md:border-edge max-md:px-4 max-md:py-3 max-md:last:border-b"
    >
      <td className={td}>
        <RunStateBadge run={r} />
      </td>
      <td className={`${td} max-md:min-w-0 max-md:flex-1 max-md:basis-40`}>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Link
              to="/p/$projectId/runs/$runId"
              params={{ projectId, runId: r.id }}
              className="text-base font-medium text-fg underline-offset-2 hover:underline"
            >
              {action}
            </Link>
            {r.retry_of ? (
              <Link
                to="/p/$projectId/runs/$runId"
                params={{ projectId, runId: r.retry_of }}
                className="text-sm font-medium text-accent-text hover:underline"
              >
                Attempt {attempt}
                <span className="sr-only">: open the run it retries</span>
              </Link>
            ) : null}
          </span>
          {agentModel ? <span className="truncate text-xs text-fg-3">{agentModel}</span> : null}
          {failed ? <span className="text-sm text-danger-text">{failureWord(r.failure_kind, r.state)}</span> : null}
          {r.state === 'cancelled' ? <span className="text-sm text-fg-2">{failureWord('cancelled')}</span> : null}
        </span>
      </td>
      <td className={`${td} max-w-80 max-md:max-w-none max-md:basis-full`}>
        {r.exploration_id && purpose ? (
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId: r.exploration_id }}
            className="line-clamp-2 text-fg-2 underline-offset-2 hover:text-fg hover:underline"
          >
            {purpose}
          </Link>
        ) : (
          <span className="text-fg-3 max-md:hidden">—</span>
        )}
      </td>
      <td className={`${td} text-fg-2`}>
        <span className="sr-only md:hidden">Requested by </span>
        <Who actor={r.requested_by} size={16} />
      </td>
      <td className={`${td} whitespace-nowrap text-fg-2`}>
        <DayTime iso={r.created_at} />
      </td>
      <td className={`${td} whitespace-nowrap text-right text-fg-2 tabular-nums`}>
        <span className="md:hidden">{isActive(r.state) ? 'Running ' : 'Took '}</span>
        {runDuration(r, now) || '—'}
      </td>
    </tr>
  );
}
