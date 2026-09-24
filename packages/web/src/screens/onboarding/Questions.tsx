// One question at a time (canvas S4D, adapted to H1): on the right the question in big type, why
// DEMIURGO asks it and what it affects, and the person's answer; Answer confirms it with that
// conclusion, Skip leaves it open and Not now parks it with a reason. On the left, the answers
// given so far and what DEMIURGO understood. After the last one, DEMIURGO is asked to propose
// decisions from the answers ("I decide: …"); it only proposes them.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { batchQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Message, Question } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { useRouteParams, useTables } from '../../lib/hooks.ts';
import { useAllows } from '../../ui/ActionBar.tsx';
import { Button, buttonStyles } from '../../ui/Button.tsx';
import { TextDialog } from '../../ui/dialogs.tsx';
import { TypeIcon } from '../../ui/icons.tsx';
import { Mark, StateMark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { stateWord } from '../../words.ts';
import { proposalTitle } from '../batch/model.ts';
import { NotFound } from '../not-found/NotFound.tsx';
import {
  IMPACT_WORDS,
  type Reading,
  answersOf,
  decisionRequest,
  isDecisionRequest,
  pendingInOrder,
  understandingOf,
  walkSummary,
  writtenBy,
} from './day.ts';
import { useDay, useSend } from './hooks.ts';
import { AnswerRow, DayFrame, DaySkeleton, Eyebrow, FromYourIdea, ObservationRow, ProductTitle } from './parts.tsx';
import { ReadingStatus } from './Reading.tsx';

export function QuestionsScreen() {
  const { projectId, explorationId = '' } = useRouteParams();
  const day = useDay(projectId, explorationId);
  const [walk, setWalk] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const thread = day.thread;

  // The questions walked are the open ones when the screen opens, plus any DEMIURGO raises while
  // the person is still walking them. Once the walk ends it no longer grows.
  useEffect(() => {
    if (!thread) return;
    const ids = pendingInOrder(thread.questions).map((q) => q.id);
    setWalk((w) => {
      if (w === null) return day.latest && isDecisionRequest(day.latest) ? [] : ids;
      if (index >= w.length) return w;
      const missing = ids.filter((id) => !w.includes(id));
      return missing.length ? [...w, ...missing] : w;
    });
  }, [thread, index, day.latest]);

  if (day.error instanceof ApiError && day.error.status === 404) {
    return <NotFound thing="these questions">They may belong to another project.</NotFound>;
  }
  if (!thread || !day.runs || walk === null) {
    return day.error ? (
      <main id="main" className="mx-auto max-w-[760px] px-6 pt-14">
        <Reasons error={day.error} />
      </main>
    ) : (
      <DaySkeleton label="Loading the questions" />
    );
  }

  const question = index < walk.length ? thread.questions.find((q) => q.id === walk[index]) : undefined;
  const walked = walk.length
    ? walk.map((id) => thread.questions.find((q) => q.id === id)).filter((q): q is Question => !!q)
    : thread.questions;
  const understanding = understandingOf(thread.messages, day.runs);
  const request = day.latest && isDecisionRequest(day.latest) ? day.latest : null;
  const next = () => setIndex((i) => i + 1);

  return (
    <DayFrame
      wide
      asideLabel={question ? `Question ${index + 1} of ${walk.length}` : 'Questions done'}
      aside={
        question ? (
          <Ask
            key={question.id}
            projectId={projectId}
            explorationId={explorationId}
            question={question}
            position={index + 1}
            total={walk.length}
            onNext={next}
          />
        ) : (
          <End
            projectId={projectId}
            explorationId={explorationId}
            walked={walked}
            questions={thread.questions}
            total={walk.length}
            request={request}
            reading={day.reading}
            now={day.now}
          />
        )
      }
    >
      <FromYourIdea projectId={projectId} explorationId={explorationId} idea={day.idea?.body ?? thread.purpose} />
      <ProductTitle name={day.project?.name} className="text-muted" />
      <Answers questions={thread.questions} />
      {understanding && <Understood messages={thread.messages} runId={understanding.id} />}
    </DayFrame>
  );
}

/** "1 of 3" and its bars. */
function Progress({ position, total }: { position: number; total: number }) {
  return (
    <span className="flex items-center gap-2 text-xs font-semibold text-ink-2">
      {position} of {total}
      <span aria-hidden="true" className="flex gap-[3px]">
        {Array.from({ length: Math.min(total, 10) }, (_, i) => (
          <span key={i} className={cn('h-1 w-4 rounded-[2px]', i < position ? 'bg-needs' : 'bg-line-strong')} />
        ))}
      </span>
    </span>
  );
}

function Ask({
  projectId,
  explorationId,
  question: q,
  position,
  total,
  onNext,
}: {
  projectId: string;
  explorationId: string;
  question: Question;
  position: number;
  total: number;
  onNext: () => void;
}) {
  const command = useCommand(projectId);
  const allows = useAllows('question', q.state);
  const [text, setText] = useState('');
  const [parking, setParking] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const answerId = useId();
  useEffect(() => heading.current?.focus(), []);

  const answer = () =>
    command.mutate({ command: 'question.confirm', entityId: q.id, data: { conclusion: text.trim() } }, { onSuccess: onNext });
  const park = (reason: string) =>
    command.mutate(
      { command: 'question.postpone', entityId: q.id, data: { reason } },
      {
        onSuccess: () => {
          setParking(false);
          onNext();
        },
      },
    );

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
          <TypeIcon kind="question" size={14} />
          Question
          <span className="text-inactive-light" aria-hidden="true">
            ·
          </span>
          <span className="tracking-normal normal-case">
            <StateMark entity="question" state={q.state} />
          </span>
        </span>
        <Progress position={position} total={total} />
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 ref={heading} tabIndex={-1} className="text-[21px] leading-[1.3] font-semibold outline-none">
          {q.question}
        </h2>
        {q.reason && <p className="text-[13px] text-ink-3">Why I ask: {q.reason}</p>}
        {q.impact && <p className="text-[13px] text-ink-3">{IMPACT_WORDS[q.impact] ?? q.impact}</p>}
      </div>
      {allows('question.confirm') && (
        <form
          id={`${answerId}-form`}
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && !command.isPending) answer();
          }}
        >
          <label htmlFor={answerId} className="text-xs font-semibold text-ink-2">
            Your answer
          </label>
          <textarea
            id={answerId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={3000}
            placeholder="Answer in your own words"
            className="w-full resize-y rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[14px] leading-relaxed text-ink placeholder:text-muted focus:border-needs focus:outline-none"
          />
        </form>
      )}
      {!parking && command.error ? <Reasons error={command.error} /> : null}
      <div className="mt-auto flex flex-col gap-2.5">
        {allows('question.confirm') && (
          <Button
            type="submit"
            form={`${answerId}-form`}
            variant="needs"
            size="lg"
            className="h-11 w-full rounded-[10px]"
            disabled={!text.trim() || command.isPending}
          >
            {command.isPending && !parking ? 'Answering…' : 'Answer'}
          </Button>
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="h-9 flex-1" onClick={onNext}>
            {q.state === 'pending' ? 'Skip' : 'Next'}
          </Button>
          {allows('question.postpone') && (
            <Button
              variant="outline"
              className="h-9 flex-1"
              onClick={() => {
                command.reset();
                setParking(true);
              }}
            >
              Not now
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">
          Talk it through with DEMIURGO instead:{' '}
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId }}
            className="font-semibold text-needs hover:text-needs-hover"
          >
            Open the thread
          </Link>
        </p>
      </div>
      <TextDialog
        open={parking}
        onOpenChange={(o) => !o && setParking(false)}
        title="Not now"
        description="The question stays for later, parked. Say why."
        label="Reason"
        submit="Park it"
        required
        maxLength={1000}
        pending={command.isPending}
        error={parking ? command.error : null}
        onSubmit={park}
      />
    </>
  );
}

