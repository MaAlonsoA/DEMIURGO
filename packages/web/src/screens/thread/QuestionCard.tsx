// DEMIURGO's questions in the conversation (DESIGN.md §3.3, §4.4; INV-THR-25…35, D-012). An open
// question is a card: what it asks, why it matters, and its options as a real radio or checkbox
// group with a legend that says whether one or several can be picked (R93). Picking drafts the
// answer — nothing is sent until "Confirm and send". It can also be answered in the person's own
// words (the composer shows that it answers this question), talked through in "Go deeper",
// explained in plain words ("Explain it simply", which opens Go deeper with the explanation), or
// parked, dropped and reopened from its "More actions" menu. A settled question is a quiet line
// with its state in words and its answer or reason.

import type { Question } from '../../api/types.ts';
import { useAllows } from '../../components/actions.tsx';
import { Button } from '../../components/Button.tsx';
import { ChoiceGroup } from '../../components/Field.tsx';
import { DeeperIcon, HelpIcon, PencilIcon } from '../../components/icons.tsx';
import { QuestionMenu, QuestionOutcome } from '../../components/QuestionActions.tsx';
import { EntityState } from '../../components/status.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useReading } from '../../i18n/reading.tsx';
import { cn } from '../../lib/cn.ts';
import { ExplainButton } from './Explain.tsx';
import { ASSUMED, answerChoices, draftOf, isOpenQuestion, pickedChoices, withExclusive } from './answers.ts';
import { useDrafts } from './drafts.tsx';
import { ANSWER_WORDS, QUESTION_CARD } from './words.i18n.ts';

