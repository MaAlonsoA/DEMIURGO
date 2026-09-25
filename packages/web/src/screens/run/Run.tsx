// The page of one run (DESIGN.md §3.4 "Run page", J3; INV-RUN-01…21): summary first, then detail
// (R28, R05, R04). The header names the action, its state (Late and Stalled included, §4.2), the
// agent and engine, who asked and where from, and the actions the tables allow: Cancel — which
// confirms and says what is kept (R27, R11) — Retry and Retry with… Under it, the status card and
// the phase strip; then the tabs Engine calls, Context, Output and Events; the facts and the
// attempts in the side column.

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { providersQuery } from '../../api/models.ts';
import { explorationsQuery, projectsQuery, runQuery, runsQuery, stateQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { RunDetail, RunListItem } from '../../api/types.ts';
import { useAllows } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { isNotFound } from '../../components/explain.ts';
import { ArrowLeftIcon, PlayIcon, RetryIcon, StopIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, WithAside, usePageTitle } from '../../components/Page.tsx';
import { RunStateBadge, useRunView } from '../../components/runState.tsx';
import { PageSkeleton } from '../../components/Spinner.tsx';
import { DayTime } from '../../components/Time.tsx';
import { WhoAvatar } from '../../components/Who.tsx';
import { useRouteParams, useTables } from '../../lib/hooks.ts';
import { dayTime } from '../../lib/time.ts';
import { ACTION_WORDS, whoOf } from '../../words.ts';
import { engineLabel } from '../models/engines.ts';
import { RetryWith } from '../models/RetryWith.tsx';
import { Attempts, RunFacts } from './Aside.tsx';
import { RunDetailTabs } from './Detail.tsx';
import { requestedBy, runTitle } from './runs.ts';
import { PhaseStrip, StatusCard } from './Status.tsx';

const RETRIABLE = ['failed', 'interrupted', 'cancelled'];
const actionWord = (a: string) => ACTION_WORDS[a] ?? a;
const link = 'font-medium text-fg underline decoration-edge-strong underline-offset-2 hover:decoration-fg';

const activityCrumb = (projectId: string) => ({
  label: 'Activity',
  link: { to: '/p/$projectId/activity' as const, params: { projectId } },
});

export function RunScreen() {
  const { projectId, runId = '' } = useRouteParams();
  const run = useQuery(runQuery(projectId, runId));
  const runs = useQuery(runsQuery(projectId));
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  const r = run.data;
  usePageTitle([r ? `${runTitle(r.action, ACTION_WORDS)} run` : 'Run', project?.name]);

  if (isNotFound(run.error))
    return (
      <>
        <PageHeader crumbs={[activityCrumb(projectId), { label: 'Run' }]} title="We couldn't find this run" />
        <PageBody width="reading">
          <EmptyState
            title="It isn't in this project"
            action={
              <Link to="/p/$projectId/activity" params={{ projectId }} className={buttonClass({ variant: 'secondary' })}>
                <ArrowLeftIcon size={14} />
                Back to Activity
              </Link>
            }
          >
            It may belong to another project.
          </EmptyState>
        </PageBody>
      </>
    );
  if (!r)
    return (
      <>
        <PageHeader crumbs={[activityCrumb(projectId), { label: 'Run' }]} title="Run" />
        <PageBody>
          {run.error ? (
            <ErrorNotice error={run.error} onRetry={() => void run.refetch()} />
          ) : (
            <PageSkeleton label="Loading the run" />
          )}
        </PageBody>
      </>
    );
  return <RunPage key={r.id} projectId={projectId} run={r} runs={runs.data ?? []} />;
}

function RunPage({ projectId, run: r, runs }: { projectId: string; run: RunDetail; runs: RunListItem[] }) {
  const view = useRunView(r);
  const item = runs.find((x) => x.id === r.id);
  const tables = useTables();
  const allows = useAllows('ai_run', r.state);
  const navigate = useNavigate();
  const cancel = useCommand(projectId);
  const retry = useCommand<{ runId: string }>(projectId);
  const [confirming, setConfirming] = useState(false);
  const status = useRef<HTMLElement>(null);
  const threads = useQuery(explorationsQuery(projectId)).data;
  const product = useQuery(stateQuery(projectId)).data;
  const catalogs = useQuery(providersQuery).data?.catalogs ?? [];

  const thread = item?.exploration_id ? threads?.find((t) => t.id === item.exploration_id) : undefined;
  const decision =
    r.scope.type === 'record_version'
      ? product?.decisions.find((d) => d.current_id === r.scope.id || d.latest_id === r.scope.id)
      : undefined;
  const engine = r.requested_model
    ? engineLabel({ provider: r.provider, model: r.requested_model, effort: r.effort ?? null }, catalogs)
    : r.provider;
  const agent = r.agent ?? r.method.split('@')[0];
  const canRetry = !!tables && canCreate(tables, 'run.retry') && RETRIABLE.includes(r.state);
  const who = whoOf(r.requested_by);

  const openRun = (runId: string) => void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId } });
  const doRetry = () =>
    retry.mutate(
      { command: 'run.retry', data: { run_id: r.id } },
      {
        onSuccess: (res) => {
          announce('Retried: a new attempt started.');
          openRun(res.result?.runId ?? res.entity_id);
        },
      },
    );
  const doCancel = () =>
    cancel.mutate(
      { command: 'run.cancel', entityId: r.id },
      {
        onSuccess: () => {
          setConfirming(false);
          announce('Cancelled. Nothing was applied.');
          // The Cancel button is gone: the focus goes to what happened, not to the page's end.
          setTimeout(() => status.current?.focus(), 60);
        },
      },
    );

  return (
    <>
      <div data-run-header>
        <PageHeader
          crumbs={[activityCrumb(projectId), { label: `${actionWord(r.action)} · ${dayTime(r.created_at)}` }]}
          eyebrow={
            <>
              <span className="inline-flex items-center gap-1.5">
                <PlayIcon size={14} className="text-fg-3" />
                Run
              </span>
              <RunStateBadge run={r} size="md" withDetail />
            </>
          }
          title={runTitle(r.action, ACTION_WORDS)}
          meta={
            <>
              <span>
                <Code className="text-sm">{agent}</Code>
                <span className="text-fg-3"> · </span>
                {engine}
              </span>
              {decision ? (
                <span>
                  From{' '}
                  <Link to="/p/$projectId/records/$code" params={{ projectId, code: decision.code }} className={link}>
                    {decision.title}
                  </Link>{' '}
                  <Code>{decision.code}</Code>
                </span>
              ) : null}
              {thread ? (
                <span className="min-w-0">
                  In the thread{' '}
                  <Link
                    to="/p/$projectId/threads/$explorationId"
                    params={{ projectId, explorationId: thread.id }}
                    className={link}
                  >
                    {thread.purpose}
                  </Link>
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <WhoAvatar kind={who.kind} size={16} />
                {requestedBy(r.requested_by)} · <DayTime iso={r.created_at} />
              </span>
            </>
          }
          actions={
            allows('run.cancel') || canRetry ? (
              <>
                {allows('run.cancel') ? (
                  <Button
                    variant="secondary"
                    icon={<StopIcon size={14} />}
                    data-command="run.cancel"
                    onClick={() => {
                      cancel.reset();
                      setConfirming(true);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                {canRetry ? (
                  <>
                    <Button
                      variant={r.failure_kind === 'invalid_output' ? 'secondary' : 'primary'}
                      icon={<RetryIcon size={14} />}
                      data-command="run.retry"
                      pending={retry.isPending}
                      pendingLabel="Retrying…"
                      onClick={doRetry}
                    >
                      Retry
                    </Button>
                    <RetryWith
                      projectId={projectId}
                      run={r}
                      onRetried={(runId) => {
                        announce('Retried on another engine: a new attempt started.');
                        openRun(runId);
                      }}
                    />
                  </>
                ) : null}
              </>
            ) : null
          }
        >
          {retry.error ? <ErrorNotice error={retry.error} /> : null}
        </PageHeader>
      </div>
      <PageBody>
        <WithAside
          asideLabel="Details"
          aside={
            <>
              <RunFacts run={r} active={view.active} />
              <Attempts projectId={projectId} run={r} runs={runs} />
            </>
          }
        >
          <div className="flex flex-col gap-8">
            <StatusCard ref={status} projectId={projectId} run={r} item={item} view={view} />
            <PhaseStrip projectId={projectId} run={r} />
            <RunDetailTabs projectId={projectId} run={r} active={view.active} />
          </div>
        </WithAside>
      </PageBody>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Cancel this run?"
        description={
          <p>
            {r.action === 'exploration_chat'
              ? 'It stops now. Nothing is applied; what it already wrote in the thread stays.'
              : 'It stops now. Nothing is applied.'}{' '}
            You can retry it afterwards on the same context.
          </p>
        }
        confirm="Cancel the run"
        cancel="Keep it running"
        tone="danger"
        pending={cancel.isPending}
        pendingLabel="Cancelling…"
        error={cancel.error}
        onConfirm={doCancel}
      />
    </>
  );
}
