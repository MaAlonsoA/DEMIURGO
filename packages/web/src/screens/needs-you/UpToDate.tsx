// "You're up to date" (DESIGN.md §3.1): when nothing needs the person — Needs you empty, or the end
// of Catch up. Built from the event journal in Endsley's three levels (R63, R64): what happened
// today (the person's own events, each line a link to what it touched), where the product is
// (Ready to build x of n), and what is still happening (runs in progress). It ends saying DEMIURGO
// can be closed. DEMIURGO speaks in the third person here too (INVENTORY Part D §1b, UX problem).

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { changesQuery, runsQuery, stateQuery } from '../../api/queries.ts';
import type { ProductRow, RunListItem } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { buttonClass } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { ArrowRightIcon, CheckCircleIcon } from '../../components/icons.tsx';
import { SegmentedBar } from '../../components/Meter.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, WithAside } from '../../components/Page.tsx';
import { RunStateBadge } from '../../components/runState.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { StateIcon } from '../../components/status.tsx';
import { Elapsed, useNow } from '../../components/Time.tsx';
import { WhoAvatar } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { ACTION_WORDS, PRODUCT_WORDS, whoOf } from '../../words.ts';
import type { LensLine } from '../overview/lens/lines.ts';
import { todayLines } from './today.ts';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const WORKING = new Set(['queued', 'running']);

/** Where the product is: features ready to build, in progress (drafting or worked on) and the rest. */
export function productProgress(rows: readonly ProductRow[], runs: readonly RunListItem[]) {
  const features = rows.filter((r) => r.type === 'fdr');
  const working = runs.filter((r) => WORKING.has(r.state));
  const drafting = working.filter((r) => r.action === 'design_proposal').length;
  const ready = features.filter((f) => f.readiness?.ready).length;
  const busy = features.filter(
    (f) => !f.readiness?.ready && f.origin_exploration && working.some((r) => r.exploration_id === f.origin_exploration),
  ).length;
  return { total: features.length, ready, inProgress: busy + drafting, rest: Math.max(0, features.length - ready - busy) };
}

/** Where a line of the journal leads: the record, the thread, the batch or the knowledge it tells. */
function LineLink({ projectId, line, children }: { projectId: string; line: LensLine; children: React.ReactNode }) {
  const className = 'rounded-xs text-fg hover:underline underline-offset-2';
  if (line.kind === 'record')
    return (
      <Link to="/p/$projectId/records/$code" params={{ projectId, code: line.key }} className={className}>
        {children}
      </Link>
    );
  if (line.kind === 'exploration')
    return (
      <Link to="/p/$projectId/threads/$explorationId" params={{ projectId, explorationId: line.key }} className={className}>
        {children}
      </Link>
    );
  if (line.kind === 'batch')
    return (
      <Link to="/p/$projectId/batches/$batchId" params={{ projectId, batchId: line.key }} className={className}>
        {children}
      </Link>
    );
  if (line.kind === 'knowledge')
    return (
      <Link to="/p/$projectId/knowledge" params={{ projectId }} className={className}>
        {children}
      </Link>
    );
  return (
    <Link to="/p/$projectId" params={{ projectId }} className={className}>
      {children}
    </Link>
  );
}

