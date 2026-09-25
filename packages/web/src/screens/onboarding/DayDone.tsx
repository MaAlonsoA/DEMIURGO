// Your starting point (DESIGN.md §1 J5, §3.9): the day in numbers (1 idea → questions answered →
// decisions proposed), what DEMIURGO understood and the person's answers; on the side, what needs
// the person (each decision DEMIURGO proposed, decided on its batch page, and the questions that
// still wait), what's next (Draft it, in the thread) and "You can close DEMIURGO". A batch that
// can't load says so with Retry instead of silently dropping its decisions from the counts.

import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { batchQuery, stateQuery } from '../../api/queries.ts';
import type { Question } from '../../api/types.ts';
import { buttonClass } from '../../components/Button.tsx';
import { Count } from '../../components/Badge.tsx';
import { isNotFound } from '../../components/explain.ts';
import { ArrowRightIcon, ChevronRightIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, WithAside, usePageTitle } from '../../components/Page.tsx';
import { EntityState, StatusBadge } from '../../components/status.tsx';
import { useRouteParams } from '../../lib/hooks.ts';
import { NotFound } from '../not-found/NotFound.tsx';
import { daySummary, reviewTarget, understandingOf, writtenBy } from './day.ts';
import { useDay } from './hooks.ts';
import { AnswerRow, AsideHeading, DayError, DaySkeleton, LaterFeatures, ObservationList, TaxonomyNote } from './parts.tsx';

