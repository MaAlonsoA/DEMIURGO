// What a person can do with a question, with one vocabulary on every screen (DESIGN.md §4.4):
// Answer (an open one), Confirm or Change (DEMIURGO's assumed answer), Park (keep it for later,
// with a reason), Drop (it doesn't apply, with a reason), Reopen (a settled one). The buttons come
// from the tables; confirming is decisive, so it asks first and says what it does (R20). Used by
// Needs you, the thread and the record's Questions tab.

import { useState } from 'react';
import { useCommand } from '../api/commands.ts';
import { useMessages } from '../i18n/define.ts';
import { cn } from '../lib/cn.ts';
import { type ActionHandler, ActionBar, useAllows } from './actions.tsx';
import { announce } from './announce.tsx';
import type { ButtonSize } from './Button.tsx';
import { ConfirmDialog, PromptDialog } from './Dialog.tsx';
import { MoreIcon } from './icons.tsx';
import { Menu, MenuItem } from './Menu.tsx';
import { QUESTION_ACTIONS } from './words.i18n.ts';

export type QuestionLike = {
  id: string;
  question: string;
  state: string;
  conclusion?: string | null;
  reasoning?: string | null;
  state_reason?: string | null;
};

type DialogKind = null | 'confirm' | 'answer' | 'change' | 'park' | 'drop' | 'reopen';

/** The dialogs and the command of the question actions: shared by the buttons and the menu. */
function useQuestionCommand(projectId: string, q: QuestionLike, onDone?: (what: string) => void) {
  const t = useMessages(QUESTION_ACTIONS);
  const command = useCommand(projectId);
  const [dialog, setDialog] = useState<DialogKind>(null);
  // A promise, not mutate's callbacks: those are dropped when the card unmounts first (a confirmed or
  // parked question moves to another group), and then nothing would be announced.
  const run = (name: string, data: Record<string, unknown>, said: string) =>
    void command.mutateAsync({ command: name, entityId: q.id, data }).then(
      () => {
        setDialog(null);
        announce(said);
        onDone?.(said);
      },
      // The error stays in command.error, shown in the open dialog.
      () => undefined,
    );
  const open = (d: DialogKind) => {
    command.reset();
    setDialog(d);
  };
  const dialogs = (
    <>
      <ConfirmDialog
        open={dialog === 'confirm'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t.confirmTitle}
        description={
          <>
            <p>{q.question}</p>
            <p className="font-medium text-fg">{q.conclusion}</p>
            <p>{t.confirmAssumedBy}</p>
          </>
        }
        confirm={t.confirm}
        pendingLabel={t.confirming}
        pending={command.isPending}
        error={dialog === 'confirm' ? command.error : null}
        onConfirm={() => run('question.confirm', {}, t.answerConfirmed)}
      />
      <PromptDialog
        open={dialog === 'answer'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t.answerTitle}
        description={q.question}
        label={t.yourAnswer}
        submit={t.answer}
        pendingLabel={t.answering}
        required
        maxLength={3000}
        pending={command.isPending}
        error={dialog === 'answer' ? command.error : null}
        onSubmit={(conclusion) => run('question.confirm', { conclusion }, t.answered)}
      />
      <PromptDialog
        open={dialog === 'change'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t.changeTitle}
        description={q.question}
        label={t.yourAnswer}
        submit={t.confirmMyAnswer}
        pendingLabel={t.confirming}
        required
        initial={q.conclusion ?? ''}
        maxLength={3000}
        pending={command.isPending}
        error={dialog === 'change' ? command.error : null}
        onSubmit={(conclusion) => run('question.confirm', { conclusion }, t.yourAnswerConfirmed)}
      />
      <PromptDialog
        open={dialog === 'park'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t.parkTitle}
        description={t.parkDescription}
        label={t.reason}
        submit={t.park}
        pendingLabel={t.parking}
        required
        maxLength={1000}
        pending={command.isPending}
        error={dialog === 'park' ? command.error : null}
        onSubmit={(reason) => run('question.postpone', { reason }, t.parked)}
      />
      <PromptDialog
        open={dialog === 'drop'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t.dropTitle}
        description={t.dropDescription}
        label={t.reason}
        submit={t.drop}
        pendingLabel={t.dropping}
        required
        maxLength={1000}
        tone="danger"
        pending={command.isPending}
        error={dialog === 'drop' ? command.error : null}
        onSubmit={(reason) => run('question.discard', { reason }, t.dropped)}
      />
      <PromptDialog
        open={dialog === 'reopen'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t.reopenTitle}
        description={t.reopenDescription}
        label={t.reason}
        submit={t.reopen}
        pendingLabel={t.reopening}
        maxLength={1000}
        pending={command.isPending}
        error={dialog === 'reopen' ? command.error : null}
        onSubmit={(reason) => run('question.reopen', reason ? { reason } : {}, t.reopened)}
      />
    </>
  );
  return { open, dialogs, command };
}