export function QuestionCard({
  projectId,
  question: q,
  active,
  stageTitle,
  deeperOpen,
  sideCount,
  answering,
  onDeeper,
  onOwnWords,
  onExplain,
  explaining,
}: {
  projectId: string;
  question: Question;
  /** The thread is active: only then is it answered here. */
  active: boolean;
  stageTitle: string | null;
  deeperOpen: boolean;
  /** Messages of its side conversation so far. */
  sideCount: number;
  /** The composer is answering this question. */
  answering: boolean;
  onDeeper: () => void;
  onOwnWords: () => void;
  onExplain: () => void;
  /** An explanation is being asked for right now. */
  explaining: boolean;
}) {
  const t = useMessages(QUESTION_CARD);
  const answerWords = useMessages(ANSWER_WORDS);
  const drafts = useDrafts();
  const allows = useAllows('question', q.state);
  const reading = useReading(projectId, 'question', q.id);
  if (!isOpenQuestion(q)) return <SettledQuestion projectId={projectId} question={q} stageTitle={stageTitle} />;

  const canAnswer = !!drafts && active && allows('question.confirm');
  const choices = answerChoices(q, answerWords);
  const draft = drafts?.answers[q.id];
  const picked = pickedChoices(q, draft);
  const ownWords = !!draft && picked.length === 0;
  const set = (text: string | null) => drafts?.setAnswer(q.id, text);
  const titleId = `question-${q.id}-title`;

  return (
    <article
      id={`question-${q.id}`}
      tabIndex={-1}
      data-question={q.id}
      data-trace={`question:${q.id}`}
      data-draft={draft ? 'true' : undefined}
      aria-labelledby={titleId}
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-panel p-4 outline-offset-2',
        active ? 'border-accent-edge' : 'border-edge',
        answering && 'border-accent',
      )}
    >
      <header className="flex items-center gap-2 text-sm text-fg-2">
        <HelpIcon size={15} className="shrink-0 text-accent-text" />
        <span className="min-w-0 truncate">
          {t.question}
          {stageTitle ? ` · ${stageTitle}` : ''}
        </span>
        <EntityState entity="question" state={q.state} />
        <span className="ml-auto">
          <QuestionMenu projectId={projectId} question={q} />
        </span>
      </header>
      <h3 id={titleId} className="text-md font-semibold text-fg">
        {reading.text('question', q.question)}
      </h3>
      {q.reason ? (
        <p className="text-sm text-fg-2">
          {t.whyItMatters}
          {reading.text('reason', q.reason)}
        </p>
      ) : null}
      {reading.mark ? <div>{reading.mark}</div> : null}

      {canAnswer && choices.length > 0 ? (
        <ChoiceGroup
          name={`answer-${q.id}`}
          legend={q.multiple ? t.pickAll : t.pickOne}
          multiple={!!q.multiple}
          value={picked}
          columns={choices.length > 1 ? 2 : 1}
          onChange={(next) => set(draftOf(q, withExclusive(choices, picked, next)))}
          choices={choices.map((c) => ({
            value: c.value,
            label: (
              <>
                {c.value === ASSUMED ? reading.text('conclusion', c.answer) : reading.text(`options.${c.value}.answer`, c.answer)}
                {c.recommended ? <span className="ml-2 text-sm font-medium text-accent-text">{t.recommended}</span> : null}
              </>
            ),
            detail: (
              <>
                {c.value === ASSUMED ? c.implies : reading.text(`options.${c.value}.implies`, c.implies)}
                {c.downside ? (
                  <span className="block text-fg-3">
                    {t.downside}
                    {c.downside}
                  </span>
                ) : null}
              </>
            ),
          }))}
        />
      ) : null}

      {canAnswer && ownWords ? (
        <div className="flex items-start gap-3 rounded-md border border-edge bg-sunken px-3 py-2">
          <p className="min-w-0 flex-1 text-base whitespace-pre-wrap text-fg">
            <span className="font-medium text-fg-2">{t.yourAnswer}</span>
            {draft}
          </p>
          <Button size="sm" variant="quiet" onClick={() => set(null)}>
            {t.clear}
          </Button>
        </div>
      ) : null}

      {canAnswer ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={deeperOpen ? 'secondary' : 'quiet'}
            icon={<DeeperIcon size={14} />}
            aria-expanded={deeperOpen}
            {...(deeperOpen ? { 'aria-controls': 'thread-deeper' } : {})}
            data-deeper-button={q.id}
            onClick={onDeeper}
          >
            {deeperOpen ? t.goingDeeper : t.goDeeper}
            {sideCount > 0 ? t.messagesCount(sideCount) : ''}
          </Button>
          <ExplainButton question={q} pending={explaining} onExplain={onExplain} />
          <Button size="sm" variant="quiet" icon={<PencilIcon size={14} />} aria-pressed={answering} onClick={onOwnWords}>
            {t.answerOwnWords}
          </Button>
          {draft && !ownWords ? (
            <Button size="sm" variant="quiet" onClick={() => set(null)}>
              {t.clear}
            </Button>
          ) : null}
          {draft ? <span className="ml-auto text-sm font-medium text-accent-text">{t.notSentYet}</span> : null}
        </div>
      ) : !active ? (
        <p className="text-sm text-fg-2">{t.notActive}</p>
      ) : null}
    </article>
  );
}

/** A settled question: what was asked, its state in words and what was answered or why. */
function SettledQuestion({
  projectId,
  question: q,
  stageTitle,
}: {
  projectId: string;
  question: Question;
  stageTitle: string | null;
}) {
  const reading = useReading(projectId, 'question', q.id);
  return (
    <div
      id={`question-${q.id}`}
      tabIndex={-1}
      data-question={q.id}
      data-trace={`question:${q.id}`}
      data-state={q.state}
      className="flex flex-col gap-1.5 rounded-lg border border-edge-subtle bg-sunken px-3.5 py-2.5 outline-offset-2"
    >
      <div className="flex items-start gap-2">
        <EntityState entity="question" state={q.state} className="mt-0.5" />
        <p className="min-w-0 flex-1 text-base text-fg">
          {reading.text('question', q.question)}
          {stageTitle ? <span className="text-sm text-fg-3"> · {stageTitle}</span> : null}
        </p>
        <QuestionMenu projectId={projectId} question={q} />
      </div>
      <QuestionOutcome question={q} className="pl-1" reading={reading} />
      {reading.mark ? <div className="pl-1">{reading.mark}</div> : null}
    </div>
  );
}
