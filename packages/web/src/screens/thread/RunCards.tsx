// Runs inside a thread (spec §4.7): the design system's Working while DEMIURGO works (what it does,
// its time and Cancel), the rust box when it failed (the reason in product words, Retry and
// Details), a grey line when it was cancelled or retried, and "A draft is ready" when a draft left
// its package.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCommand } from '../../api/commands.ts';
import { useRunProgress } from '../../api/progress.ts';
import { RetryWith } from '../models/RetryWith.tsx';
import { LiveProgress } from '../run/Engine.tsx';
import { batchQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Run, RunListItem } from '../../api/types.ts';
import { useTables } from '../../lib/hooks.ts';
import { dayTime } from '../../lib/time.ts';
import { ActionBar } from '../../ui/ActionBar.tsx';
import { Button } from '../../ui/Button.tsx';
import { ChevronRight, TypeIcon } from '../../ui/icons.tsx';
import { Skeleton } from '../../ui/layout.tsx';
import { Mark, StateMark, WorkingMark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { ACTION_WORDS, failureWord } from '../../words.ts';
import { runDuration } from '../run/runs.ts';
import type { RunDisplay } from './timeline.ts';

const RETRIABLE = ['failed', 'interrupted', 'cancelled'];

/** What a run in progress is doing, in a few words. */
const DOING: Record<string, string> = { exploration_chat: 'Answering…', design_proposal: 'Drafting…' };

/** A run in progress as the design system's Working: the amber dot and what it is doing, with its
    time ("Drafting… · 0:42"). It carries the Working mark's tooltip and place in the legend. */
export function RunWorking({
  run,
  now,
}: {
  run: Pick<Run, 'state' | 'action' | 'created_at' | 'started_at' | 'finished_at'>;
  now: number;
}) {
  const queued = run.state === 'queued';
  const time = runDuration(run, now);
  return (
    <WorkingMark {...(queued ? { label: 'Queued' } : {})}>
      <span>
        {queued ? 'Queued' : (DOING[run.action] ?? 'Working…')}
        {time && ' · '}
        <span data-run-timer>{time}</span>
      </span>
    </WorkingMark>
  );
}

export function RunCard({
  projectId,
  run,
  display,
  now,
}: {
  projectId: string;
  run: RunListItem;
  display: RunDisplay;
  now: number;
}) {
  switch (display) {
    case 'working':
      return <WorkingCard projectId={projectId} run={run} now={now} />;
    case 'failed':
      return <FailedCard projectId={projectId} run={run} />;
    case 'retried':
    case 'cancelled':
      return <QuietLine projectId={projectId} run={run} display={display} />;
    case 'draft':
      return <DraftReady projectId={projectId} run={run} />;
  }
}

function DetailsLink({ projectId, run, className }: { projectId: string; run: RunListItem; className?: string }) {
  return (
    <Link
      to="/p/$projectId/runs/$runId"
      params={{ projectId, runId: run.id }}
      aria-label={`Details of the ${action(run).toLowerCase()} run`}
      className={className ?? 'dm-text-small inline-flex items-center gap-0.5 font-semibold text-ink-2 hover:text-ink'}
    >
      Details
      <ChevronRight size={12} />
    </Link>
  );
}

const action = (run: RunListItem) => ACTION_WORDS[run.action] ?? run.action;

/** DEMIURGO is working: who, what (with its model when known), Working with the time ticking, and Cancel. */
function WorkingCard({ projectId, run, now }: { projectId: string; run: RunListItem; now: number }) {
  const command = useCommand(projectId);
  const progress = useRunProgress(run.id);
  return (
    <div
      data-run-card="working"
      data-run={run.id}
      className="flex flex-col gap-2 rounded-card-md border border-line bg-surface px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <WhoMark actor={`agent:run:${run.id}`} model={run.model} size={18} />
        <p className="dm-text-body flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="font-semibold text-ink">DEMIURGO is working…</span>
          <span className="dm-text-small text-muted">
            {action(run)}
            {run.model ? ` · ${run.model}` : ''}
          </span>
          <LiveProgress progress={progress} now={now} />
        </p>
        <RunWorking run={run} now={now} />
        <ActionBar
          entity="ai_run"
          state={run.state}
          handlers={{
            'run.cancel': {
              variant: 'secondary',
              disabled: command.isPending,
              run: () => command.mutate({ command: 'run.cancel', entityId: run.id }),
            },
          }}
        />
      </div>
      {command.error ? <Reasons error={command.error} /> : null}
    </div>
  );
}

/** It failed: the rust box, with the reason in product words, Retry on the same context and Details. */
function FailedCard({ projectId, run }: { projectId: string; run: RunListItem }) {
  const tables = useTables();
  const command = useCommand(projectId);
  const canRetry = !!tables && canCreate(tables, 'run.retry') && RETRIABLE.includes(run.state);
  return (
    <div
      data-run-card="failed"
      data-run={run.id}
      className="flex flex-col gap-2 rounded-card-md bg-problem-tint px-4 py-3 text-problem"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-5 w-4 items-center justify-center">
          {/* The design system's Conflict icon, with its tooltip and place in the legend. */}
          <Mark kind="problem" label={run.state === 'interrupted' ? 'Interrupted' : 'Failed'} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="dm-text-body font-semibold">{failureWord(run.failure_kind, run.state)}</p>
          <p className="dm-text-caption">
            {action(run)} · {dayTime(run.finished_at ?? run.created_at)}
            {run.model ? ` · ${run.model}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <DetailsLink
            projectId={projectId}
            run={run}
            className="dm-text-small inline-flex items-center gap-0.5 font-semibold text-problem hover:underline"
          />
          {canRetry && <RetryWith projectId={projectId} run={run} />}
          {canRetry && (
            <Button
              variant="secondary"
              data-command="run.retry"
              disabled={command.isPending}
              onClick={() => command.mutate({ command: 'run.retry', data: { run_id: run.id } })}
            >
              {command.isPending ? 'Retrying…' : 'Retry'}
            </Button>
          )}
        </div>
      </div>
      {command.error ? <Reasons error={command.error} /> : null}
    </div>
  );
}

/** Not active: cancelled, or failed and already retried. */
function QuietLine({ projectId, run, display }: { projectId: string; run: RunListItem; display: 'retried' | 'cancelled' }) {
  const text =
    display === 'retried'
      ? `${run.state === 'interrupted' ? 'Interrupted' : 'Failed'}, then retried: ${failureWord(run.failure_kind, run.state)}`
      : `Cancelled · ${action(run)} after ${runDuration(run) || '0:00'}`;
  return (
    <div data-run-card={display} data-run={run.id} className="dm-text-small flex items-center gap-2.5 px-1 text-muted">
      <span className="flex w-4 justify-center">
        <Mark kind="inactive" label={display === 'retried' ? 'Retried' : 'Cancelled'} />
      </span>
      <span className="min-w-0 truncate">{text}</span>
      <span className="dm-sep" aria-hidden="true">
        ·
      </span>
      <DetailsLink
        projectId={projectId}
        run={run}
        className="inline-flex items-center gap-0.5 font-semibold text-ink-2 hover:text-ink"
      />
    </div>
  );
}

/** A draft left its package: its title and checks, and the way to review it. While it waits for the
    person it sits on the Needs you ground. */
function DraftReady({ projectId, run }: { projectId: string; run: RunListItem }) {
  const batch = useQuery(batchQuery(projectId, run.batch_id ?? ''));
  const payload = batch.data?.proposals[0]?.payload as { title?: string; criteria?: unknown[] } | undefined;
  if (!batch.data) {
    return (
      <div data-run-card="draft-loading" className="rounded-card-md border border-line bg-surface px-4 py-3" aria-hidden="true">
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  const title = payload?.title ?? 'a feature';
  const checks = payload?.criteria?.length ?? 0;
  const pending = batch.data.state === 'pending';
  return (
    <div
      data-run-card="draft"
      data-run={run.id}
      className={
        pending
          ? 'flex items-center gap-3 rounded-card-md border border-needs-line bg-needs-soft px-4 py-3'
          : 'flex items-center gap-3 rounded-card-md border border-line bg-surface px-4 py-3'
      }
    >
      <span className={pending ? 'flex text-ink-2' : 'flex text-muted'}>
        <TypeIcon kind="package" size={16} />
      </span>
      <p className="dm-text-body min-w-0 flex-1 text-ink">
        {pending ? <span className="font-semibold">A draft is ready: </span> : <span className="font-semibold">The draft </span>}
        <span className="font-semibold">{title}</span>{' '}
        <span className="text-ink-2">
          with {checks} {checks === 1 ? 'check' : 'checks'}
        </span>
        {!pending && (
          <span className="ml-2 inline-flex align-middle">
            <StateMark entity="batch" state={batch.data.state} />
          </span>
        )}
      </p>
      <Link
        to="/p/$projectId/batches/$batchId"
        params={{ projectId, batchId: batch.data.id }}
        className={
          pending
            ? 'dm-text-small inline-flex shrink-0 items-center gap-0.5 font-semibold text-needs-strong hover:underline'
            : 'dm-text-small inline-flex shrink-0 items-center gap-0.5 font-semibold text-ink-2 hover:text-ink'
        }
      >
        {pending ? 'Review' : 'Open'}
        <ChevronRight size={12} />
      </Link>
    </div>
  );
}
