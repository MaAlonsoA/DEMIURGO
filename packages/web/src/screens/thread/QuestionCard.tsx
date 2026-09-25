// DEMIURGO's questions in the conversation (DESIGN.md §3.3, §4.4; INV-THR-25…35, D-012). An open
// question is a card: what it asks, why it matters, and its options as a real radio or checkbox
// group with a legend that says whether one or several can be picked (R93). Picking drafts the
// answer — nothing is sent until "Confirm and send". It can also be answered in the person's own
// words (the composer shows that it answers this question), talked through in "Go deeper", or
// parked, dropped and reopened from its "More actions" menu. A settled question is a quiet line
// with its state in words and its answer or reason.

import type { Question } from '../../api/types.ts';
import { useAllows } from '../../components/actions.tsx';
import { Button } from '../../components/Button.tsx';
import { ChoiceGroup } from '../../components/Field.tsx';
import { DeeperIcon, HelpIcon, PencilIcon } from '../../components/icons.tsx';
import { QuestionMenu, QuestionOutcome } from '../../components/QuestionActions.tsx';
import { EntityState } from '../../components/status.tsx';
import { cn } from '../../lib/cn.ts';
import { answerChoices, draftOf, isOpenQuestion, pickedChoices, withExclusive } from './answers.ts';
import { useDrafts } from './drafts.tsx';

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
}) {
  const drafts = useDrafts();
  const allows = useAllows('question', q.state);
  if (!isOpenQuestion(q)) return <SettledQuestion projectId={projectId} question={q} stageTitle={stageTitle} />;

  const canAnswer = !!drafts && active && allows('question.confirm');
  const choices = answerChoices(q);
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
        <span className="min-w-0 truncate">Question{stageTitle ? ` · ${stageTitle}` : ''}</span>
        <EntityState entity="question" state={q.state} />
        <span className="ml-auto">
          <QuestionMenu projectId={projectId} question={q} />
        </span>
      </header>
      <h3 id={titleId} className="text-md font-semibold text-fg">
        {q.question}
      </h3>
      {q.reason ? <p className="text-sm text-fg-2">Why it matters: {q.reason}</p> : null}

      {canAnswer && choices.length > 0 ? (
        <ChoiceGroup
          name={`answer-${q.id}`}
          legend={q.multiple ? 'Pick all that apply' : 'Pick one'}
          multiple={!!q.multiple}
          value={picked}
          columns={choices.length > 1 ? 2 : 1}
          onChange={(next) => set(draftOf(q, withExclusive(choices, picked, next)))}
          choices={choices.map((c) => ({ value: c.value, label: c.answer, detail: c.implies }))}
        />
      ) : null}

      {canAnswer && ownWords ? (
        <div className="flex items-start gap-3 rounded-md border border-edge bg-sunken px-3 py-2">
          <p className="min-w-0 flex-1 text-base whitespace-pre-wrap text-fg">
            <span className="font-medium text-fg-2">Your answer: </span>
            {draft}
          </p>
          <Button size="sm" variant="quiet" onClick={() => set(null)}>
            Clear
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
            {deeperOpen ? 'Going deeper' : 'Go deeper'}
            {sideCount > 0 ? ` · ${sideCount} ${sideCount === 1 ? 'message' : 'messages'}` : ''}
          </Button>
          <Button size="sm" variant="quiet" icon={<PencilIcon size={14} />} aria-pressed={answering} onClick={onOwnWords}>
            Answer in my own words
          </Button>
          {draft && !ownWords ? (
            <Button size="sm" variant="quiet" onClick={() => set(null)}>
              Clear
            </Button>
          ) : null}
          {draft ? <span className="ml-auto text-sm font-medium text-accent-text">Not sent yet</span> : null}
        </div>
      ) : !active ? (
        <p className="text-sm text-fg-2">This thread isn't active. Resume it to answer here.</p>
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
  return (
    <div
      id={`question-${q.id}`}
      tabIndex={-1}
      data-question={q.id}
      data-state={q.state}
      className="flex flex-col gap-1.5 rounded-lg border border-edge-subtle bg-sunken px-3.5 py-2.5 outline-offset-2"
    >
      <div className="flex items-start gap-2">
        <EntityState entity="question" state={q.state} className="mt-0.5" />
        <p className="min-w-0 flex-1 text-base text-fg">
          {q.question}
          {stageTitle ? <span className="text-sm text-fg-3"> · {stageTitle}</span> : null}
        </p>
        <QuestionMenu projectId={projectId} question={q} />
      </div>
      <QuestionOutcome question={q} className="pl-1" />
    </div>
  );
}