export function DayDoneScreen() {
  const { projectId, explorationId = '' } = useRouteParams();
  const day = useDay(projectId, explorationId);
  usePageTitle(['Your starting point', day.project?.name]);
  const products = useQuery(stateQuery(projectId)).data;
  const batchIds = [...new Set((day.runs ?? []).flatMap((r) => (r.batch_id ? [r.batch_id] : [])))];
  const batches = useQueries({ queries: batchIds.map((id) => batchQuery(projectId, id)) });

  if (isNotFound(day.error)) return <NotFound thing="this day">It may belong to another project.</NotFound>;
  const thread = day.thread;
  if (!thread || !day.runs || batches.some((b) => b.isPending)) {
    return day.error ? (
      <DayError title="Your starting point" error={day.error} onRetry={day.retry} />
    ) : (
      <DaySkeleton label="Loading your starting point" />
    );
  }

  const loaded = batches.flatMap((b) => (b.data ? [b.data] : []));
  const failed = batches.filter((b) => b.error);
  const s = daySummary({
    openedAt: thread.created_at,
    messages: thread.messages,
    questions: thread.questions,
    runs: day.runs,
    batches: loaded,
    now: day.now,
  });
  const understanding = understandingOf(thread.messages, day.runs);
  const approved = (products?.decisions ?? []).filter((r) => r.origin_exploration === explorationId && r.current_id);
  const needs = s.waiting.length + s.open.length;
  const review = reviewTarget(s.waiting);
  const minutes = `${s.minutes} ${s.minutes === 1 ? 'minute' : 'minutes'}`;
  const toThread = { to: '/p/$projectId/threads/$explorationId' as const, params: { projectId, explorationId } };
  const confirmed = thread.questions.filter((q) => q.state === 'confirmed');

  return (
    <>
      <PageHeader
        eyebrow={
          <span>
            {s.day} · {minutes}
          </span>
        }
        title="Your starting point is ready"
        titleSize="2xl"
        actions={
          <>
            {review === 'needs-you' ? (
              <Link to="/p/$projectId/needs-you" params={{ projectId }} className={buttonClass({ variant: 'primary' })}>
                Review the decisions
                <ArrowRightIcon size={15} />
              </Link>
            ) : review ? (
              <Link
                to="/p/$projectId/batches/$batchId"
                params={{ projectId, batchId: review.batchId }}
                className={buttonClass({ variant: 'primary' })}
              >
                Review the decisions
                <ArrowRightIcon size={15} />
              </Link>
            ) : null}
            <Link
              to="/p/$projectId"
              params={{ projectId }}
              className={buttonClass({ variant: review ? 'secondary' : 'primary' })}
            >
              Go to the product
            </Link>
          </>
        }
      >
        <ol data-day-numbers aria-label="The day in numbers" className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-3">
          <Figure n={1} label="idea" />
          <Figure n={s.answered} label={s.answered === 1 ? 'question answered' : 'questions answered'} arrow />
          <Figure n={s.proposed} label={s.proposed === 1 ? 'decision proposed' : 'decisions proposed'} arrow />
        </ol>
      </PageHeader>
      <PageBody>
        <WithAside
          asideLabel="What happens now"
          asideWidth="lg"
          aside={
            <>
              <NeedsYou projectId={projectId} explorationId={explorationId} summary={s} needs={needs} />
              <section data-whats-next aria-labelledby="whats-next" className="flex flex-col gap-2">
                <AsideHeading id="whats-next">What&apos;s next</AsideHeading>
                {approved.length > 0 ? (
                  approved.map((r) => (
                    <p key={r.code} className="text-sm text-fg">
                      <span className="font-semibold">Draft it:</span> DEMIURGO drafts a feature with its checks from “{r.title}”.
                    </p>
                  ))
                ) : (
                  <p className="text-sm text-fg">
                    Accept and approve a decision, then <span className="font-semibold">Draft it</span>: DEMIURGO drafts a feature
                    with its checks from it.
                  </p>
                )}
                <p className="text-sm text-fg-2">
                  Draft it lives in the thread.{' '}
                  <Link {...toThread} className="font-medium text-accent-text hover:underline">
                    Open the thread
                  </Link>
                </p>
              </section>
              {s.parked.length > 0 ? (
                <section aria-labelledby="parked" className="flex flex-col gap-1.5">
                  <AsideHeading id="parked">Parked for later</AsideHeading>
                  <ul className="flex flex-col gap-0.5">
                    {s.parked.map((q) => (
                      <QuestionLink key={q.id} question={q} projectId={projectId} explorationId={explorationId} />
                    ))}
                  </ul>
                </section>
              ) : null}
              <TaxonomyNote projectId={projectId} />
              <div className="flex flex-col gap-1 rounded-lg border border-success-edge bg-success-soft px-4 py-3.5">
                <p className="text-base font-semibold text-fg">You can close DEMIURGO</p>
                <p className="text-sm text-fg-2">
                  Everything is saved. When you come back, I&apos;ll show you what changed while you were away.
                </p>
              </div>
            </>
          }
        >
          <div className="flex flex-col gap-10">
            {failed.length > 0 ? (
              <ErrorNotice
                error={failed[0]?.error}
                focus={false}
                onRetry={() => {
                  for (const b of failed) void b.refetch();
                }}
              />
            ) : null}
            <div className="grid gap-8 lg:grid-cols-2">
              <Section id="day-understood" title="What I understood">
                {understanding ? (
                  <Observations messages={thread.messages} runId={understanding.id} />
                ) : (
                  <p className="text-base text-fg-2">Nothing noted.</p>
                )}
              </Section>
              <Section id="day-answers" title="Your answers">
                {confirmed.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {confirmed.map((q) => (
                      <AnswerRow key={q.id} question={q} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-base text-fg-2">No answers yet. The questions wait in the thread.</p>
                )}
              </Section>
            </div>
            <LaterFeatures />
          </div>
        </WithAside>
      </PageBody>
    </>
  );
}

function NeedsYou({
  projectId,
  explorationId,
  summary: s,
  needs,
}: {
  projectId: string;
  explorationId: string;
  summary: ReturnType<typeof daySummary>;
  needs: number;
}) {
  return (
    <section aria-labelledby="day-needs" className="flex flex-col gap-2.5">
      <h2 id="day-needs" className="flex items-center gap-2 text-lg font-semibold text-fg">
        Needs you
        <Count n={needs} label={`${needs} ${needs === 1 ? 'thing waits' : 'things wait'} for you`} />
      </h2>
      {s.waiting.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {s.waiting.map((w) => (
            <li key={w.proposalId}>
              <Link
                to="/p/$projectId/batches/$batchId"
                params={{ projectId, batchId: w.batchId }}
                data-waiting-decision={w.proposalId}
                className="group flex flex-col gap-1.5 rounded-lg border border-accent-edge bg-accent-soft px-3.5 py-3 hover:border-accent"
              >
                <span className="flex items-center gap-2 text-sm text-fg-2">
                  <StatusBadge kind="proposed" />
                  Decision
                </span>
                <span className="line-clamp-3 text-base font-semibold break-words text-fg group-hover:underline">{w.title}</span>
                <span className="text-sm text-fg-2">DEMIURGO proposes it. Accept, change or reject it.</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {s.open.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {s.open.map((q) => (
            <QuestionLink key={q.id} question={q} projectId={projectId} explorationId={explorationId} />
          ))}
        </ul>
      ) : null}
      {needs === 0 ? <p className="text-sm text-fg-2">Nothing from today waits for you.</p> : null}
    </section>
  );
}

/** One figure of the day: the number, then what it counts ("1 idea"); an arrow leads from the one before. */
function Figure({ n, label, arrow }: { n: number; label: string; arrow?: boolean }) {
  return (
    <li className="flex items-center gap-4">
      {arrow ? <ArrowRightIcon size={18} className="shrink-0 text-fg-3" /> : null}
      <span className="flex flex-col">
        <strong className="text-2xl font-semibold text-fg tabular-nums">{n}</strong>
        <span className="text-sm text-fg-2">{label}</span>
      </span>
    </li>
  );
}

function Observations({ messages, runId }: { messages: Parameters<typeof writtenBy>[0]; runId: string }) {
  const { observations } = writtenBy(messages, runId);
  if (observations.length === 0) return <p className="text-base text-fg-2">Nothing noted.</p>;
  return <ObservationList observations={observations} compact />;
}

/** A question that still waits (open, assumed or parked): it is settled in its thread. */
function QuestionLink({
  question: q,
  projectId,
  explorationId,
}: {
  question: Question;
  projectId: string;
  explorationId: string;
}) {
  return (
    <li>
      <Link
        to="/p/$projectId/threads/$explorationId"
        params={{ projectId, explorationId: q.exploration_id || explorationId }}
        data-waiting-question={q.id}
        className="group flex items-start gap-2.5 rounded-md px-2 py-1.5 -outline-offset-2 hover:bg-hover"
      >
        <EntityState entity="question" state={q.state} className="mt-px" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm break-words text-fg group-hover:underline">{q.question}</span>
          {q.state === 'inferred' && q.conclusion ? (
            <span className="line-clamp-2 text-xs text-fg-2">Assumed: {q.conclusion}</span>
          ) : null}
        </span>
        <ChevronRightIcon size={14} className="mt-0.5 shrink-0 text-fg-3" />
      </Link>
    </li>
  );
}
