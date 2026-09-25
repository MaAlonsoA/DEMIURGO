// Day 1 once the idea is written (DESIGN.md §1 J5, §3.9). First DEMIURGO reads it live; then
// "What I understood": its reading, all proposed; its questions, answered in the thread; what it
// proposed, each with its real state (a rejected or out-of-date proposal never shows as accepted);
// and a quiet "Later" for what H1 cannot give yet (S6). The person can correct something and
// DEMIURGO reads it again. One primary action per view, and the focus moves to the new title when
// "See what I understood" swaps the view.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { batchQuery, stagesQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Message, Question, RunListItem } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Tag } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { isNotFound } from '../../components/explain.ts';
import { Field, TextArea } from '../../components/Field.tsx';
import { ArrowRightIcon, ChevronRightIcon, MinusCircleIcon, PencilIcon, SendIcon } from '../../components/icons.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, WithAside, usePageTitle } from '../../components/Page.tsx';
import { Bone } from '../../components/Spinner.tsx';
import { EntityState, StateIcon } from '../../components/status.tsx';
import { useRouteParams, useTables } from '../../lib/hooks.ts';
import { PROPOSAL_TYPE_WORDS, proposalTitle } from '../batch/model.ts';
import { NotFound } from '../not-found/NotFound.tsx';
import { MESSAGE_MAX, isDecisionRequest, pendingInOrder, readingsOf, writtenBy } from './day.ts';
import { useDay, useSend } from './hooks.ts';
import { live } from './live.ts';
import { AsideHeading, DayError, DaySkeleton, FromYourIdea, LaterOfTheProduct, ObservationList, Reply } from './parts.tsx';
import { LiveReading, type ReadingContent, ReadingStatus, type Subject } from './Reading.tsx';

export function StartScreen() {
  const { projectId, explorationId = '' } = useRouteParams();
  const day = useDay(projectId, explorationId);
  const [watching, setWatching] = useState(() => live.isLive(explorationId));
  const focusTitle = useRef(false);
  const loaded = !!day.thread && !!day.runs;
  const unread = loaded && readingsOf(day.thread?.messages ?? [], day.runs ?? []).length === 0;
  usePageTitle([watching || unread ? 'DEMIURGO reads your idea' : 'What I understood', day.project?.name]);
  // Whoever sees DEMIURGO reading also sees it finish, and moves on with "See what I understood".
  useEffect(() => {
    if (unread) setWatching(true);
  }, [unread]);
  // The button that swapped the view is gone: the focus goes to the new view's title (R93).
  useEffect(() => {
    if (watching || !focusTitle.current) return;
    focusTitle.current = false;
    const title = document.getElementById('page-title');
    title?.focus();
    announce('What I understood');
  }, [watching]);

  if (isNotFound(day.error)) return <NotFound thing="this idea">It may belong to another project.</NotFound>;
  if (!day.thread || !day.runs) {
    return day.error ? (
      <DayError title="Your idea" error={day.error} onRetry={day.retry} />
    ) : (
      <DaySkeleton label="Loading your idea" />
    );
  }

  const { thread, runs, idea, latest, reading } = day;
  const readings = readingsOf(thread.messages, runs);
  const understanding = readings.at(-1) ?? null;

  if (!idea) {
    return (
      <>
        <PageHeader title={thread.purpose} />
        <PageBody width="reading">
          <div className="flex flex-col items-start gap-4">
            <p className="text-md text-fg-2">Nothing was written in this thread yet, so DEMIURGO has nothing to read.</p>
            <Link
              to="/p/$projectId/threads/$explorationId"
              params={{ projectId, explorationId }}
              className={buttonClass({ variant: 'secondary' })}
            >
              Open the thread
            </Link>
          </div>
        </PageBody>
      </>
    );
  }
  if (watching || !understanding) {
    const run = reading.phase === 'read' ? reading.run : null;
    return (
      <LiveReading
        projectId={projectId}
        explorationId={explorationId}
        name={day.project?.name}
        idea={idea}
        reading={reading}
        content={run ? contentOf(run, thread.messages, thread.questions) : null}
        onSee={() => {
          live.end(explorationId);
          focusTitle.current = true;
          setWatching(false);
        }}
      />
    );
  }

  const subject: Subject = latest && isDecisionRequest(latest) ? 'decisions' : latest?.id === idea.id ? 'idea' : 'correction';
  return (
    <Understood
      projectId={projectId}
      explorationId={explorationId}
      name={day.project?.name}
      idea={idea.body}
      content={contentOf(understanding, thread.messages, thread.questions)}
      newReading={readings.length > 1}
      status={<ReadingStatus projectId={projectId} explorationId={explorationId} reading={reading} subject={subject} />}
      busy={reading.phase === 'waiting' || reading.phase === 'catching_up' || reading.phase === 'working'}
    />
  );
}

