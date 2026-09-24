// A run (spec §4.9): its state and why it failed in product words, Cancel, Retry and Retry with…,
// what it retries and its retries, the agent and engine that ran it with its metrics and live
// progress (FDR-AGE-002), what the engine did, its context (role, builder, budget, graph version,
// dependencies and hash, with the content folded) and its events.

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { explorationsQuery, runQuery, runsQuery, stateQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { ContextPack, Dependency, RunDetail, RunListItem } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { useRouteParams, useTables } from '../../lib/hooks.ts';
import { dayTime } from '../../lib/time.ts';
import { ActionBar } from '../../ui/ActionBar.tsx';
import { Button } from '../../ui/Button.tsx';
import { ChevronRight, TypeIcon } from '../../ui/icons.tsx';
import { Breadcrumbs, Page, SectionTitle, Skeleton } from '../../ui/layout.tsx';
import { Mark, StateMark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { ACTION_WORDS, failureWord } from '../../words.ts';
import { NotFound } from '../not-found/NotFound.tsx';
import { isActive } from '../thread/timeline.ts';
import { useRunProgress } from '../../api/progress.ts';
import { RetryWith } from '../models/RetryWith.tsx';
import { CallsSection, EngineFacts, LiveProgress, UsageFacts } from './Engine.tsx';
import { runEventsQuery, useNow } from './hooks.ts';
import { EVENT_WORDS, requestedBy, retriesOf, runDuration } from './runs.ts';

const RETRIABLE = ['failed', 'interrupted', 'cancelled'];
const actionWord = (a: string) => ACTION_WORDS[a] ?? a;

export function RunScreen() {
  const { projectId, runId = '' } = useRouteParams();
  const run = useQuery(runQuery(projectId, runId));
  const runs = useQuery(runsQuery(projectId));
  const now = useNow(!!run.data && isActive(run.data));

  if (run.error instanceof ApiError && run.error.status === 404) {
    return <NotFound thing="this run">It may belong to another project.</NotFound>;
  }
  const r = run.data;
  if (!r && run.error) {
    return (
      <Page>
        <Reasons error={run.error} className="max-w-[860px]" />
      </Page>
    );
  }
  if (!r) return <RunSkeleton />;
  const item = runs.data?.find((x) => x.id === r.id);

  return (
    <Page aside={<RunAside projectId={projectId} run={r} runs={runs.data ?? []} now={now} />}>
      <div className="flex max-w-[860px] flex-col gap-6">
        <RunHeader projectId={projectId} run={r} item={item} />
        <Status projectId={projectId} run={r} item={item} now={now} />
        <CallsSection projectId={projectId} runId={r.id} active={isActive(r)} />
        {r.context_pack ? (
          <ContextSection projectId={projectId} pack={r.context_pack} />
        ) : (
          <p className="text-[13px] text-muted">This run has no context pack.</p>
        )}
        {r.output !== null && r.output !== undefined && (
          <details className="group rounded-[var(--radius-card)] border border-line bg-surface">
            <summary className="cursor-pointer list-none px-5 py-3 text-[13px] font-semibold text-ink-2 hover:text-ink">
              <span className="inline-flex items-center gap-1.5">
                <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                What it answered
              </span>
            </summary>
            <pre className="max-h-[420px] overflow-auto border-t border-line-soft px-5 py-3 font-mono text-[12px] leading-relaxed text-ink-2">
              {JSON.stringify(r.output, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </Page>
  );
}

function RunHeader({ projectId, run: r, item }: { projectId: string; run: RunDetail; item: RunListItem | undefined }) {
  const tables = useTables();
  const command = useCommand<{ runId: string }>(projectId);
  const navigate = useNavigate();
  const threads = useQuery(explorationsQuery(projectId)).data;
  const products = useQuery(stateQuery(projectId)).data;
  const thread = item?.exploration_id ? threads?.find((t) => t.id === item.exploration_id) : undefined;
  const decision =
    r.scope.type === 'record_version'
      ? products?.decisions.find((d) => d.current_id === r.scope.id || d.latest_id === r.scope.id)
      : undefined;
  const canRetry = !!tables && canCreate(tables, 'run.retry') && RETRIABLE.includes(r.state);
  const retry = () =>
    command.mutate(
      { command: 'run.retry', data: { run_id: r.id } },
      {
        onSuccess: (res) =>
          void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId: res.result?.runId ?? res.entity_id } }),
      },
    );
  const link = 'font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline';

  return (
    <header data-run-header className="flex flex-col gap-2.5">
      <Breadcrumbs
        items={[
          { label: 'Activity', to: '/p/$projectId/activity', params: { projectId } },
          { label: `${actionWord(r.action)} · ${dayTime(r.created_at)}` },
        ]}
      />
      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
        <TypeIcon kind="run" size={14} />
        Run
        <span className="text-inactive-light" aria-hidden="true">
          ·
        </span>
        <span className="tracking-normal normal-case">
          <StateMark entity="ai_run" state={r.state} />
        </span>
      </div>
      <div className="flex items-start justify-between gap-6">
        <h1 className="text-[26px] leading-tight font-semibold">
          {r.action === 'design_proposal' ? 'Draft a feature' : actionWord(r.action)}
        </h1>
        <ActionBar
          entity="ai_run"
          state={r.state}
          className="shrink-0 pt-1"
          handlers={{
            'run.cancel': {
              variant: 'working',
              disabled: command.isPending,
              run: () => command.mutate({ command: 'run.cancel', entityId: r.id }),
            },
          }}
        >
          {canRetry && (
            <>
              <RetryWith
                projectId={projectId}
                run={r}
                onRetried={(runId) => void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId } })}
              />
              <Button variant="ink" data-command="run.retry" disabled={command.isPending} onClick={retry}>
                {command.isPending ? 'Retrying…' : 'Retry'}
              </Button>
            </>
          )}
        </ActionBar>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        {decision && (
          <>
            <span>
              From{' '}
              <Link to="/p/$projectId/records/$code" params={{ projectId, code: decision.code }} className={link}>
                {decision.title}
              </Link>{' '}
              <span className="font-mono text-[11px]">{decision.code}</span>
            </span>
            <Dot />
          </>
        )}
        {thread && (
          <>
            <span>
              In the thread{' '}
              <Link to="/p/$projectId/threads/$explorationId" params={{ projectId, explorationId: thread.id }} className={link}>
                {thread.purpose}
              </Link>
            </span>
            <Dot />
          </>
        )}
        <span className="inline-flex items-center gap-1.5">
          <WhoMark actor={r.requested_by} size={16} />
          {requestedBy(r.requested_by)} · {dayTime(r.created_at)}
        </span>
      </p>
      {command.error ? <Reasons error={command.error} /> : null}
    </header>
  );
}