export function UpToDate({ projectId }: { projectId: string }) {
  const state = useQuery(stateQuery(projectId));
  const changes = useQuery({ ...changesQuery(projectId, '0'), staleTime: 0 });
  const runs = useQuery(runsQuery(projectId));
  const all = runs.data ?? [];
  const working = all.filter((r) => WORKING.has(r.state));
  const now = useNow();
  const rows = [...(state.data?.designs ?? []), ...(state.data?.decisions ?? [])];
  const records: Record<string, { title: string; checks: number }> = {};
  for (const r of rows) records[r.code] = { title: r.title, checks: r.checks };
  const lines = changes.data ? todayLines(changes.data, new Date(now), { records }) : null;
  const threads = new Map((state.data?.explorations ?? []).map((e) => [e.id, e.purpose]));
  const today = new Date(now);
  const n = lines?.length ?? 0;
  const todayId = useId();
  const productId = useId();
  const progress = productProgress(rows, all);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="tabular-nums">
            {today.toLocaleDateString('en-GB', { weekday: 'long' })} · {time(today.toISOString())}
          </span>
        }
        title="You're up to date"
        meta={
          lines === null ? null : (
            <span>
              {n === 0 ? 'Nothing done yet today.' : `${n} ${n === 1 ? 'thing' : 'things'} done today.`} Nothing waits for you.
            </span>
          )
        }
      />
      <PageBody>
        <WithAside
          asideLabel="Still happening"
          aside={
            <>
              <InProgress
                projectId={projectId}
                runs={working}
                threads={threads}
                error={runs.error}
                onRetry={() => void runs.refetch()}
              />
              <Card padding="md" className="flex flex-col gap-1.5 bg-sunken" data-close>
                <p className="flex items-center gap-2 font-medium text-fg">
                  <CheckCircleIcon size={16} className="text-success-text" />
                  {PRODUCT_WORDS.nothingNeedsYou}
                </p>
                <p className="text-sm text-fg-2">
                  Everything is saved. When you come back, DEMIURGO shows you what changed while you were away.
                </p>
              </Card>
            </>
          }
        >
          <div className="flex max-w-3xl flex-col gap-8">
            <section aria-labelledby={todayId} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id={todayId} className="text-lg font-semibold text-fg">
                  Today
                  {lines?.[0] ? <span className="font-normal text-fg-2"> · since {time(lines[0].at)}</span> : null}
                </h2>
                <Link
                  to="/p/$projectId/activity"
                  params={{ projectId }}
                  className="text-sm font-medium text-accent-text hover:underline"
                >
                  Show everything
                </Link>
              </div>
              {changes.error ? (
                <ErrorNotice error={changes.error} onRetry={() => void changes.refetch()} focus={false} />
              ) : lines === null ? (
                <Skeleton label="Loading what you did today" className="flex flex-col gap-2">
                  <Bone className="h-4 w-3/4" />
                  <Bone className="h-4 w-2/3" />
                </Skeleton>
              ) : lines.length === 0 ? (
                <p className="rounded-lg border border-dashed border-edge-strong px-4 py-3 text-fg-2">
                  Nothing yet today. What you do here is kept and shown next time.
                </p>
              ) : (
                <ol className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge">
                  {lines.map((l) => (
                    <li key={l.id} className="flex items-start gap-3 px-4 py-2.5" data-line={l.id}>
                      <time dateTime={l.at} className="w-11 shrink-0 pt-0.5 text-sm text-fg-2 tabular-nums">
                        {time(l.at)}
                      </time>
                      <WhoAvatar kind={whoOf(l.actor).kind} size={18} className="mt-0.5" />
                      <p className="min-w-0 flex-1 text-base text-fg-2">
                        <LineLink projectId={projectId} line={l}>
                          {l.segments.map((s, i) =>
                            typeof s === 'string' ? (
                              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                              <span key={i}>{s}</span>
                            ) : (
                              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                              <strong key={i} className="font-semibold text-fg">
                                {s.strong}
                              </strong>
                            ),
                          )}
                        </LineLink>
                      </p>
                      {l.problem || l.codes.length > 0 ? (
                        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                          {l.problem ? (
                            <span className="inline-flex items-center gap-1 text-xs text-danger-text">
                              <StateIcon kind="conflict" size={13} />A problem
                            </span>
                          ) : null}
                          {l.codes.map((c) => (
                            <Code key={c}>{c}</Code>
                          ))}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {state.data ? (
              <section aria-labelledby={productId} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 id={productId} className="text-lg font-semibold text-fg">
                    The product · {state.data.project.name}
                  </h2>
                  <Link
                    to="/p/$projectId"
                    params={{ projectId }}
                    className={cn(buttonClass({ variant: 'secondary', size: 'sm' }))}
                  >
                    See the product <ArrowRightIcon size={13} />
                  </Link>
                </div>
                <p className="text-base text-fg" data-progress-line>
                  {progress.total === 0 ? (
                    'No features yet.'
                  ) : (
                    <>
                      {PRODUCT_WORDS.readyToBuild}: <span className="font-semibold tabular-nums">{progress.ready}</span> of{' '}
                      <span className="tabular-nums">{progress.total}</span> {progress.total === 1 ? 'feature' : 'features'}
                      {progress.inProgress > 0 ? ` · ${progress.inProgress} in progress` : ''}
                    </>
                  )}
                </p>
                <SegmentedBar
                  total={progress.total}
                  segments={[
                    { key: 'ready', value: progress.ready, tone: 'success', label: 'ready to build' },
                    { key: 'working', value: Math.min(progress.inProgress, progress.rest), tone: 'info', label: 'in progress' },
                    {
                      key: 'rest',
                      value: Math.max(0, progress.rest - progress.inProgress),
                      tone: 'neutral',
                      label: 'not ready yet',
                    },
                  ]}
                />
              </section>
            ) : state.error ? (
              <ErrorNotice error={state.error} onRetry={() => void state.refetch()} focus={false} />
            ) : null}
          </div>
        </WithAside>
      </PageBody>
    </>
  );
}

/** What DEMIURGO is still doing: runs queued or working, each with its live state and a link. */
function InProgress({
  projectId,
  runs,
  threads,
  error,
  onRetry,
}: {
  projectId: string;
  runs: RunListItem[];
  threads: Map<string, string>;
  error: unknown;
  onRetry: () => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-base font-semibold text-fg">
        In progress
      </h2>
      {error ? (
        <ErrorNotice error={error} onRetry={onRetry} focus={false} compact />
      ) : runs.length === 0 ? (
        <p className="text-sm text-fg-2">Nothing. DEMIURGO is waiting for you.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 rounded-lg border border-edge px-3 py-2.5" data-run={r.id}>
              <span className="flex flex-wrap items-center gap-2">
                <RunStateBadge run={r} />
                <span className="text-sm font-medium text-fg">
                  {r.action === 'design_proposal'
                    ? 'Drafting a feature'
                    : r.action === 'exploration_chat'
                      ? 'Answering'
                      : (ACTION_WORDS[r.action] ?? r.action)}
                </span>
                <Elapsed start={r.started_at ?? r.created_at} className="ml-auto text-xs text-fg-2" />
              </span>
              <span className="text-sm text-fg-2">
                {r.exploration_id ? (threads.get(r.exploration_id) ?? 'its thread') : 'The product'}
              </span>
              <Link
                to="/p/$projectId/runs/$runId"
                params={{ projectId, runId: r.id }}
                className={cn(
                  'inline-flex min-h-6 w-fit items-center gap-1 text-sm font-medium text-accent-text hover:underline',
                )}
              >
                Open the run <ArrowRightIcon size={13} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