/**
 * The actions of a question as buttons: the main one first (Answer or Confirm), then Change, Park,
 * Drop and Reopen as the tables allow them, in that order.
 */
export function QuestionActions({
  projectId,
  question: q,
  size = 'md',
  className,
  onDone,
  hide = [],
}: {
  projectId: string;
  question: QuestionLike;
  size?: ButtonSize;
  className?: string;
  onDone?: (what: string) => void;
  /** Actions shown elsewhere on the screen (e.g. the thread answers with its own options). */
  hide?: ('answer' | 'confirm' | 'change' | 'park' | 'drop' | 'reopen')[];
}) {
  const t = useMessages(QUESTION_ACTIONS);
  const { open, dialogs } = useQuestionCommand(projectId, q, onDone);
  const assumed = q.state === 'inferred';
  const handlers: Record<string, ActionHandler | undefined> = {
    'question.confirm': hide.includes(assumed ? 'confirm' : 'answer')
      ? undefined
      : assumed
        ? { run: () => open('confirm'), label: t.confirm, variant: 'primary' }
        : { run: () => open('answer'), label: t.answer, variant: 'primary' },
    // "Change" confirms the assumed answer with the person's own words: the same command, right after Confirm.
    'question.confirm:change':
      assumed && !hide.includes('change')
        ? { command: 'question.confirm', run: () => open('change'), label: t.change, variant: 'secondary' }
        : undefined,
    'question.postpone': hide.includes('park') ? undefined : { run: () => open('park'), label: t.park, variant: 'quiet' },
    'question.discard': hide.includes('drop') ? undefined : { run: () => open('drop'), label: t.drop, variant: 'quiet' },
    'question.reopen': hide.includes('reopen') ? undefined : { run: () => open('reopen'), label: t.reopen, variant: 'secondary' },
  };
  return (
    <div className={cn('flex flex-col gap-2', className)} data-question-actions={q.id}>
      <ActionBar entity="question" state={q.state} handlers={handlers} size={size} />
      {dialogs}
    </div>
  );
}

/** The same actions in a "More actions" menu (Park, Drop, Reopen), for places with their own main action. */
export function QuestionMenu({ projectId, question: q, label }: { projectId: string; question: QuestionLike; label?: string }) {
  const t = useMessages(QUESTION_ACTIONS);
  const { open, dialogs } = useQuestionCommand(projectId, q);
  const allows = useAllows('question', q.state);
  const items = [
    allows('question.postpone') ? { key: 'park', label: t.parkMenu, run: () => open('park') } : null,
    allows('question.discard') ? { key: 'drop', label: t.dropMenu, run: () => open('drop') } : null,
    allows('question.reopen') ? { key: 'reopen', label: t.reopenMenu, run: () => open('reopen') } : null,
  ].filter((i): i is { key: string; label: string; run: () => void } => i !== null);
  if (items.length === 0) return null;
  return (
    <>
      <Menu
        align="end"
        label={t.questionActions}
        trigger={
          <button
            type="button"
            aria-label={label ?? t.moreActions}
            data-question-menu={q.id}
            className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg"
          >
            <MoreIcon size={16} />
          </button>
        }
      >
        {items.map((i) => (
          <MenuItem key={i.key} onSelect={i.run} danger={i.key === 'drop'}>
            {i.label}
          </MenuItem>
        ))}
      </Menu>
      {dialogs}
    </>
  );
}

/** A compact line saying where a settled question stands: the answer or the reason. */
export function QuestionOutcome({
  question: q,
  className,
  reading,
}: {
  question: QuestionLike;
  className?: string;
  /** The question read in the content's language (useReading), when the caller has it. */
  reading?: { text: (key: string, original: string) => string };
}) {
  const t = useMessages(QUESTION_ACTIONS);
  const shown = (key: string, value: string) => (reading ? reading.text(key, value) : value);
  if (q.state === 'confirmed' && q.conclusion)
    return (
      <p className={cn('text-sm text-fg-2', className)}>
        <span className="font-medium text-fg">{t.answerLabel}</span>
        {shown('conclusion', q.conclusion)}
      </p>
    );
  if (q.state === 'inferred' && q.conclusion)
    return (
      <div className={cn('flex flex-col gap-0.5 text-sm text-fg-2', className)}>
        <p>
          <span className="font-medium text-fg">{t.assumedLabel}</span>
          {shown('conclusion', q.conclusion)}
        </p>
        {q.reasoning ? (
          <p className="text-fg-3">
            {t.whyLabel}
            {shown('reasoning', q.reasoning)}
          </p>
        ) : null}
      </div>
    );
  if ((q.state === 'postponed' || q.state === 'discarded') && q.state_reason)
    return (
      <p className={cn('text-sm text-fg-2', className)}>
        <span className="font-medium text-fg">{t.reasonLabel}</span>
        {q.state_reason}
      </p>
    );
  return null;
}
