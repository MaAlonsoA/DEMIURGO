// Runs inside a thread (DESIGN.md §3.3, §4.2; INV-THR-52…57). An agent run is never a spinner: while
// it works the card says what it does, its live progress and its time, and when this tab has heard
// nothing from its engine for a while it says so (Late, Stalled) instead of just counting. Cancel
// asks first and says what is kept (R27). A failure says what happened in product words, what the
// agent itself said, and offers Retry and Retry with another engine — the one that fits first. A
// retried or cancelled run stays as a quiet line; a draft that left its package says where to review it.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { progressText, useRunProgress } from '../../api/progress.ts';
import { batchQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Run, RunListItem } from '../../api/types.ts';
import { useAllows } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { ArrowRightIcon, PackageIcon, RetryIcon, StopIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { RunStateBadge, useRunView } from '../../components/runState.tsx';
import { Bone } from '../../components/Spinner.tsx';
import { EntityState, StateIcon, StatusBadge } from '../../components/status.tsx';
import { DayTime, useNow } from '../../components/Time.tsx';
import { WhoAvatar } from '../../components/Who.tsx';
import { useTables } from '../../lib/hooks.ts';
import { between } from '../../lib/time.ts';
import { ACTION_WORDS, failureWord } from '../../words.ts';
import { RetryWith } from '../models/RetryWith.tsx';
import { runDuration } from '../run/runs.ts';
import { type RunDisplay, progressWords } from './timeline.ts';

const RETRIABLE = ['failed', 'interrupted', 'cancelled'];

/** What a run in progress is doing, in a few words. */
const DOING: Record<string, string> = { exploration_chat: 'Answering…', design_proposal: 'Drafting…' };

const actionWord = (run: Pick<RunListItem, 'action'>) => ACTION_WORDS[run.action] ?? run.action;

/** The time a run has taken so far, never empty while it is active. */
function elapsed(run: Pick<Run, 'state' | 'created_at' | 'started_at' | 'finished_at'>, now: number): string {
  return runDuration(run, now) || between(run.created_at, run.finished_at, now);
}

/**
 * A run in progress in a line: the working state and what it does, with its time ("Drafting… ·
 * 0:42"). Also used by the run page.
 */
export function RunWorking({
  run,
  now,
}: {
  run: Pick<Run, 'state' | 'action' | 'created_at' | 'started_at' | 'finished_at'>;
  now: number;
}) {
  const queued = run.state === 'queued';
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-info-text">
      <StateIcon kind="working" />
      <span>
        {queued ? 'Queued' : (DOING[run.action] ?? 'Working…')} ·{' '}
        <span data-run-timer className="tabular-nums">
          {elapsed(run, now)}
        </span>
      </span>
    </span>
  );
}

export function RunCard({ projectId, run, display }: { projectId: string; run: RunListItem; display: RunDisplay }) {
  switch (display) {
    case 'working':
      return <WorkingCard projectId={projectId} run={run} />;
    case 'failed':
      return <FailedCard projectId={projectId} run={run} />;
    case 'retried':
    case 'cancelled':
      return <QuietLine projectId={projectId} run={run} display={display} />;
    case 'draft':
      return <DraftReady projectId={projectId} run={run} />;
  }
}

function DetailsLink({ projectId, run }: { projectId: string; run: RunListItem }) {
  return (
    <Link
      to="/p/$projectId/runs/$runId"
      params={{ projectId, runId: run.id }}
      aria-label={`Details of the ${actionWord(run).toLowerCase()} run`}
      className="inline-flex min-h-6 items-center gap-1 text-sm font-medium text-fg-2 hover:text-fg hover:underline"
    >
      Details
      <ArrowRightIcon size={12} />
    </Link>
  );
}

