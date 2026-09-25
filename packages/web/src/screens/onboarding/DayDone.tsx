// Your starting point (canvas S4E, adapted to H1): the day in numbers (1 idea → questions answered
// → decisions proposed), what DEMIURGO understood and the person's answers; on the right, what
// needs the person (each decision DEMIURGO proposed, accepted on its batch page), what's next
// (Draft it, in the thread) and "You can close DEMIURGO".

import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';
import { ApiError } from '../../api/client.ts';
import { batchQuery, stateQuery } from '../../api/queries.ts';
import type { Question } from '../../api/types.ts';
import { useRouteParams } from '../../lib/hooks.ts';
import { buttonClass } from '../../ui/Button.tsx';
import { ArrowRight, ChevronRight } from '../../ui/icons.tsx';
import { Mark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { NeedsBubble } from '../../ui/signals.tsx';
import { stateWord } from '../../words.ts';
import { TaxonomyHint } from '../knowledge/TaxonomyHint.tsx';
import { NotFound } from '../not-found/NotFound.tsx';
import { daySummary, understandingOf, writtenBy } from './day.ts';
import { useDay } from './hooks.ts';
import { AnswerRow, DayFrame, DaySkeleton, Eyebrow, Later, ObservationRow } from './parts.tsx';

export function DayDoneScreen() {
  const { projectId, explorationId = '' } = useRouteParams();
  const day = useDay(projectId, explorationId);
  const products = useQuery(stateQuery(projectId)).data;
  const batchIds = [...new Set((day.runs ?? []).flatMap((r) => (r.batch_id ? [r.batch_id] : [])))];
  const batches = useQueries({ queries: batchIds.map((id) => batchQuery(projectId, id)) });

  if (day.error instanceof ApiError && day.error.status === 404) {
    return <NotFound thing="this day">It may belong to another project.</NotFound>;
  }
  const thread = day.thread;
  if (!thread || !day.runs || batches.some((b) => b.isPending)) {
    return day.error ? (
      <main id="main" className="mx-auto max-w-[760px] px-6 pt-14">
        <Reasons error={day.error} />
      </main>
    ) : (
      <DaySkeleton label="Loading your starting point" />
    );
  }

  const loaded = batches.flatMap((b) => (b.data ? [b.data] : []));
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
  const firstWaiting = s.waiting[0];
  const minutes = `${s.minutes} ${s.minutes === 1 ? 'minute' : 'minutes'}`;
  const toThread = { to: '/p/$projectId/threads/$explorationId' as const, params: { projectId, explorationId } };

  return (
    <DayFrame
      asideLabel="What happens now"
      aside={
        <>
          <section className="flex flex-col gap-2">
            <h2 className="dm-text-heading flex items-center gap-2 font-semibold">
              Needs you
              <NeedsBubble count={needs} />
            </h2>
            {s.waiting.map((w) => (
              <Link
                key={w.proposalId}
                to="/p/$projectId/batches/$batchId"
                params={{ projectId, batchId: w.batchId }}
                data-waiting-decision={w.proposalId}
                className="flex flex-col gap-0.5 rounded-card-md border border-transparent bg-needs-soft px-3.5 py-3 text-ink hover:border-needs-ring focus-visible:border-needs"
              >
                <span className="dm-label flex items-center gap-1.5">
                  <Mark kind="proposed" size={9} label="Proposed" />
                  Decision
                </span>
                <strong className="dm-text-body line-clamp-2 leading-snug font-semibold">{w.title}</strong>
                <span className="dm-text-caption text-ink-3">DEMIURGO proposes it. Accept, change or reject it.</span>
              </Link>
            ))}
            {s.open.map((q) => (
              <QuestionLink key={q.id} question={q} {...toThread} />
            ))}
            {needs === 0 && <p className="dm-text-small text-ink-2">Nothing from today waits for you.</p>}
          </section>

          <section data-whats-next className="flex flex-col gap-2">
            <h2 className="dm-text-caption font-semibold text-muted">What&apos;s next</h2>
            {approved.length > 0 ? (
              approved.map((r) => (
                <p key={r.code} className="dm-text-small text-ink">
                  <span className="font-semibold">Draft it:</span> DEMIURGO drafts a feature with its checks from “{r.title}”.
                </p>
              ))
            ) : (
              <p className="dm-text-small text-ink">
                Accept and approve a decision, then <span className="font-semibold">Draft it</span>: DEMIURGO drafts a feature
                with its checks from it.
              </p>
            )}
            <p className="dm-text-caption text-muted">
              Draft it lives in the thread.{' '}
              <Link {...toThread} className="font-semibold text-needs hover:text-needs-strong">
                Open the thread
              </Link>
            </p>
          </section>

          {s.parked.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="dm-text-caption font-semibold text-muted">Parked for later</h2>
              {s.parked.map((q) => (
                <QuestionLink key={q.id} question={q} {...toThread} />
              ))}
            </section>
          )}

          <TaxonomyHint projectId={projectId} />

          <div className="mt-auto flex flex-col gap-1.5 rounded-card-md bg-surface-soft px-4 py-3.5">
            <strong className="dm-text-small font-semibold">You can close DEMIURGO</strong>
            <span className="dm-text-small text-ink-3">
              Everything is saved. When you come back, I&apos;ll show you what changed while you were away.
            </span>
          </div>
        </>
      }
    >
      <section className="dm-panel flex-row items-center justify-between gap-8 px-[26px] py-[22px]">
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="dm-text-caption font-semibold text-muted">
              {s.day} · {minutes}
            </span>
            <h1 className="dm-text-page-title">Your starting point is ready</h1>
          </div>
          <div data-day-numbers className="flex items-center gap-6">
            <Figure n={1} label="idea" />
            <Arrow />
            <Figure n={s.answered} label={s.answered === 1 ? 'question answered' : 'questions answered'} />
            <Arrow />
            <Figure n={s.proposed} label={s.proposed === 1 ? 'decision proposed' : 'decisions proposed'} />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {firstWaiting && (
            <Link
              to="/p/$projectId/batches/$batchId"
              params={{ projectId, batchId: firstWaiting.batchId }}
              className={buttonClass('primary')}
            >
              Review the decisions
            </Link>
          )}
          <Link to="/p/$projectId" params={{ projectId }} className={buttonClass('secondary')}>
            Go to the product
          </Link>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-6">
        <Column title="What I understood">
          {understanding ? <Observations messages={thread.messages} runId={understanding.id} /> : null}
        </Column>
        <Column title="Your answers">
          {s.answered > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {thread.questions
                .filter((q) => q.state === 'confirmed')
                .map((q) => (
                  <AnswerRow key={q.id} question={q} />
                ))}
            </ul>
          ) : (
            <p className="dm-text-small text-muted">No answers yet. The questions wait in the thread.</p>
          )}
        </Column>
      </div>

      <Later id="features" title="What it must do">
        DEMIURGO will split your idea into features (S6). For now, a feature is drafted from a decision you approve, in the
        thread.
      </Later>
    </DayFrame>
  );
}

