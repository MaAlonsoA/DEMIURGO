// Day 1, one question at a time (DESIGN.md §3.9; unlinked since patch 4af77f1 — answering happens
// in the thread — and kept reachable by URL). The side column holds the walk: the question, why it
// matters and what it affects, and the answer — DEMIURGO's inferred one, a predefined option (one
// or several, exclusive options standing alone, as in the thread) or the person's own words.
// Answer confirms it; Skip leaves it open; Park keeps it for later with a reason (DESIGN.md §4.4).
// The walk survives a reload in this tab. After the last one, DEMIURGO is asked to propose
// decisions from the answers ("I decide: …"); it only proposes them.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { batchQuery, stagesQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Message, Question } from '../../api/types.ts';
import { useAllows } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { KeyValue } from '../../components/Card.tsx';
import { isNotFound } from '../../components/explain.ts';
import { type Choice, ChoiceGroup, Field, TextArea } from '../../components/Field.tsx';
import { ChevronRightIcon } from '../../components/icons.tsx';
import { Meter } from '../../components/Meter.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, WithAside, usePageTitle } from '../../components/Page.tsx';
import { QuestionActions } from '../../components/QuestionActions.tsx';
import { Bone } from '../../components/Spinner.tsx';
import { EntityState } from '../../components/status.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { useRouteParams, useTables } from '../../lib/hooks.ts';
import { useMessages } from '../../i18n/define.ts';
import { proposalTitle } from '../batch/model.ts';
import { NotFound } from '../not-found/NotFound.tsx';
import { QUESTIONS } from './words.i18n.ts';
import {
  IMPACT_LEVEL,
  IMPACT_WORDS,
  INFERRED,
  OWN,
  type Reading,
  answersOf,
  conclusionOf,
  decisionRequest,
  isDecisionRequest,
  optionKey,
  pendingInOrder,
  togglePicked,
  understandingOf,
  walkSummary,
  writtenBy,
} from './day.ts';
import { useDay, useSend } from './hooks.ts';
import { AnswerRow, DayError, DaySkeleton, FromYourIdea, ObservationList, Reply } from './parts.tsx';
import { ReadingStatus } from './Reading.tsx';
import { ExplainButton, Explanation, useExplain } from '../thread/Explain.tsx';

type Walk = { ids: string[]; index: number };

const walkKey = (explorationId: string) => `dm-day1-walk:${explorationId}`;

function readWalk(explorationId: string): Walk | null {
  try {
    const raw = sessionStorage.getItem(walkKey(explorationId));
    const w = raw ? (JSON.parse(raw) as Walk) : null;
    return w && Array.isArray(w.ids) && Number.isInteger(w.index) ? w : null;
  } catch {
    return null;
  }
}

function saveWalk(explorationId: string, walk: Walk): void {
  try {
    sessionStorage.setItem(walkKey(explorationId), JSON.stringify(walk));
  } catch {
    // Storage may be unavailable: the walk then lasts for this visit only.
  }
}

export function QuestionsScreen() {
  const t = useMessages(QUESTIONS);
  const { projectId, explorationId = '' } = useRouteParams();
  const day = useDay(projectId, explorationId);
  const [walk, setWalk] = useState<Walk | null>(() => readWalk(explorationId));
  const thread = day.thread;
  const index = walk?.index ?? 0;
  const question = walk && index < walk.ids.length ? thread?.questions.find((q) => q.id === walk.ids[index]) : undefined;
  usePageTitle([question ? t.pageTitleOf(index + 1, walk?.ids.length ?? 0) : t.pageTitleDone, day.project?.name]);

  // The questions walked are the open ones when the screen opens, plus any DEMIURGO raises while
  // the person is still walking them. Once the walk ends it no longer grows.
  useEffect(() => {
    if (!thread) return;
    const ids = pendingInOrder(thread.questions).map((q) => q.id);
    setWalk((w) => {
      if (w === null) return { ids: day.latest && isDecisionRequest(day.latest) ? [] : ids, index: 0 };
      if (w.index >= w.ids.length) return w;
      const missing = ids.filter((id) => !w.ids.includes(id));
      return missing.length ? { ...w, ids: [...w.ids, ...missing] } : w;
    });
  }, [thread, day.latest]);
  useEffect(() => {
    if (walk) saveWalk(explorationId, walk);
  }, [walk, explorationId]);

  if (isNotFound(day.error)) return <NotFound thing={t.notFoundThing}>{t.notFoundHint}</NotFound>;
  if (!thread || !day.runs || walk === null) {
    return day.error ? (
      <DayError title={t.errorTitle} error={day.error} onRetry={day.retry} />
    ) : (
      <DaySkeleton label={t.loadingQuestions} />
    );
  }

  const walked = walk.ids.length
    ? walk.ids.map((id) => thread.questions.find((q) => q.id === id)).filter((q): q is Question => !!q)
    : thread.questions;
  const understanding = understandingOf(thread.messages, day.runs);
  const request = day.latest && isDecisionRequest(day.latest) ? day.latest : null;
  const next = () => setWalk((w) => (w ? { ...w, index: w.index + 1 } : w));
  const total = walk.ids.length;

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={day.project?.name ?? <Bone className="h-7 w-56" />}
        meta={total > 0 ? t.metaToWalk(total) : null}
      />
      <PageBody>
        <WithAside
          asideWidth="lg"
          asideLabel={question ? t.questionOf(index + 1, total) : t.questionsDone}
          aside={
            <div className="flex flex-col gap-5 rounded-lg border border-edge-strong bg-panel p-5">
              {question ? (
                <Ask
                  key={question.id}
                  projectId={projectId}
                  explorationId={explorationId}
                  question={question}
                  position={index + 1}
                  total={total}
                  onNext={next}
                />
              ) : (
                <End
                  projectId={projectId}
                  explorationId={explorationId}
                  walked={walked}
                  questions={thread.questions}
                  total={total}
                  request={request}
                  reading={day.reading}
                />
              )}
            </div>
          }
        >
          <div className="flex flex-col gap-10">
            <FromYourIdea projectId={projectId} explorationId={explorationId} idea={day.idea?.body ?? thread.purpose} />
            <Answers questions={thread.questions} />
            {understanding ? (
              <Understood messages={thread.messages} runId={understanding.id} model={understanding.model} />
            ) : null}
          </div>
        </WithAside>
      </PageBody>
    </>
  );
}

