// What a person can do with a question, with one vocabulary on every screen (DESIGN.md §4.4):
// Answer (an open one), Confirm or Change (DEMIURGO's assumed answer), Park (keep it for later,
// with a reason), Drop (it doesn't apply, with a reason), Reopen (a settled one). The buttons come
// from the tables; confirming is decisive, so it asks first and says what it does (R20). Used by
// Needs you, the thread and the record's Questions tab.

import { useState } from 'react';
import { useCommand } from '../api/commands.ts';
import { cn } from '../lib/cn.ts';
import { type ActionHandler, ActionBar, useAllows } from './actions.tsx';
import { announce } from './announce.tsx';
import { Button, type ButtonSize } from './Button.tsx';
import { ConfirmDialog, PromptDialog } from './Dialog.tsx';
import { MoreIcon } from './icons.tsx';
import { Menu, MenuItem } from './Menu.tsx';

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
  const command = useCommand(projectId);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const run = (name: string, data: Record<string, unknown>, said: string) =>
    command.mutate(
      { command: name, entityId: q.id, data },
      {
        onSuccess: () => {
          setDialog(null);
          announce(said);
          onDone?.(said);
        },
      },
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
        title="Confirm this answer?"
        description={
          <>
            <p>{q.question}</p>
            <p className="font-medium text-fg">{q.conclusion}</p>
            <p>DEMIURGO assumed it. Confirming makes it your answer.</p>
          </>
        }
        confirm="Confirm"
        pendingLabel="Confirming…"
        pending={command.isPending}
        error={dialog === 'confirm' ? command.error : null}
        onConfirm={() => run('question.confirm', {}, 'Answer confirmed.')}
      />
      <PromptDialog
        open={dialog === 'answer'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Answer the question"
        description={q.question}
        label="Your answer"
        submit="Answer"
        pendingLabel="Answering…"
        required
        maxLength={3000}
        pending={command.isPending}
        error={dialog === 'answer' ? command.error : null}
        onSubmit={(conclusion) => run('question.confirm', { conclusion }, 'Answered.')}
      />
      <PromptDialog
        open={dialog === 'change'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Change the assumed answer"
        description={q.question}
        label="Your answer"
        submit="Confirm my answer"
        pendingLabel="Confirming…"
        required
        initial={q.conclusion ?? ''}
        maxLength={3000}
        pending={command.isPending}
        error={dialog === 'change' ? command.error : null}
        onSubmit={(conclusion) => run('question.confirm', { conclusion }, 'Your answer is confirmed.')}
      />
      <PromptDialog
        open={dialog === 'park'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Park this question"
        description="It stays open for later, and it keeps blocking what depends on it. Say why."
        label="Reason"
        submit="Park"
        pendingLabel="Parking…"
        required
        maxLength={1000}
        pending={command.isPending}
        error={dialog === 'park' ? command.error : null}
        onSubmit={(reason) => run('question.postpone', { reason }, 'Question parked.')}
      />
      <PromptDialog
        open={dialog === 'drop'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Drop this question"
        description="It doesn't apply. It stays in its thread, marked as dropped. Say why."
        label="Reason"
        submit="Drop"
        pendingLabel="Dropping…"
        required
        maxLength={1000}
        tone="danger"
        pending={command.isPending}
        error={dialog === 'drop' ? command.error : null}
        onSubmit={(reason) => run('question.discard', { reason }, 'Question dropped.')}
      />
      <PromptDialog
        open={dialog === 'reopen'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reopen this question"
        description="Its history is kept. The answer has to be given again."
        label="Reason"
        submit="Reopen"
        pendingLabel="Reopening…"
        maxLength={1000}
        pending={command.isPending}
        error={dialog === 'reopen' ? command.error : null}
        onSubmit={(reason) => run('question.reopen', reason ? { reason } : {}, 'Question reopened.')}
      />
    </>
  );
  return { open, dialogs, command };
}

/**
 * The actions of a question as buttons: the main one first (Answer or Confirm), then Change, Park,
 * Drop and Reopen as the tables allow them.
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
  const { open, dialogs } = useQuestionCommand(projectId, q, onDone);
  const allows = useAllows('question', q.state);
  const assumed = q.state === 'inferred';
  const handlers: Record<string, ActionHandler | undefined> = {
    'question.confirm': hide.includes(assumed ? 'confirm' : 'answer')
      ? undefined
      : assumed
        ? { run: () => open('confirm'), label: 'Confirm', variant: 'primary' }
        : { run: () => open('answer'), label: 'Answer', variant: 'primary' },
    'question.postpone': hide.includes('park') ? undefined : { run: () => open('park'), label: 'Park', variant: 'quiet' },
    'question.discard': hide.includes('drop') ? undefined : { run: () => open('drop'), label: 'Drop', variant: 'quiet' },
    'question.reopen': hide.includes('reopen') ? undefined : { run: () => open('reopen'), label: 'Reopen', variant: 'secondary' },
  };
  return (
    <div className={cn('flex flex-col gap-2', className)} data-question-actions={q.id}>
      <ActionBar entity="question" state={q.state} handlers={handlers} size={size}>
        {/* "Change" confirms the assumed answer with the person's own words: the same command. */}
        {assumed && allows('question.confirm') && !hide.includes('change') ? (
          <Button size={size} variant="secondary" data-command="question.confirm" onClick={() => open('change')}>
            Change
          </Button>
        ) : null}
      </ActionBar>
      {dialogs}
    </div>
  );
}

/** The same actions in a "More actions" menu (Park, Drop, Reopen), for places with their own main action. */
export function QuestionMenu({ projectId, question: q, label }: { projectId: string; question: QuestionLike; label?: string }) {
  const { open, dialogs } = useQuestionCommand(projectId, q);
  const allows = useAllows('question', q.state);
  const items = [
    allows('question.postpone') ? { key: 'park', label: 'Park…', run: () => open('park') } : null,
    allows('question.discard') ? { key: 'drop', label: 'Drop…', run: () => open('drop') } : null,
    allows('question.reopen') ? { key: 'reopen', label: 'Reopen…', run: () => open('reopen') } : null,
  ].filter((i): i is { key: string; label: string; run: () => void } => i !== null);
  if (items.length === 0) return null;
  return (
    <>
      <Menu
        align="end"
        label="Question actions"
        trigger={
          <button
            type="button"
            aria-label={label ?? 'More actions for this question'}
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
export function QuestionOutcome({ question: q, className }: { question: QuestionLike; className?: string }) {
  if (q.state === 'confirmed' && q.conclusion)
    return (
      <p className={cn('text-sm text-fg-2', className)}>
        <span className="font-medium text-fg">Answer: </span>
        {q.conclusion}
      </p>
    );
  if (q.state === 'inferred' && q.conclusion)
    return (
      <div className={cn('flex flex-col gap-0.5 text-sm text-fg-2', className)}>
        <p>
          <span className="font-medium text-fg">Assumed: </span>
          {q.conclusion}
        </p>
        {q.reasoning ? <p className="text-fg-3">Why: {q.reasoning}</p> : null}
      </div>
    );
  if ((q.state === 'postponed' || q.state === 'discarded') && q.state_reason)
    return (
      <p className={cn('text-sm text-fg-2', className)}>
        <span className="font-medium text-fg">Reason: </span>
        {q.state_reason}
      </p>
    );
  return null;
}