function contentOf(run: RunListItem, messages: Message[], questions: Question[]): ReadingContent {
  return { ...writtenBy(messages, run.id), questions: pendingInOrder(questions), batchId: run.batch_id, model: run.model };
}

/** "What I understood": everything proposed, its questions to answer in the thread, and what comes later. */
function Understood({
  projectId,
  explorationId,
  name,
  idea,
  content,
  newReading,
  status,
  busy,
}: {
  projectId: string;
  explorationId: string;
  name: string | undefined;
  idea: string;
  content: ReadingContent;
  newReading: boolean;
  status: ReactNode;
  busy: boolean;
}) {
  const [correcting, setCorrecting] = useState(false);
  const correctButton = useRef<HTMLButtonElement>(null);
  const questions = content.questions;
  const n = questions.length;
  const next =
    n > 0
      ? { label: 'Answer in the thread', to: '/p/$projectId/threads/$explorationId' as const }
      : { label: 'See your starting point', to: '/p/$projectId/start/$explorationId/done' as const };
  const close = () => {
    setCorrecting(false);
    // The form is gone: back to the button that opened it.
    requestAnimationFrame(() => correctButton.current?.focus());
  };

  return (
    <>
      <PageHeader
        eyebrow="The product"
        title={name ?? <Bone className="h-8 w-64" />}
        titleSize="2xl"
        actions={
          <Link to={next.to} params={{ projectId, explorationId }} className={buttonClass({ variant: 'primary' })}>
            {next.label}
            <ArrowRightIcon size={15} />
          </Link>
        }
      >
        <Notice
          tone="accent"
          title={newReading ? 'This is my new reading, with your corrections.' : 'This is my first reading of your idea.'}
          action={
            n > 0 ? (
              <span data-needs={n} className="text-sm font-medium whitespace-nowrap text-accent-text">
                Needs you · {n} {n === 1 ? 'question' : 'questions'}
              </span>
            ) : null
          }
        >
          {n > 0
            ? "Nothing is decided: correct anything that's wrong, then answer my questions."
            : "Nothing is decided: correct anything that's wrong."}
        </Notice>
      </PageHeader>
      <PageBody>
        <WithAside asideLabel="What happens now" aside={<WhatHappensNow projectId={projectId} questions={questions} />}>
          <div className="flex flex-col gap-10">
            <FromYourIdea projectId={projectId} explorationId={explorationId} idea={idea} />
            <Section
              id="understood"
              title="What I understood"
              actions={
                correcting ? null : (
                  <Button
                    ref={correctButton}
                    size="sm"
                    variant="secondary"
                    icon={<PencilIcon size={14} />}
                    onClick={() => setCorrecting(true)}
                  >
                    Correct something
                  </Button>
                )
              }
            >
              {status}
              {correcting ? <Correction projectId={projectId} explorationId={explorationId} onClose={close} /> : null}
              <div className="flex flex-col gap-4" aria-busy={busy || undefined}>
                <Reply reply={content.reply} model={content.model} />
                <ObservationList observations={content.observations} />
              </div>
            </Section>
            {content.batchId ? <Proposed projectId={projectId} batchId={content.batchId} /> : null}
            <LaterOfTheProduct />
          </div>
        </WithAside>
      </PageBody>
    </>
  );
}