/** "1 of 3" with its bar: the text carries the value. */
function Progress({ position, total }: { position: number; total: number }) {
  const t = useMessages(QUESTIONS);
  return <Meter value={position} max={total} label={t.of(position, total)} className="w-32" />;
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
  const t = useMessages(QUESTIONS);
  const command = useCommand(projectId);
  const explain = useExplain(projectId, q.exploration_id);
  const allows = useAllows('question', q.state);
  const stages = useQuery(stagesQuery(projectId)).data;
  const stage = q.stage_id ? stages?.find((s) => s.id === q.stage_id) : undefined;
  const options = q.options ?? [];
  const inferred = q.state === 'inferred' && q.conclusion ? q.conclusion : null;
  const picking = options.length > 0 || !!inferred;
  const [picked, setPicked] = useState<string[]>(inferred ? [INFERRED] : picking ? [] : [OWN]);
  const [own, setOwn] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const ownField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const conclusion = conclusionOf(q, picked, own);
  const answer = () =>
    command.mutate(
      { command: 'question.confirm', entityId: q.id, data: { conclusion } },
      {
        onSuccess: () => {
          announce(t.answered);
          onNext();
        },
      },
    );
  const canAnswer = allows('question.confirm');
  const choices: Choice[] = [
    ...(inferred
      ? [
          {
            value: INFERRED,
            label: inferred,
            detail: q.reasoning ? t.inferredByDemiurgo(q.reasoning) : t.inferredNoReason,
          },
        ]
      : []),
    ...options.map((o, i) => ({
      value: optionKey(i),
      label: o.answer,
      detail: o.exclusive && q.multiple ? `${o.implies} ${t.onlyThisOne}` : o.implies,
    })),
    { value: OWN, label: t.somethingElse, detail: t.writeOwnWords },
  ];
  const writing = picked.includes(OWN);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
          <TypeIcon type="question" size={15} className="text-fg-3" />
          {stage ? `${stage.title} · ${t.mandatory}` : t.question}
          <EntityState entity="question" state={q.state} />
        </span>
        <Progress position={position} total={total} />
      </div>
      <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold break-words text-fg outline-none">
        {q.question}
      </h2>
      {q.reason || q.impact ? (
        <KeyValue
          className="rounded-lg border border-edge bg-sunken px-3.5 py-3"
          items={[
            ...(q.reason ? [{ key: 'why', label: t.why, value: q.reason }] : []),
            ...(q.impact
              ? [
                  {
                    key: 'impact',
                    label: t.impact,
                    value: (
                      <>
                        <span className="font-medium">{IMPACT_LEVEL[q.impact] ?? q.impact}.</span> {IMPACT_WORDS[q.impact] ?? ''}
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
      ) : null}
      <div className="flex flex-col items-start gap-2">
        <ExplainButton question={q} pending={explain.pending} onExplain={() => explain.ask(q.id)} />
        <Explanation projectId={projectId} explorationId={q.exploration_id} questionId={q.id} />
        {explain.error ? <ErrorNotice error={explain.error} compact /> : null}
      </div>
      {canAnswer ? (
        <form
          id={`answer-${q.id}`}
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (conclusion && !command.isPending) answer();
          }}
        >
          {picking ? (
            <ChoiceGroup
              legend={q.multiple ? t.pickMultiple : t.pickOne}
              multiple={!!q.multiple}
              value={picked}
              onChange={(value) => {
                const nextPicked = togglePicked(q, picked, value);
                setPicked(nextPicked);
                if (nextPicked.includes(OWN) && !picked.includes(OWN)) requestAnimationFrame(() => ownField.current?.focus());
              }}
              choices={choices}
            />
          ) : null}
          {writing ? (
            <Field label={t.yourAnswer} labelHidden={picking} count={own.length > 2700 ? [own.length, 3000] : undefined}>
              {(p) => (
                <TextArea
                  {...p}
                  ref={ownField}
                  rows={4}
                  autoGrow
                  maxLength={3000}
                  value={own}
                  placeholder={t.answerPlaceholder}
                  onChange={(e) => setOwn(e.target.value)}
                />
              )}
            </Field>
          ) : null}
        </form>
      ) : null}
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <div className="flex flex-col gap-2.5">
        {canAnswer ? (
          <>
            <Button
              type="submit"
              form={`answer-${q.id}`}
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!conclusion}
              pending={command.isPending}
              pendingLabel={t.answering}
            >
              {t.answer}
            </Button>
            {!conclusion ? <p className="text-center text-xs text-fg-2">{picking ? t.pickFirst : t.writeFirst}</p> : null}
          </>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="flex-1" onClick={onNext}>
            {q.state === 'pending' ? t.skip : t.next}
          </Button>
          {/* Park keeps it for later with a reason: the same words and dialog as everywhere (§4.4). */}
          <QuestionActions
            projectId={projectId}
            question={q}
            hide={['answer', 'confirm', 'change', 'drop', 'reopen']}
            onDone={onNext}
          />
        </div>
        <p className="text-sm text-fg-2">
          {t.talkThrough}{' '}
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId }}
            className="font-medium text-accent-text hover:underline"
          >
            {t.openThread}
          </Link>
        </p>
      </div>
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
}: {
  projectId: string;
  explorationId: string;
  walked: Question[];
  questions: Question[];
  total: number;
  request: Message | null;
  reading: Reading;
}) {
  const t = useMessages(QUESTIONS);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-fg-2">
          <TypeIcon type="question" size={15} className="text-fg-3" />
          {t.questionsHeader}
        </span>
        {total > 0 ? <Progress position={total} total={total} /> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold text-fg outline-none">
          {t.lastQuestion}
        </h2>
        <p className="text-base text-fg-2">{walkSummary(walked)}</p>
      </div>
      {showAsk ? <p className="text-sm text-fg-2">{t.canTurnAnswers}</p> : null}
      {showAsk && answers.length === 0 ? <p className="text-sm text-fg-2">{t.answerAtLeastOne}</p> : null}
      {request ? (
        <ReadingStatus projectId={projectId} explorationId={explorationId} reading={reading} subject="decisions" />
      ) : null}
      {read && batchId && batch.error ? (
        <ErrorNotice error={batch.error} focus={false} onRetry={() => void batch.refetch()} />
      ) : null}
      {read && batchId && batch.data ? (
        <section data-proposed-decisions aria-labelledby="proposed-decisions" className="flex flex-col gap-2.5">
          <p id="proposed-decisions" className="text-base font-semibold text-fg">
            {t.demiurgoProposed(decisions)}
          </p>
          <ul className="flex flex-col gap-2">
            {proposed.map((p) => (
              <li
                key={p.id}
                className="flex items-start gap-2.5 rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-fg"
              >
                <EntityState entity="proposal" state={p.state} className="mt-px" />
                <span className="min-w-0 break-words">{proposalTitle(p)}</span>
              </li>
            ))}
          </ul>
          {decisions > 0 ? <p className="text-sm text-fg-2">{t.theyWait}</p> : null}
        </section>
      ) : null}
      {read && !batchId ? (
        <p data-proposed-decisions className="text-base text-fg-2">
          {t.didntPropose}
        </p>
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-col gap-2.5">
        {showAsk ? (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={answers.length === 0}
            pending={pending}
            pendingLabel={t.asking}
            onClick={() =>
              send(decisionRequest(answers), () => {
                setAsked(true);
                announce(t.asked);
              })
            }
          >
            {t.askToPropose}
          </Button>
        ) : null}
        <Link
          to="/p/$projectId/start/$explorationId/done"
          params={{ projectId, explorationId }}
          className={buttonClass({ variant: 'secondary', size: 'lg', className: 'w-full' })}
        >
          {t.seeStartingPoint}
          <ChevronRightIcon size={15} />
        </Link>
      </div>
    </>
  );
}

/** The person's answers so far, confirmed. */
function Answers({ questions }: { questions: Question[] }) {
  const t = useMessages(QUESTIONS);
  const confirmed = questions
    .filter((q) => q.state === 'confirmed')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return (
    <Section id="your-answers" title={t.yourAnswers}>
      {confirmed.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {confirmed.map((q) => (
            <AnswerRow key={q.id} question={q} />
          ))}
        </ul>
      ) : (
        <p className="text-base text-fg-2">{t.answersAppear}</p>
      )}
    </Section>
  );
}

/** What DEMIURGO understood, quieter: the context of the questions. */
function Understood({ messages, runId, model }: { messages: Message[]; runId: string; model: string | null }) {
  const t = useMessages(QUESTIONS);
  const { reply, observations } = writtenBy(messages, runId);
  return (
    <Section id="understood" title={t.understood}>
      <Reply reply={reply} model={model} muted />
      <ObservationList observations={observations} compact />
    </Section>
  );
}
