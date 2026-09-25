// The Questions of a record (DESIGN.md §3.6, §4.4, INV-BP-13…25): the questions of the thread its
// version comes from, answered in place with the one vocabulary of every screen — Answer, Confirm,
// Change, Park, Drop, Reopen (components/QuestionActions). Open ones first as cards: why it matters,
// its impact and, when DEMIURGO assumed an answer, that answer as the recommended one. Choosing a
// card (its title, or any control in it) makes it the one "If you confirm" talks about, and the
// change is announced. Settled ones are listed below, not hidden, with their answer or reason.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { explorationQuery } from '../../api/queries.ts';
import type { Question, Readiness, RecordVersion } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Tag } from '../../components/Badge.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ArrowRightIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Section } from '../../components/Page.tsx';
import { QuestionActions, QuestionOutcome } from '../../components/QuestionActions.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { EntityState, StateIcon } from '../../components/status.tsx';
import { cn } from '../../lib/cn.ts';
import { stateWord } from '../../words.ts';
import { IMPACT_WORDS, type QuestionGroups, questionGroups, readinessCitation } from './questions.ts';

export type QuestionsState = {
  threadId: string | null;
  purpose: string | null;
  groups: QuestionGroups | null;
  loading: boolean;
  error: unknown;
  retry: () => void;
  selected: Question | undefined;
  select: (q: Question) => void;
};

/** The questions of the version's thread and the one in hand, shared by the list and its aside. */
export function useQuestions(projectId: string, version: RecordVersion): QuestionsState {
  const threadId = version.origin_exploration;
  const thread = useQuery({ ...explorationQuery(projectId, threadId ?? ''), enabled: !!threadId });
  const [chosen, setChosen] = useState<string | null>(null);
  const groups = thread.data ? questionGroups(thread.data.questions) : null;
  const selected = groups?.open.find((q) => q.id === chosen) ?? groups?.open[0];
  return {
    threadId,
    purpose: thread.data?.purpose ?? null,
    groups,
    loading: !!threadId && !thread.data && !thread.error,
    error: thread.error,
    retry: () => void thread.refetch(),
    selected,
    select: (q) => {
      if (q.id === selected?.id) return;
      setChosen(q.id);
      announce(`If you confirm now shows: ${q.question}`);
    },
  };
}

function ThreadLink({ projectId, threadId, children }: { projectId: string; threadId: string; children: string }) {
  return (
    <Link
      to="/p/$projectId/threads/$explorationId"
      params={{ projectId, explorationId: threadId }}
      className="inline-flex items-center gap-1 self-start text-sm font-medium text-accent-text hover:underline"
    >
      {children} <ArrowRightIcon size={12} />
    </Link>
  );
}

function OpenQuestion({
  projectId,
  q,
  selected,
  onSelect,
}: {
  projectId: string;
  q: Question;
  selected: boolean;
  onSelect: () => void;
}) {
  const id = useId();
  const assumed = q.state === 'inferred' && !!q.conclusion;
  return (
    <article
      aria-labelledby={id}
      data-question={q.id}
      data-state={q.state}
      data-selected={selected ? 'true' : undefined}
      // Whatever the person acts on becomes the question in hand: a click anywhere in the card, or
      // the keyboard's focus. A mouse focus doesn't select on its own, so nothing moves between
      // pressing a button and releasing it.
      onClickCapture={onSelect}
      onFocusCapture={(e) => {
        if (e.target instanceof HTMLElement && e.target.matches(':focus-visible')) onSelect();
      }}
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-panel p-4 transition-colors duration-[var(--m-fast)]',
        selected ? 'border-accent-edge ring-1 ring-accent-edge' : 'border-edge',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <EntityState entity="question" state={q.state} />
        {selected ? <span className="text-xs text-accent-text">In "If you confirm"</span> : null}
      </div>
      <h2 id={id} className="text-md leading-snug font-semibold text-fg">
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className="w-full cursor-pointer rounded-xs text-left hover:text-accent-text"
        >
          {q.question}
        </button>
      </h2>
      {q.reason || q.impact ? (
        <div className="flex flex-col gap-0.5 text-sm text-fg-2">
          {q.reason ? <p>Why it matters: {q.reason}</p> : null}
          {q.impact ? <p>Impact: {IMPACT_WORDS[q.impact] ?? q.impact}</p> : null}
        </div>
      ) : null}
      {assumed ? (
        <div data-recommended className="flex flex-col gap-1 rounded-md border border-accent-edge bg-accent-soft px-3 py-2.5">
          <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
            {q.conclusion}
            <Tag>Recommended</Tag>
          </p>
          {q.reasoning ? <p className="text-sm text-fg-2">Why: {q.reasoning}</p> : null}
          <p className="text-xs text-fg-2">DEMIURGO assumed it. Nothing is confirmed until you say so.</p>
        </div>
      ) : null}
      <QuestionActions projectId={projectId} question={q} size="sm" />
      <ThreadLink projectId={projectId} threadId={q.exploration_id}>
        Talk about it in the thread
      </ThreadLink>
    </article>
  );
}