function Figure({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex flex-col">
      <strong className="dm-text-page-title tabular-nums">{n}</strong>
      <span className="dm-text-caption text-ink-3">{label}</span>
    </span>
  );
}

function Arrow() {
  return <ArrowRight size={18} className="shrink-0 text-inactive" />;
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <Eyebrow id={id}>{title}</Eyebrow>
      {children}
    </section>
  );
}

function Observations({ messages, runId }: { messages: Parameters<typeof writtenBy>[0]; runId: string }) {
  const { observations } = writtenBy(messages, runId);
  if (observations.length === 0) return <p className="dm-text-small text-muted">Nothing noted.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {observations.map((o) => (
        <ObservationRow key={o.id} observation={o} compact />
      ))}
    </ul>
  );
}

/** A question that still waits (open, assumed or parked): it is resolved in the thread. */
function QuestionLink({
  question: q,
  to,
  params,
}: {
  question: Question;
  to: '/p/$projectId/threads/$explorationId';
  params: { projectId: string; explorationId: string };
}) {
  const w = stateWord('question', q.state);
  return (
    <Link
      to={to}
      params={params}
      data-waiting-question={q.id}
      className="dm-text-small flex items-start gap-2.5 rounded-control px-1 py-1 text-ink hover:bg-line-soft"
    >
      <span className="mt-[5px] flex shrink-0">
        <Mark kind={w.mark} label={w.word} />
      </span>
      <span className="min-w-0 flex-1">
        {q.question}
        {q.state === 'inferred' && q.conclusion && (
          <span className="dm-text-caption line-clamp-2 text-ink-3">Assumed: {q.conclusion}</span>
        )}
      </span>
      <ChevronRight size={12} className="mt-1 shrink-0 text-muted" />
    </Link>
  );
}
