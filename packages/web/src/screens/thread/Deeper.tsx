// Go deeper (DESIGN.md §3.3; INV-DEEP-01…14): a side conversation about one question, beside the
// thread, so the main conversation stays as it was. The person talks it through with DEMIURGO (Enter
// sends, Shift+Enter adds a line, D-013), then settles the question with an option, their own words
// or one of DEMIURGO's replies — as a draft in the main thread, confirmed with the others. What is
// being written survives closing the panel; "DEMIURGO is writing…" and a failed answer are status
// messages, and a failure offers Retry and the run's details right here (INVENTORY Part C). "Explain
// it simply" asks the explainer for the question in plain words, with examples, pros and cons.

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
import { useMessages } from '../../i18n/define.ts';
import { type Reading, useReading } from '../../i18n/reading.tsx';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import { failureWord } from '../../words.ts';
import { readingOf } from '../onboarding/day.ts';
import { CONVERSATION, MAX_ANSWER, answerChoices, draftOf, isOpenQuestion, pickedChoices, withExclusive } from './answers.ts';
import { useDrafts } from './drafts.tsx';
import { ExplainButton, useExplain } from './Explain.tsx';
import { Observations } from './Messages.tsx';
import { sideMessages } from './timeline.ts';
import { ANSWER_WORDS, DEEPER } from './words.i18n.ts';

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
  compact = false,
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
  /**
   * The options to settle the question keep to a part of the panel, with their own scroll, and can be
   * hidden, so the conversation has the room (Go deeper in a thread and over Day 1).
   */
  compact?: boolean;
}) {
  const t = useMessages(DEEPER);
  const tables = useTables();
  const drafts = useDrafts();
  const post = useCommand(projectId);
  const retry = useCommand(projectId);
  const explain = useExplain(projectId, thread.id);
  const shown = useReading(projectId, 'question', q.id);
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
          announce(t.sentAnswersHere);
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

  const settle = useRef<{ pick: (value: string) => void }>(null);
  // The answer the conversation led to shows under DEMIURGO's last reply, ready to pick.
  const lastReply = messages.toReversed().find((m) => !m.author.startsWith('human:') && !m.kind);
  const idea = drafts && open && thread.state === 'active' ? q.conversation_option : null;
  const [settling, setSettling] = useState(true);

  return (
    <section
      id="thread-deeper"
      aria-labelledby={`${talkId}-title`}
      className={cn('flex flex-col', compact ? 'h-full' : 'min-h-full')}
      data-deeper={q.id}
    >
      <header className={cn('flex flex-col border-b border-edge', compact ? 'gap-1 px-4 pt-2 pb-2' : 'gap-1.5 px-5 pt-4 pb-3')}>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-2">
            <DeeperIcon size={14} />
            {t.goingDeeper}
          </span>
          <EntityState entity="question" state={q.state} />
          {compact && canTalk ? (
            <span className="ml-auto">
              <ExplainButton question={q} pending={explain.pending || writing} onExplain={() => explain.ask(q.id)} />
            </span>
          ) : null}
          <Tooltip content={t.closeTip}>
            <button
              type="button"
              aria-label={t.closeAria}
              onClick={onClose}
              className={cn(
                '-mr-2 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg',
                !(compact && canTalk) && 'ml-auto',
              )}
            >
              <CloseIcon size={16} />
            </button>
          </Tooltip>
        </div>
        <h2
          id={`${talkId}-title`}
          ref={headingRef}
          tabIndex={-1}
          className={cn('font-semibold text-fg outline-none', compact ? 'text-base' : 'text-lg')}
        >
          {shown.text('question', q.question)}
        </h2>
        {shown.mark ? <div>{shown.mark}</div> : null}
        {compact ? null : <p className="text-sm text-fg-2">{t.waitsHere}</p>}
        {canTalk && !compact ? (
          <div className="flex flex-col items-start gap-1">
            <ExplainButton question={q} pending={explain.pending || writing} onExplain={() => explain.ask(q.id)} />
          </div>
        ) : null}
        {explain.error ? <ErrorNotice error={explain.error} compact /> : null}
      </header>

      <div
        ref={scroller}
        role="log"
        aria-label={t.sideConversation}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region is reached with the keyboard (axe scrollable-region-focusable)
        tabIndex={0}
        className={cn('flex min-h-40 flex-1 flex-col overflow-y-auto', compact ? 'gap-2.5 px-4 py-3' : 'gap-3 px-5 py-4')}
      >
        {messages.length === 0 && !writing ? <p className="text-sm text-fg-2">{t.askAnything}</p> : null}
        {messages.map((m) =>
          m.author.startsWith('human:') ? (
            <p
              key={m.id}
              className="max-w-[90%] self-end rounded-lg rounded-tr-xs bg-selected px-3 py-2 text-base whitespace-pre-wrap text-fg"
            >
              <span className="sr-only">{t.youPrefix}</span>
              {m.body}
            </p>
          ) : m.kind ? (
            // What DEMIURGO observed stays in the thread; over Day 1 the room goes to the conversation.
            compact ? null : (
              <Observations key={m.id} projectId={projectId} items={[m]} divided={false} />
            )
          ) : (
            <div key={m.id} className="flex flex-col gap-1.5">
              <Who actor={m.author} size={18} className="text-xs font-medium text-fg-2" />
              <Markdown size="sm">{m.body}</Markdown>
              {idea && m.id === lastReply?.id ? (
                <div
                  className="flex flex-col gap-1.5 rounded-lg border border-accent-edge bg-accent-soft px-3 py-2"
                  data-conversation-option
                >
                  <span className="text-xs font-medium text-accent-text">{t.theIdea}</span>
                  <span className="text-sm font-medium text-fg">{idea.answer}</span>
                  <span className="text-xs text-fg-2">{idea.implies}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="self-start"
                    onClick={() => {
                      setSettling(true);
                      settle.current?.pick(CONVERSATION);
                    }}
                  >
                    {t.useIdeaAsAnswer}
                  </Button>
                </div>
              ) : null}
            </div>
          ),
        )}
        <div role="status" className="text-sm">
          {writing ? (
            <span className="inline-flex items-center gap-2 text-info-text">
              <WorkingDot />
              {t.writing}
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
              retry.mutate({ command: 'run.retry', data: { run_id: failed.id } }, { onSuccess: () => announce(t.askedAgain) })
            }
          />
        ) : null}
      </div>

      <div className={cn('flex flex-col border-t border-edge', compact ? 'gap-2 px-4 pt-2 pb-3' : 'gap-4 px-5 pt-3 pb-5')}>
        {canTalk ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className={cn('flex gap-2', compact ? 'flex-wrap items-end' : 'flex-col')}
          >
            <Field
              label={t.talkThrough}
              labelHidden={compact}
              className={compact ? 'min-w-0 flex-1' : undefined}
              {...(compact ? {} : { hint: t.hint })}
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
                  placeholder={compact ? t.placeholderEnter : t.placeholder}
                  onChange={(e) => onTalk(e.target.value)}
                  onKeyDown={onKeyDown}
                />
              )}
            </Field>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              icon={<SendIcon size={13} />}
              className="self-end"
              disabled={!talk.trim()}
              pending={post.isPending}
              pendingLabel={t.sending}
            >
              {t.send}
            </Button>
            {post.error ? <ErrorNotice error={post.error} compact /> : null}
          </form>
        ) : null}
        {open ? (
          drafts && thread.state === 'active' ? (
            <>
              {compact ? (
                <Button
                  size="sm"
                  variant="quiet"
                  className="-my-1 self-start"
                  aria-expanded={settling}
                  onClick={() => setSettling(!settling)}
                >
                  {settling ? t.hideOptions : t.showOptions}
                </Button>
              ) : null}
              <div hidden={!settling} className={compact ? 'max-h-[26vh] overflow-y-auto' : undefined}>
                <Settle ref={settle} question={q} reading={shown} onDone={onClose} dense={compact} />
              </div>
            </>
          ) : null
        ) : (
          <Notice tone="neutral" title={t.notOpen}>
            <QuestionOutcome question={q} reading={shown} />
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
  const t = useMessages(DEEPER);
  const failed = run.state === 'failed' || run.state === 'interrupted';
  return (
    <Card tone={failed ? 'danger' : undefined} padding="sm" className="flex flex-col gap-2 text-sm" data-deeper-failed={run.id}>
      <p className="flex flex-wrap items-center gap-2">
        <StatusBadge kind={failed ? 'problem' : 'inactive'} word={failed ? t.failed : t.cancelled} />
        <span className="font-medium text-fg">{t.couldntAnswer}</span>
      </p>
      <p className="text-fg-2">{failureWord(run.failure_kind, run.state)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" pending={retrying} pendingLabel={t.retrying} onClick={onRetry}>
          {t.retry}
        </Button>
        <Link
          to="/p/$projectId/runs/$runId"
          params={{ projectId, runId: run.id }}
          aria-label={t.detailsAria}
          className="inline-flex min-h-6 items-center gap-1 font-medium text-fg-2 hover:text-fg hover:underline"
        >
          {t.details}
          <ArrowRightIcon size={12} />
        </Link>
      </div>
      {error ? <ErrorNotice error={error} compact /> : null}
    </Card>
  );
}

/**
 * Settling the question from here: an option (or several), the answer the conversation led to, or
 * the person's own words. It starts from the question's current draft.
 */
function Settle({
  question: q,
  reading,
  onDone,
  ref,
  dense = false,
}: {
  question: Question;
  reading: Reading;
  onDone: () => void;
  ref: Ref<{ pick: (value: string) => void }>;
  dense?: boolean;
}) {
  const t = useMessages(DEEPER);
  const answerWords = useMessages(ANSWER_WORDS);
  const drafts = useDrafts();
  const draft = drafts?.answers[q.id];
  const choices = answerChoices(q, answerWords);
  const initialPicked = pickedChoices(q, draft);
  const [picked, setPicked] = useState<string[]>(() => (draft && initialPicked.length === 0 ? [OWN] : initialPicked));
  const [own, setOwn] = useState(() => (draft && initialPicked.length === 0 ? draft : ''));
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const all = [...choices, { value: OWN, answer: t.ownWords, implies: '', exclusive: true }];

  // "Use this idea as the answer" picks the answer the conversation led to.
  useImperativeHandle(ref, () => ({ pick: (value: string) => setPicked([value]) }));

  const conclusion = picked.includes(OWN) ? own.trim() : (draftOf(q, picked) ?? '');

  return (
    <div className={cn('flex flex-col rounded-lg border border-accent-edge bg-accent-soft', dense ? 'gap-2 p-2.5' : 'gap-3 p-3')}>
      <ChoiceGroup
        dense={dense}
        name={`settle-${q.id}`}
        legend={t.settleWith}
        multiple={!!q.multiple}
        value={picked}
        onChange={(next) => setPicked(withExclusive(all, picked, next))}
        choices={all.map((c) => ({
          value: c.value,
          label: c.highlight ? (
            <>
              <span className="mr-1.5 text-xs font-medium text-accent-text">{answerWords.fromConversation}</span>
              {c.answer}
            </>
          ) : (
            reading.text(`options.${c.value}.answer`, c.answer)
          ),
          ...(c.implies ? { detail: reading.text(`options.${c.value}.implies`, c.implies) } : {}),
          ...(c.highlight ? { highlight: true } : {}),
        }))}
      />
      {picked.includes(OWN) ? (
        <Field label={t.yourAnswer} count={[own.length, MAX_ANSWER]}>
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
            announce(t.drafted);
            onDone();
          }}
        >
          {t.useAsAnswer}
        </Button>
        <span className="text-sm text-fg-2">{conclusion ? t.confirmWithOthers : t.pickOption}</span>
      </div>
    </div>
  );
}
