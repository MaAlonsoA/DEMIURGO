// A question with its mark and its actions in place (spec §4.7): Answer confirms with the
// conclusion, Park and Drop ask for a reason, Reopen brings it back; an assumed (inferred) one
// offers Confirm (decisive, so it asks first) and Change. The buttons come from the tables.

import { useState } from 'react';
import { useCommand } from '../api/commands.ts';
import { cn } from '../lib/cn.ts';
import { stateWord } from '../words.ts';
import { type ActionHandler, ActionBar, useAllows } from './ActionBar.tsx';
import { Button } from './Button.tsx';
import { ConfirmDialog, TextDialog } from './dialogs.tsx';
import { Mark } from './marks.tsx';
import { Reasons } from './Reasons.tsx';

export type QuestionLike = {
  id: string;
  question: string;
  state: string;
  conclusion?: string | null;
  reasoning?: string | null;
  reason?: string | null;
  impact?: string | null;
  state_reason?: string | null;
};

type Dialog = null | 'confirm' | 'answer' | 'change' | 'park' | 'drop' | 'reopen';

export function QuestionItem({
  projectId,
  question: q,
  compact = false,
  className,
}: {
  projectId: string;
  question: QuestionLike;
  compact?: boolean;
  className?: string;
}) {
  const command = useCommand(projectId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [inlineError, setInlineError] = useState<unknown>(null);
  const allows = useAllows('question', q.state);
  const word = stateWord('question', q.state);

  const run = (name: string, data: Record<string, unknown>, fromDialog: boolean) => {
    setInlineError(null);
    command.mutate(
      { command: name, entityId: q.id, data },
      {
        onSuccess: () => setDialog(null),
        onError: (e) => {
          if (!fromDialog) setInlineError(e);
        },
      },
    );
  };

  const open = (d: Dialog) => {
    command.reset();
    setDialog(d);
  };

  const assumed = q.state === 'inferred';
  const handlers: Record<string, ActionHandler> = assumed
    ? {
        // Confirming is decisive: it asks before turning DEMIURGO's assumption into the person's answer.
        'question.confirm': { run: () => open('confirm'), label: 'Confirm', variant: 'primary' },
        'question.postpone': { run: () => open('park'), label: 'Park', variant: 'text' },
        'question.discard': { run: () => open('drop'), label: 'Drop', variant: 'text' },
      }
    : {
        'question.confirm': { run: () => open('answer'), label: 'Answer', variant: 'primary' },
        'question.postpone': { run: () => open('park'), label: 'Park', variant: 'text' },
        'question.discard': { run: () => open('drop'), label: 'Drop', variant: 'text' },
        'question.reopen': { run: () => open('reopen'), label: 'Reopen', variant: 'secondary' },
      };

  const dialogError = dialog ? command.error : null;

  return (
    <div data-question={q.id} data-state={q.state} className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-start gap-2">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          <Mark kind={word.mark} label={word.word} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className={cn('dm-text-body leading-snug text-ink', compact && 'dm-text-small')}>{q.question}</p>
          {q.conclusion && (
            <p className="dm-text-small text-ink-2">
              <span className="font-semibold">{assumed ? 'Assumed: ' : 'Answer: '}</span>
              {q.conclusion}
            </p>
          )}
          {!compact && assumed && q.reasoning && <p className="dm-text-caption text-muted">Why: {q.reasoning}</p>}
          {q.state_reason && ['postponed', 'discarded'].includes(q.state) && (
            <p className="dm-text-caption text-muted">Reason: {q.state_reason}</p>
          )}
          <ActionBar entity="question" state={q.state} handlers={handlers} className="mt-1">
            {/* "Change" confirms the assumed answer with the person's own words: the same command. */}
            {assumed && allows('question.confirm') && (
              <Button variant="secondary" data-command="question.confirm" onClick={() => open('change')}>
                Change
              </Button>
            )}
          </ActionBar>
          {inlineError ? <Reasons error={inlineError} className="mt-1" /> : null}
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'confirm'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Confirm this answer?"
        description={
          <>
            <p>{q.question}</p>
            <p className="mt-2 font-semibold text-ink">{q.conclusion}</p>
            <p className="mt-2">DEMIURGO assumed it. Confirming makes it your answer.</p>
          </>
        }
        confirm="Confirm"
        pending={command.isPending}
        error={dialogError}
        onConfirm={() => run('question.confirm', {}, true)}
      />
      <TextDialog
        open={dialog === 'answer' || dialog === 'change'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === 'change' ? 'Change the assumed answer' : 'Answer the question'}
        description={q.question}
        label="Conclusion"
        submit={dialog === 'change' ? 'Confirm my answer' : 'Answer'}
        required
        initial={dialog === 'change' ? (q.conclusion ?? '') : ''}
        maxLength={3000}
        variant="primary"
        pending={command.isPending}
        error={dialogError}
        onSubmit={(text) => run('question.confirm', { conclusion: text }, true)}
      />
      <TextDialog
        open={dialog === 'park'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Park this question"
        description="It stays open for later. Say why."
        label="Reason"
        submit="Park"
        required
        maxLength={1000}
        pending={command.isPending}
        error={dialogError}
        onSubmit={(text) => run('question.postpone', { reason: text }, true)}
      />
      <TextDialog
        open={dialog === 'drop'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Drop this question"
        description="It doesn't apply. Say why."
        label="Reason"
        submit="Drop"
        required
        maxLength={1000}
        pending={command.isPending}
        error={dialogError}
        onSubmit={(text) => run('question.discard', { reason: text }, true)}
      />
      <TextDialog
        open={dialog === 'reopen'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reopen this question"
        description="Its history is kept. The answer has to be given again."
        label="Reason"
        submit="Reopen"
        maxLength={1000}
        pending={command.isPending}
        error={dialogError}
        onSubmit={(text) => run('question.reopen', text ? { reason: text } : {}, true)}
      />
    </div>
  );
}