/** After the last question: what happened to each, and asking DEMIURGO to propose decisions. */
function End({
  projectId,
  explorationId,
  walked,
  questions,
  total,
  request,
  reading,
  now,
}: {
  projectId: string;
  explorationId: string;
  walked: Question[];
  questions: Question[];
  total: number;
  request: Message | null;
  reading: Reading;
  now: number;
}) {
  const tables = useTables();
  const { send, pending, error } = useSend(projectId, explorationId);
  const [asked, setAsked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const answers = answersOf(questions);
  const read = !!request && reading.phase === 'read';
  const batchId = read ? (reading.run?.batch_id ?? null) : null;
  const batch = useQuery({ ...batchQuery(projectId, batchId ?? ''), enabled: !!batchId });
  const proposed = batch.data?.proposals.filter((p) => p.type === 'decision') ?? [];
  const decisions = proposed.length;
  const canPost = !!tables && canCreate(tables, 'message.post');
  const showAsk = !request && !asked && canPost;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
          <TypeIcon kind="question" size={14} />
          Questions
        </span>
        {total > 0 && <Progress position={total} total={total} />}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 ref={heading} tabIndex={-1} className="text-[21px] leading-[1.3] font-semibold outline-none">
          That&apos;s all my questions for now
        </h2>
        <p className="text-[14px] text-ink-2">{walkSummary(walked)}</p>
      </div>
      {showAsk && (
        <p className="text-[13px] text-ink-3">
          DEMIURGO can turn your answers into decisions. It only proposes them: you accept, change or reject each one.
        </p>
      )}
      {showAsk && answers.length === 0 && (
        <p className="text-[13px] text-muted">Answer at least one question to ask for decisions.</p>
      )}
      {request && (
        <ReadingStatus projectId={projectId} explorationId={explorationId} reading={reading} subject="decisions" now={now} />
      )}
      {read && batchId && batch.data && (
        <section data-proposed-decisions className="flex flex-col gap-2">
          <p className="text-[15px] font-semibold">
            DEMIURGO proposed {decisions} {decisions === 1 ? 'decision' : 'decisions'}.
          </p>
          <ul className="flex flex-col gap-1.5">
            {proposed.map((p) => (
              <li
                key={p.id}
                className="flex items-start gap-2.5 rounded-[8px] border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink"
              >
                <span className="mt-[4px] flex shrink-0">
                  <Mark kind={stateWord('proposal', p.state).mark} label={stateWord('proposal', p.state).word} />
                </span>
                <span className="line-clamp-3">{proposalTitle(p)}</span>
              </li>
            ))}
          </ul>
          {decisions > 0 && (
            <p className="text-xs text-muted">They wait for you: accept, change or reject each one. Nothing is decided yet.</p>
          )}
        </section>
      )}
      {read && !batchId && (
        <p data-proposed-decisions className="text-[14px] text-ink-2">
          DEMIURGO didn&apos;t propose a decision this time. You can ask again in the thread.
        </p>
      )}
      {error ? <Reasons error={error} /> : null}
      <div className="mt-auto flex flex-col gap-2.5">
        {showAsk && (
          <Button
            variant="needs"
            size="lg"
            className="h-11 w-full rounded-[10px]"
            disabled={answers.length === 0 || pending}
            onClick={() => send(decisionRequest(answers), () => setAsked(true))}
          >
            {pending ? 'Asking…' : 'Ask DEMIURGO to propose decisions'}
          </Button>
        )}
        <Link
          to="/p/$projectId/start/$explorationId/done"
          params={{ projectId, explorationId }}
          className={cn(buttonStyles({ variant: read ? 'needs' : 'outline', size: 'lg' }), 'h-11 w-full rounded-[10px]')}
        >
          See your starting point
        </Link>
      </div>
    </>
  );
}

/** The person's answers so far, confirmed. */
function Answers({ questions }: { questions: Question[] }) {
  const headingId = useId();
  const confirmed = questions
    .filter((q) => q.state === 'confirmed')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <Eyebrow id={headingId}>Your answers</Eyebrow>
      {confirmed.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {confirmed.map((q) => (
            <AnswerRow key={q.id} question={q} />
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">Your answers appear here as you give them.</p>
      )}
    </section>
  );
}

/** What DEMIURGO understood, quieter: the context of the questions. */
function Understood({ messages, runId }: { messages: Message[]; runId: string }) {
  const headingId = useId();
  const { reply, observations } = writtenBy(messages, runId);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <Eyebrow id={headingId}>What I understood</Eyebrow>
      <ReplyText reply={reply} />
      {observations.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {observations.map((o) => (
            <ObservationRow key={o.id} observation={o} compact />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReplyText({ reply }: { reply: Message | null }) {
  if (!reply) return null;
  return <p className="text-[14px] leading-relaxed text-muted">{reply.body}</p>;
}
