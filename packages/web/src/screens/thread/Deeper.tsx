// Go deeper (DESIGN.md §3.3; INV-DEEP-01…14): a side conversation about one question, beside the
// thread, so the main conversation stays as it was. The person talks it through with DEMIURGO (Enter
// sends, Shift+Enter adds a line, D-013), then settles the question with an option, their own words
// or one of DEMIURGO's replies — as a draft in the main thread, confirmed with the others. What is
// being written survives closing the panel; "DEMIURGO is writing…" and a failed answer are status
// messages, and a failure offers Retry and the run's details right here (INVENTORY Part C).

import { Link } from '@tanstack/react-router';
import { type KeyboardEvent, type Ref, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { canCreate } from '../../api/tables.ts';
import type { ExplorationDetail, Question, RunListItem } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { ChoiceGroup, Field, TextArea } from '../../components/Field.tsx';
import { ArrowRightIcon, CloseIcon, DeeperIcon, SendIcon } from '../../components/icons.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { QuestionOutcome } from '../../components/QuestionActions.tsx';
import { EntityState, StatusBadge, WorkingDot } from '../../components/status.tsx';
import { Tooltip } from '../../components/Tooltip.tsx';
import { Who } from '../../components/Who.tsx';
import { useTables } from '../../lib/hooks.ts';
import { failureWord } from '../../words.ts';
import { readingOf } from '../onboarding/day.ts';
import { MAX_ANSWER, answerChoices, draftOf, isOpenQuestion, pickedChoices, plainText, withExclusive } from './answers.ts';
import { useDrafts } from './drafts.tsx';
import { Observations } from './Messages.tsx';
import { sideMessages } from './timeline.ts';

const OWN = 'own';
const MAX_MESSAGE = 20_000;

export function DeeperPanel({
  projectId,
  thread,
  question: q,
  runs,
  talk,
  onTalk,
  onClose,
  headingRef,
}: {
  projectId: string;
  thread: ExplorationDetail;
  question: Question;
  runs: readonly RunListItem[];
  /** What the person is writing to DEMIURGO here: kept by the thread while the panel closes. */
  talk: string;
  onTalk: (text: string) => void;
  onClose: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const tables = useTables();
  const drafts = useDrafts();
  const post = useCommand(projectId);
  const retry = useCommand(projectId);
  const talkId = useId();
  const open = isOpenQuestion(q);
  const canTalk = !!tables && canCreate(tables, 'message.post') && thread.state === 'active' && open;

  const messages = sideMessages(thread.messages, q.id);
  // DEMIURGO is writing while the run that answers the person's last message here has not ended.
  const lastAsked = messages.toReversed().find((m) => m.author.startsWith('human:'));
  const reading = lastAsked ? readingOf(runs, lastAsked) : null;
  const writing = reading?.phase === 'catching_up' || reading?.phase === 'waiting' || reading?.phase === 'working';
  const failed = reading && (reading.phase === 'failed' || reading.phase === 'cancelled') ? reading.run : null;

  const scroller = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the end when the side conversation grows
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, writing]);

  const send = () => {
    const text = talk.trim();
    if (!text || post.isPending) return;
    post.mutate(
      { command: 'message.post', data: { exploration_id: thread.id, question_id: q.id, text, respond: true } },
      {
        onSuccess: () => {
          onTalk('');
          announce('Sent. DEMIURGO answers here.');
        },
      },
    );
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const settle = useRef<{ fill: (text: string) => void }>(null);

  return (
    <section id="thread-deeper" aria-labelledby={`${talkId}-title`} className="flex min-h-full flex-col" data-deeper={q.id}>
      <header className="flex flex-col gap-1.5 border-b border-edge px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-2">
            <DeeperIcon size={14} />
            Going deeper
          </span>
          <EntityState entity="question" state={q.state} />
          <Tooltip content="Close and go back to the thread (Esc)">
            <button
              type="button"
              aria-label="Close and go back to the thread"
              onClick={onClose}
              className="-mr-2 ml-auto inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg"
            >
              <CloseIcon size={16} />
            </button>
          </Tooltip>
        </div>
        <h2 id={`${talkId}-title`} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-fg outline-none">
          {q.question}
        </h2>
        <p className="text-sm text-fg-2">The main thread waits here. Nothing is lost.</p>
      </header>

      <div ref={scroller} className="flex min-h-40 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {messages.length === 0 && !writing ? (
          <p className="text-sm text-fg-2">Ask anything about this question: what each option means, examples, what others do.</p>
        ) : null}
        {messages.map((m) =>
          m.author.startsWith('human:') ? (
            <p
              key={m.id}
              className="max-w-[90%] self-end rounded-lg rounded-tr-xs bg-selected px-3 py-2 text-base whitespace-pre-wrap text-fg"
            >
              <span className="sr-only">You: </span>
              {m.body}
            </p>
          ) : m.kind ? (
            <Observations key={m.id} items={[m]} divided={false} />
          ) : (
            <div key={m.id} className="flex flex-col gap-1.5">
              <Who actor={m.author} size={18} className="text-xs font-medium text-fg-2" />
              <Markdown size="sm">{m.body}</Markdown>
              {drafts && open && thread.state === 'active' ? (
                <Button
                  size="sm"
                  variant="quiet"
                  className="self-start"
                  onClick={() => settle.current?.fill(plainText(m.body).slice(0, MAX_ANSWER))}
                >
                  Use this reply as the answer
                </Button>
              ) : null}
            </div>
          ),
        )}
        <div role="status" className="text-sm">
          {writing ? (
            <span className="inline-flex items-center gap-2 text-info-text">
              <WorkingDot />
              DEMIURGO is writing…
            </span>
          ) : null}
        </div>
        {failed ? (
          <FailedHere
            projectId={projectId}
            run={failed}
            retrying={retry.isPending}
            error={retry.error}
            onRetry={() =>
              retry.mutate(
                { command: 'run.retry', data: { run_id: failed.id } },
                { onSuccess: () => announce('Asked again. DEMIURGO answers here.') },
              )
            }
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-4 border-t border-edge px-5 pt-3 pb-5">
        {canTalk ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex flex-col gap-2"
          >
            <Field
              label="Talk it through"
              hint="Enter sends · Shift+Enter adds a line"
              count={talk.length > MAX_MESSAGE * 0.9 ? [talk.length, MAX_MESSAGE] : undefined}
            >
              {(p) => (
                <TextArea
                  {...p}
                  autoGrow
                  maxRows={6}
                  rows={2}
                  value={talk}
                  maxLength={MAX_MESSAGE}
                  placeholder="Ask about this question…"
                  onChange={(e) => onTalk(e.target.value)}
                  onKeyDown={onKeyDown}
                />
              )}
            </Field>
            {post.error ? <ErrorNotice error={post.error} compact /> : null}
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              icon={<SendIcon size={13} />}
              className="self-end"
              disabled={!talk.trim()}
              pending={post.isPending}
              pendingLabel="Sending…"
            >
              Send
            </Button>
          </form>
        ) : null}
        {open ? (
          drafts && thread.state === 'active' ? (
            <Settle ref={settle} question={q} onDone={onClose} />
          ) : null
        ) : (
          <Notice tone="neutral" title="This question is no longer open.">
            <QuestionOutcome question={q} />
          </Notice>
        )}
      </div>
    </section>
  );
}