const Dot = () => (
  <span className="text-inactive-light" aria-hidden="true">
    ·
  </span>
);

/** What happened, in product words: working, finished, failed (and why) or cancelled. */
function Status({
  projectId,
  run: r,
  item,
  now,
}: {
  projectId: string;
  run: RunDetail;
  item: RunListItem | undefined;
  now: number;
}) {
  const box = 'flex items-start gap-3 rounded-[12px] border px-4 py-3.5';
  const progress = useRunProgress(r.id);
  if (isActive(r)) {
    return (
      <div data-run-status className={cn(box, 'items-center border-working/45 bg-working-bg text-working-text')}>
        <span className="flex w-4 justify-center">
          <Mark kind="working" label={r.state === 'queued' ? 'Queued' : 'Working'} />
        </span>
        <p className="flex flex-1 flex-col text-[14px] font-semibold">
          {r.state === 'queued' ? 'Waiting to start…' : 'DEMIURGO is working…'}
          <LiveProgress progress={progress} now={now} />
        </p>
        <span data-run-timer className="text-[13px] font-semibold tabular-nums">
          {runDuration(r, now)}
        </span>
      </div>
    );
  }
  if (r.state === 'completed') {
    return (
      <div data-run-status className={cn(box, 'border-line bg-surface')}>
        <span className="flex h-5 w-4 items-center justify-center">
          <Mark kind="done" label="Completed" />
        </span>
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-[14px] font-semibold text-ink">Finished in {runDuration(r) || '0:00'}.</p>
          <p className="text-[13px] text-ink-2">
            {item?.batch_id
              ? 'It proposed what it found: it waits for you before anything changes.'
              : 'What it wrote is in its thread.'}
          </p>
        </div>
        {item?.batch_id && (
          <Link
            to="/p/$projectId/batches/$batchId"
            params={{ projectId, batchId: item.batch_id }}
            className="inline-flex shrink-0 items-center gap-0.5 self-center text-[13px] font-semibold text-needs hover:text-needs-hover"
          >
            Review
            <ChevronRight size={12} />
          </Link>
        )}
      </div>
    );
  }
  const cancelled = r.state === 'cancelled';
  return (
    <div
      data-run-status
      className={cn(box, cancelled ? 'border-dashed border-line-strong bg-surface-2' : 'border-problem-line bg-problem-bg')}
    >
      <span className="flex h-5 w-4 items-center justify-center">
        <Mark
          kind={cancelled ? 'inactive' : 'problem'}
          label={cancelled ? 'Cancelled' : r.state === 'interrupted' ? 'Interrupted' : 'Failed'}
        />
      </span>
      <div className="flex flex-1 flex-col gap-1">
        <p className={cn('text-[14px] font-semibold', cancelled ? 'text-ink-2' : 'text-problem')}>
          {failureWord(r.failure_kind ?? (cancelled ? 'cancelled' : null), r.state)}
        </p>
        {r.error && (
          <p className={cn('text-[13px]', cancelled ? 'text-muted' : 'text-problem')}>
            <span className="font-semibold">What it said: </span>
            <span className="break-words">{r.error}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** The context pack: what DEMIURGO was given, the same one a retry reuses. */
function ContextSection({ projectId, pack }: { projectId: string; pack: ContextPack }) {
  const threads = useQuery(explorationsQuery(projectId)).data;
  const budget = Object.entries(pack.budget ?? {});
  return (
    <section data-context aria-labelledby="run-context" className="rounded-[var(--radius-card)] border border-line bg-surface">
      <header className="flex items-baseline justify-between gap-3 border-b border-line-soft px-5 py-3">
        <h2 id="run-context" className="text-[15px] font-semibold">
          Context
        </h2>
        <span className="text-xs text-muted">What DEMIURGO was given. A retry reuses it as it is.</span>
      </header>
      <dl className="grid grid-cols-[150px_1fr] items-baseline gap-x-5 gap-y-3 px-5 py-4 text-[13px]">
        <Term>Role</Term>
        <dd className="text-ink">{pack.role}</dd>
        <Term>Builder</Term>
        <dd className="font-mono text-[12px] text-ink">{pack.builder}</dd>
        <Term>Budget</Term>
        <dd className="flex flex-wrap gap-1.5">
          {budget.length === 0 && <span className="text-muted">None</span>}
          {budget.map(([k, v]) => (
            <span key={k} className="rounded-md border border-line-soft bg-surface-2 px-2 py-0.5 text-[12px] text-ink-2">
              {k} <span className="font-mono text-ink">{typeof v === 'number' ? v.toLocaleString('en-GB') : String(v)}</span>
            </span>
          ))}
        </dd>
        <Term>Graph version</Term>
        <dd className="font-mono text-[12px] text-ink">v{pack.graph_version}</dd>
        <Term>Dependencies</Term>
        <dd>
          {pack.dependencies.length === 0 ? (
            <span className="text-muted">None</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {pack.dependencies.map((d, i) => (
                <li key={`${d.type}-${d.id}-${i}`} className="flex items-baseline gap-2 text-ink-2">
                  <span className="w-[92px] shrink-0 text-xs text-muted">{d.type.replace('_', ' ')}</span>
                  <DependencyName projectId={projectId} dependency={d} threads={threads} />
                </li>
              ))}
            </ul>
          )}
        </dd>
        <Term>Hash</Term>
        <dd>
          <code data-context-hash className="font-mono text-[12px] break-all text-ink">
            {pack.hash}
          </code>
        </dd>
      </dl>
      <details data-context-content className="group border-t border-line-soft">
        <summary className="cursor-pointer list-none px-5 py-3 text-[13px] font-semibold text-ink-2 hover:text-ink">
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
            What it read
          </span>
        </summary>
        <pre className="max-h-[480px] overflow-auto border-t border-line-soft px-5 py-3 font-mono text-[12px] leading-relaxed text-ink-2">
          {JSON.stringify(pack.content, null, 2)}
        </pre>
      </details>
    </section>
  );
}

const Term = ({ children }: { children: ReactNode }) => <dt className="pt-px text-xs font-semibold text-muted">{children}</dt>;

function DependencyName({
  projectId,
  dependency: d,
  threads,
}: {
  projectId: string;
  dependency: Dependency;
  threads: { id: string; purpose: string }[] | undefined;
}) {
  const version = d.version !== null && d.version !== undefined ? ` v${d.version}` : '';
  if (d.type === 'exploration') {
    const t = threads?.find((x) => x.id === d.id);
    if (t) {
      return (
        <Link
          to="/p/$projectId/threads/$explorationId"
          params={{ projectId, explorationId: t.id }}
          className="min-w-0 truncate text-ink underline-offset-2 hover:underline"
        >
          {t.purpose}
        </Link>
      );
    }
  }
  if (d.code) {
    return (
      <Link
        to="/p/$projectId/records/$code"
        params={{ projectId, code: d.code }}
        className="font-mono text-[12px] text-ink hover:underline"
      >
        {d.code}
        {version}
      </Link>
    );
  }
  return (
    <span className="min-w-0 truncate font-mono text-[12px] text-muted">
      {d.id}
      {version}
    </span>
  );
}

/** The right column: the facts of the run, its retries and its events. */
function RunAside({ projectId, run: r, runs, now }: { projectId: string; run: RunDetail; runs: RunListItem[]; now: number }) {
  const original = r.retry_of ? runs.find((x) => x.id === r.retry_of) : undefined;
  const retries = retriesOf(r.id, runs);
  const events = useQuery(runEventsQuery(projectId, r));
  const usage = r.usage;
  return (
    <>
      <section aria-labelledby="run-facts">
        <SectionTitle>
          <span id="run-facts">Details</span>
        </SectionTitle>
        <dl className="grid grid-cols-[108px_1fr] items-baseline gap-x-3 gap-y-2 text-[13px]">
          <EngineFacts run={r} Fact={Fact} />
          <Fact term="Requested">{dayTime(r.created_at)}</Fact>
          {r.started_at && <Fact term="Started">{dayTime(r.started_at)}</Fact>}
          {r.finished_at && <Fact term="Finished">{dayTime(r.finished_at)}</Fact>}
          <Fact term="Duration">
            <span className="tabular-nums">{runDuration(r, now) || '—'}</span>
          </Fact>
          {usage && <UsageFacts usage={usage} Fact={Fact} />}
        </dl>
      </section>

      {(original || r.retry_of || retries.length > 0) && (
        <section aria-labelledby="run-retries" className="border-t border-line-soft pt-5">
          <SectionTitle>
            <span id="run-retries">Retries</span>
          </SectionTitle>
          {r.retry_of && (
            <div data-run-retry-of className="mb-3 flex flex-col gap-1">
              <span className="text-xs text-muted">Retry of</span>
              <RunLink projectId={projectId} runId={r.retry_of} run={original} />
            </div>
          )}
          {retries.length > 0 && (
            <div data-run-retries className="flex flex-col gap-1">
              <span className="text-xs text-muted">{retries.length === 1 ? 'Retried as' : 'Retried as, in order'}</span>
              <ul className="flex flex-col gap-1">
                {retries.map((x) => (
                  <li key={x.id}>
                    <RunLink projectId={projectId} runId={x.id} run={x} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="run-events" className="border-t border-line-soft pt-5">
        <SectionTitle>
          <span id="run-events">Events</span>
        </SectionTitle>
        {events.isPending ? (
          <div aria-hidden="true" className="flex flex-col gap-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ) : (
          <ol data-run-events className="relative flex flex-col gap-2.5 border-l border-line pl-4">
            {(events.data ?? []).map((e) => (
              <li key={e.id} className="relative flex flex-col gap-0.5 text-[13px]">
                <span
                  aria-hidden="true"
                  className="absolute top-[7px] -left-[19.5px] h-[7px] w-[7px] rounded-full bg-inactive-light"
                />
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-ink">{EVENT_WORDS[e.command] ?? e.command}</span>
                  <WhoMark actor={e.actor} size={14} />
                </span>
                <span className="text-xs text-muted">
                  <time dateTime={e.at}>{new Date(e.at).toLocaleTimeString('en-GB')}</time>
                  <span className="font-mono"> · {e.command}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs font-semibold text-muted">{term}</dt>
      <dd className="min-w-0 text-[13px] text-ink">{children}</dd>
    </>
  );
}

function RunLink({ projectId, runId, run }: { projectId: string; runId: string; run: RunListItem | undefined }) {
  return (
    <Link
      to="/p/$projectId/runs/$runId"
      params={{ projectId, runId }}
      className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-line-soft"
    >
      {run ? <StateMark entity="ai_run" state={run.state} /> : null}
      <span className="font-semibold text-ink">{run ? actionWord(run.action) : 'Run'}</span>
      {run && <span className="text-xs text-muted">{dayTime(run.created_at)}</span>}
      <ChevronRight size={12} className="ml-auto text-muted" />
    </Link>
  );
}

function RunSkeleton() {
  return (
    <Page
      aside={
        <div role="status" aria-label="Loading the details" className="flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      }
    >
      <div role="status" aria-label="Loading the run" className="flex max-w-[860px] flex-col gap-4">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </Page>
  );
}