function SettledRow({ projectId, q }: { projectId: string; q: Question }) {
  return (
    <li data-question={q.id} data-state={q.state} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <EntityState entity="question" state={q.state} />
          <span className="text-base text-fg">{q.question}</span>
        </div>
        <QuestionOutcome question={q} />
      </div>
      <QuestionActions projectId={projectId} question={q} size="sm" className="shrink-0" />
    </li>
  );
}

const SETTLED = [
  { key: 'answered', title: 'Answered', attr: 'answered' },
  { key: 'notNow', title: 'Parked', attr: 'parked' },
  { key: 'doesNotApply', title: 'Dropped', attr: 'dropped' },
] as const;

export function QuestionsList({ projectId, questions }: { projectId: string; questions: QuestionsState }) {
  const { threadId, groups } = questions;
  if (!threadId) {
    return <EmptyState title="No questions">This version doesn't come from a thread, so it has no questions.</EmptyState>;
  }
  if (questions.error) return <ErrorNotice error={questions.error} onRetry={questions.retry} />;
  if (!groups) {
    return (
      <Skeleton label="Loading the questions" className="flex flex-col gap-3">
        <Bone className="h-36 w-full rounded-lg" />
        <Bone className="h-36 w-full rounded-lg" />
      </Skeleton>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {groups.open.length === 0 ? (
        <EmptyState title="No open questions">Nothing to answer here: no question of its thread is open.</EmptyState>
      ) : (
        <div data-open-questions className="flex flex-col gap-4">
          {groups.open.map((q) => (
            <OpenQuestion
              key={q.id}
              projectId={projectId}
              q={q}
              selected={q.id === questions.selected?.id}
              onSelect={() => questions.select(q)}
            />
          ))}
        </div>
      )}
      {SETTLED.map((g) => {
        const list = groups[g.key];
        if (list.length === 0) return null;
        return (
          <Section
            key={g.key}
            id={`questions-${g.attr}`}
            title={
              <span data-group-title={g.attr}>
                {g.title} · {list.length}
              </span>
            }
          >
            <ul data-group={g.attr} className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge bg-panel">
              {list.map((q) => (
                <SettledRow key={q.id} projectId={projectId} q={q} />
              ))}
            </ul>
          </Section>
        );
      })}
      <ThreadLink projectId={projectId} threadId={threadId}>
        {`Open the thread: ${questions.purpose ?? ''}`}
      </ThreadLink>
    </div>
  );
}

/** "If you confirm" (INV-BP-22): only what H1 knows and does when the person confirms the question in hand. */
export function IfYouConfirm({
  question: q,
  version,
  readiness,
}: {
  question: Question;
  version: RecordVersion;
  readiness: Readiness | null;
}) {
  const id = useId();
  const citation = readinessCitation(q, readiness);
  const checkMark = stateWord('record_version', version.state).mark;
  return (
    <section aria-labelledby={id} data-if-you-confirm className="flex flex-col gap-3 rounded-lg border border-edge bg-sunken p-4">
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="text-base font-semibold text-fg">
          If you confirm
        </h2>
        <p className="text-sm text-fg-2">{q.question}</p>
      </div>
      <dl className="flex flex-col gap-2.5 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-fg-2">It becomes the confirmed answer in its thread</dt>
          <dd className="text-fg">
            {q.state === 'inferred' && q.conclusion ? (
              <span className="flex items-start gap-1.5">
                <StateIcon kind="confirmed" className="mt-0.5" />
                {q.conclusion}
              </span>
            ) : (
              <span className="text-fg-2">The answer you write.</span>
            )}
          </dd>
        </div>
        {q.impact ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-fg-2">It affects</dt>
            <dd className="text-fg">{IMPACT_WORDS[q.impact] ?? q.impact} impact</dd>
          </div>
        ) : null}
        {citation ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-fg-2">Before it can be built</dt>
            <dd className="flex flex-col gap-0.5 text-fg">
              <span>{citation.text}</span>
              {citation.reason ? <span className="text-fg-2">{citation.reason}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-col gap-1.5 border-t border-edge pt-3">
        <h3 className="text-sm font-semibold text-fg">How we'll know it works</h3>
        {version.criteria.length === 0 ? (
          <p className="text-sm text-fg-2">This version has no checks yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {version.criteria.map((c) => (
              <li key={c.id} data-aside-check className="flex items-start gap-2 text-sm text-fg">
                <StateIcon kind={checkMark} className="mt-0.5" />
                {c.title}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p data-later className="rounded-md border border-dashed border-edge-strong px-3 py-2 text-xs text-fg-2">
        <span className="font-medium text-fg">Later</span> · Becomes a decision and adds checks on its own (later increment).
        Today confirming only answers the question.
      </p>
    </section>
  );
}