/** DEMIURGO is working: who and what, its state (Late and Stalled included), progress, time and Cancel. */
function WorkingCard({ projectId, run }: { projectId: string; run: RunListItem }) {
  const command = useCommand(projectId);
  const [confirming, setConfirming] = useState(false);
  const progress = useRunProgress(run.id);
  const view = useRunView(run);
  const now = useNow(true);
  const canCancel = useAllows('ai_run', run.state)('run.cancel');
  const cancel = () =>
    command.mutate(
      { command: 'run.cancel', entityId: run.id },
      {
        onSuccess: () => {
          setConfirming(false);
          announce('Run cancelled. Nothing was applied.');
        },
      },
    );
  return (
    <Card data-run-card="working" data-run={run.id} padding="sm" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <WhoAvatar kind="demiurgo" size={24} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="font-medium text-fg">DEMIURGO is working…</p>
          <p className="text-sm text-fg-2">
            {actionWord(run)}
            {run.model ? ` · ${run.model}` : ''}
          </p>
        </div>
        <span aria-live="off" className="inline-flex items-center gap-2 text-sm text-fg-2">
          <RunStateBadge run={run} />
          <span>
            {run.state === 'queued' ? 'waiting' : 'for'}{' '}
            <span data-run-timer className="tabular-nums">
              {elapsed(run, now)}
            </span>
          </span>
        </span>
        {canCancel ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<StopIcon size={12} />}
            data-command="run.cancel"
            onClick={() => {
              command.reset();
              setConfirming(true);
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>
      {run.state === 'running' ? (
        <p data-run-progress aria-live="off" className="pl-9 text-sm text-fg-2 tabular-nums">
          {progress ? progressWords(progressText(progress, now)) : (DOING[run.action] ?? 'Working…')}
        </p>
      ) : null}
      {view.detail ? (
        <p className="pl-9 text-sm text-warning-text">
          {view.detail}.{' '}
          {view.kind === 'stalled'
            ? 'It may still answer: you can wait, or cancel it and retry.'
            : 'It starts when DEMIURGO is free.'}
        </p>
      ) : null}
      {!confirming && command.error ? <ErrorNotice error={command.error} compact /> : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Cancel this run?"
        description={<p>DEMIURGO stops working on it. Nothing is applied; what it already wrote in the thread stays.</p>}
        confirm="Cancel the run"
        cancel="Keep it running"
        tone="danger"
        pending={command.isPending}
        pendingLabel="Cancelling…"
        error={confirming ? command.error : null}
        onConfirm={cancel}
      />
    </Card>
  );
}

/** It failed: what happened in product words, what the agent said, and the way to run it again. */
function FailedCard({ projectId, run }: { projectId: string; run: RunListItem }) {
  const tables = useTables();
  const command = useCommand(projectId);
  const canRetry = !!tables && canCreate(tables, 'run.retry') && RETRIABLE.includes(run.state);
  const interrupted = run.state === 'interrupted';
  // A malformed output is the engine's doing: another engine is the likelier fix (DESIGN.md §4.2).
  const otherEngineFirst = run.failure_kind === 'invalid_output';
  const retry = (
    <Button
      key="retry"
      size="sm"
      variant="secondary"
      icon={<RetryIcon size={13} />}
      data-command="run.retry"
      pending={command.isPending}
      pendingLabel="Retrying…"
      onClick={() =>
        command.mutate(
          { command: 'run.retry', data: { run_id: run.id } },
          { onSuccess: () => announce('Retrying the run on the same context.') },
        )
      }
    >
      Retry
    </Button>
  );
  const retryWith = <RetryWith key="with" projectId={projectId} run={run} />;
  return (
    <Card tone="danger" padding="sm" data-run-card="failed" data-run={run.id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1">
        <StatusBadge kind="problem" word={interrupted ? 'Interrupted' : 'Failed'} />
        <p className="min-w-0 flex-1 font-medium text-fg">{failureWord(run.failure_kind, run.state)}</p>
      </div>
      {run.error ? (
        <p className="text-sm text-fg-2">
          <span className="font-medium text-fg">What it said: </span>
          <span className="font-code break-words">{run.error}</span>
        </p>
      ) : null}
      <p className="text-xs text-fg-2">
        {actionWord(run)} · <DayTime iso={run.finished_at ?? run.created_at} />
        {run.model ? ` · ${run.model}` : ''}
      </p>
      {canRetry ? (
        <p className="text-sm text-fg-2">
          {interrupted
            ? 'It was DEMIURGO restarting, not what you wrote: a plain retry should work.'
            : otherEngineFirst
              ? 'Another engine may get the format right. Retry runs it again with the same context.'
              : 'Retry runs it again with the same context.'}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canRetry ? (otherEngineFirst ? [retryWith, retry] : [retry, retryWith]) : null}
        <DetailsLink projectId={projectId} run={run} />
      </div>
      {command.error ? <ErrorNotice error={command.error} compact /> : null}
    </Card>
  );
}

/** Not active any more: cancelled, or failed and already retried. */
function QuietLine({ projectId, run, display }: { projectId: string; run: RunListItem; display: 'retried' | 'cancelled' }) {
  const text =
    display === 'retried'
      ? `${run.state === 'interrupted' ? 'Interrupted' : 'Failed'}, then retried: ${failureWord(run.failure_kind, run.state)}`
      : `${actionWord(run)} after ${runDuration(run) || '0:00'}. Nothing was applied.`;
  return (
    <div
      data-run-card={display}
      data-run={run.id}
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1 text-sm text-fg-2"
    >
      <StatusBadge kind="inactive" word={display === 'retried' ? 'Retried' : 'Cancelled'} />
      <span className="min-w-0">{text}</span>
      <DetailsLink projectId={projectId} run={run} />
    </div>
  );
}

/** A draft left its package: its title and checks, and the way to review it. */
function DraftReady({ projectId, run }: { projectId: string; run: RunListItem }) {
  const batch = useQuery(batchQuery(projectId, run.batch_id ?? ''));
  if (!batch.data) {
    if (batch.isError)
      return (
        <div data-run-card="draft-loading" data-run={run.id}>
          <ErrorNotice error={batch.error} compact focus={false} onRetry={() => void batch.refetch()} />
        </div>
      );
    return (
      <Card data-run-card="draft-loading" data-run={run.id} padding="sm">
        <span className="sr-only">Loading the draft</span>
        <Bone className="h-4 w-2/3" />
      </Card>
    );
  }
  const payload = batch.data.proposals[0]?.payload as { title?: string; criteria?: unknown[] } | undefined;
  const title = payload?.title ?? 'a feature';
  const checks = payload?.criteria?.length ?? 0;
  const pending = batch.data.state === 'pending';
  return (
    <Card
      data-run-card="draft"
      data-run={run.id}
      padding="sm"
      {...(pending ? { tone: 'accent' as const } : {})}
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <PackageIcon size={18} className={pending ? 'text-accent-text' : 'text-fg-3'} />
      <p className="min-w-0 flex-1 text-fg">
        <span className="font-medium">{pending ? 'A draft is ready: ' : 'The draft '}</span>
        <span className="font-semibold">{title}</span>{' '}
        <span className="text-fg-2">
          with {checks} {checks === 1 ? 'check' : 'checks'}
        </span>
      </p>
      {!pending ? <EntityState entity="batch" state={batch.data.state} /> : null}
      <Link
        to="/p/$projectId/batches/$batchId"
        params={{ projectId, batchId: batch.data.id }}
        className={
          pending
            ? 'inline-flex min-h-6 items-center gap-1 text-sm font-medium text-accent-text hover:underline'
            : 'inline-flex min-h-6 items-center gap-1 text-sm font-medium text-fg-2 hover:text-fg hover:underline'
        }
      >
        {pending ? 'Review' : 'Open'}
        <ArrowRightIcon size={12} />
      </Link>
    </Card>
  );
}