/** DEMIURGO couldn't answer: why, and the way to ask again or see the run. */
function FailedHere({
  projectId,
  run,
  retrying,
  error,
  onRetry,
}: {
  projectId: string;
  run: RunListItem;
  retrying: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const failed = run.state === 'failed' || run.state === 'interrupted';
  return (
    <Card tone={failed ? 'danger' : undefined} padding="sm" className="flex flex-col gap-2 text-sm" data-deeper-failed={run.id}>
      <p className="flex flex-wrap items-center gap-2">
        <StatusBadge kind={failed ? 'problem' : 'inactive'} word={failed ? 'Failed' : 'Cancelled'} />
        <span className="font-medium text-fg">DEMIURGO couldn't answer this time.</span>
      </p>
      <p className="text-fg-2">{failureWord(run.failure_kind, run.state)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" pending={retrying} pendingLabel="Retrying…" onClick={onRetry}>
          Retry
        </Button>
        <Link
          to="/p/$projectId/runs/$runId"
          params={{ projectId, runId: run.id }}
          aria-label="Details of the run that didn't answer"
          className="inline-flex min-h-6 items-center gap-1 font-medium text-fg-2 hover:text-fg hover:underline"
        >
          Details
          <ArrowRightIcon size={12} />
        </Link>
      </div>
      {error ? <ErrorNotice error={error} compact /> : null}
    </Card>
  );
}

/**
 * Settling the question from here: an option (or several), or the person's own words — which a
 * reply of DEMIURGO can fill. It starts from the question's current draft.
 */
function Settle({
  question: q,
  onDone,
  ref,
}: {
  question: Question;
  onDone: () => void;
  ref: Ref<{ fill: (text: string) => void }>;
}) {
  const drafts = useDrafts();
  const draft = drafts?.answers[q.id];
  const choices = answerChoices(q);
  const initialPicked = pickedChoices(q, draft);
  const [picked, setPicked] = useState<string[]>(() => (draft && initialPicked.length === 0 ? [OWN] : initialPicked));
  const [own, setOwn] = useState(() => (draft && initialPicked.length === 0 ? draft : ''));
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const focusOwn = useRef(false);
  const all = [...choices, { value: OWN, answer: 'My own words', implies: '', exclusive: true }];

  // "Use this reply as the answer" fills the own words and moves there.
  useImperativeHandle(ref, () => ({
    fill: (text: string) => {
      setPicked([OWN]);
      setOwn(text);
      focusOwn.current = true;
    },
  }));
  useEffect(() => {
    if (!focusOwn.current) return;
    focusOwn.current = false;
    ownRef.current?.focus();
  });

  const conclusion = picked.includes(OWN) ? own.trim() : (draftOf(q, picked) ?? '');

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent-edge bg-accent-soft p-3">
      <ChoiceGroup
        name={`settle-${q.id}`}
        legend="Settle the question with"
        multiple={!!q.multiple}
        value={picked}
        onChange={(next) => setPicked(withExclusive(all, picked, next))}
        choices={all.map((c) => ({ value: c.value, label: c.answer, ...(c.implies ? { detail: c.implies } : {}) }))}
      />
      {picked.includes(OWN) ? (
        <Field label="Your answer" count={[own.length, MAX_ANSWER]}>
          {(p) => (
            <TextArea
              {...p}
              ref={ownRef}
              autoGrow
              maxRows={10}
              rows={3}
              value={own}
              maxLength={MAX_ANSWER}
              onChange={(e) => setOwn(e.target.value)}
            />
          )}
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          variant="primary"
          disabled={!conclusion}
          onClick={() => {
            drafts?.setAnswer(q.id, conclusion);
            announce('Drafted as your answer. You confirm it with the others in the thread.');
            onDone();
          }}
        >
          Use as answer
        </Button>
        <span className="text-sm text-fg-2">
          {conclusion ? 'You confirm it with the others in the thread.' : 'Pick an option, or use a reply or your own words.'}
        </span>
      </div>
    </div>
  );
}