/** The side column: nothing is decided, and the questions DEMIURGO will ask, each in its own thread. */
function WhatHappensNow({ projectId, questions }: { projectId: string; questions: Question[] }) {
  const n = questions.length;
  const stages = useQuery(stagesQuery(projectId)).data;
  return (
    <div className="flex flex-col gap-6 rounded-lg border border-edge bg-sunken p-5">
      <h2 className="text-lg font-semibold text-fg">What happens now</h2>
      <section aria-labelledby="now-decided" className="flex flex-col gap-2.5">
        <AsideHeading id="now-decided">Nothing is decided yet</AsideHeading>
        <p className="flex gap-2.5 text-sm text-fg-2">
          <StateIcon kind="proposed" size={15} className="mt-0.5" />
          Everything on this page is only proposed. You decide on each thing.
        </p>
        <p className="flex gap-2.5 text-sm text-fg-2">
          <MinusCircleIcon size={15} className="mt-0.5 shrink-0 text-fg-3" />
          Nothing is built. Each feature will get its own details and checks.
        </p>
      </section>
      <section aria-labelledby="now-questions" className="flex flex-col gap-2.5">
        <AsideHeading id="now-questions">
          {n > 0 ? `Then I'll ask you ${n} ${n === 1 ? 'question' : 'questions'}, one at a time` : 'No questions for now'}
        </AsideHeading>
        {n > 0 ? (
          <ul className="flex flex-col gap-1">
            {questions.map((q) => {
              const stage = q.stage_id ? stages?.find((s) => s.id === q.stage_id) : undefined;
              return (
                <li key={q.id} data-question={q.id}>
                  <Link
                    to="/p/$projectId/threads/$explorationId"
                    params={{ projectId, explorationId: q.exploration_id }}
                    className="group flex items-start gap-2.5 rounded-md px-2 py-1.5 -outline-offset-2 hover:bg-hover"
                  >
                    <EntityState entity="question" state={q.state} className="mt-px" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-sm break-words text-fg group-hover:underline">{q.question}</span>
                      {stage ? <Tag className="self-start">{stage.title} · mandatory</Tag> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="text-sm text-fg-2">
          Smaller things I&apos;ll decide on my own and mark as assumed, so you can check them later.
        </p>
      </section>
    </div>
  );
}

/** "Correct something": the person says what's wrong and DEMIURGO reads the idea again. */
function Correction({ projectId, explorationId, onClose }: { projectId: string; explorationId: string; onClose: () => void }) {
  const tables = useTables();
  const { send, pending, error } = useSend(projectId, explorationId);
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.scrollIntoView({ block: 'center' });
  }, []);
  const canPost = !tables || canCreate(tables, 'message.post');
  const submit = () => {
    if (pending) return;
    if (!text.trim()) {
      setMissing(true);
      field.current?.focus();
      return;
    }
    send(text.trim(), () => {
      announce('Sent. DEMIURGO reads your idea again.');
      onClose();
    });
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3 rounded-lg border border-edge-strong bg-panel p-4"
    >
      <Field
        label="What's wrong?"
        hint="Enter sends · Shift+Enter adds a line"
        error={missing ? "Say what's wrong to send it." : undefined}
        count={text.length > MESSAGE_MAX * 0.9 ? [text.length, MESSAGE_MAX] : undefined}
      >
        {(p) => (
          <TextArea
            {...p}
            ref={field}
            rows={3}
            autoGrow
            maxLength={MESSAGE_MAX}
            value={text}
            placeholder="Say it in your own words: DEMIURGO reads your idea again with it."
            onChange={(e) => {
              setText(e.target.value);
              if (missing) setMissing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
        )}
      </Field>
      {error ? <ErrorNotice error={error} /> : null}
      {canPost ? null : <p className="text-sm text-fg-2">Only a person can do this.</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="secondary"
          icon={<SendIcon size={14} />}
          disabled={!canPost}
          pending={pending}
          pendingLabel="Sending…"
        >
          Send and read again
        </Button>
      </div>
    </form>
  );
}

/** What the reading proposed: each proposal with its real state, waiting for the person on its batch page. */
function Proposed({ projectId, batchId }: { projectId: string; batchId: string }) {
  const batch = useQuery(batchQuery(projectId, batchId));
  return (
    <Section id="proposed" title="What I propose" note="Each one waits for you: accept, change or reject it on its page.">
      {batch.error ? (
        <ErrorNotice error={batch.error} focus={false} onRetry={() => void batch.refetch()} />
      ) : !batch.data ? (
        <Bone className="h-14 w-full rounded-lg" />
      ) : (
        <ul className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge">
          {batch.data.proposals.map((p) => (
            <li key={p.id} data-proposal={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
              <EntityState entity="proposal" state={p.state} />
              <Tag>{PROPOSAL_TYPE_WORDS[p.type] ?? p.type}</Tag>
              <span className="min-w-0 flex-1 basis-48 text-base break-words text-fg">{proposalTitle(p)}</span>
              <Link
                to="/p/$projectId/batches/$batchId"
                params={{ projectId, batchId }}
                className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-sm font-medium text-accent-text hover:bg-hover"
              >
                Review<span className="sr-only">: {proposalTitle(p)}</span>
                <ChevronRightIcon size={13} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
