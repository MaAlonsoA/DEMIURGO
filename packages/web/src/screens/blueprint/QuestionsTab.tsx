// The Questions of a record (canvas B2): the questions of the thread its version comes from,
// answered in place. An open question is a card: the question, why it matters, its impact and,
// when DEMIURGO assumed an answer, that answer as the recommended one with its why. The actions
// come from the tables: Confirm (decisive: it asks first), Not now and Doesn't apply (they ask a
// reason). Beside it, "If you confirm" says only what H1 does when the person confirms.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { explorationQuery } from '../../api/queries.ts';
import type { Question, Readiness, RecordVersion } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { type ActionHandler, ActionButtons, useActions } from '../../ui/ActionBar.tsx';
import { Button } from '../../ui/Button.tsx';
import { ChevronRight } from '../../ui/icons.tsx';
import { EmptyState, Skeleton } from '../../ui/layout.tsx';
import { ConfirmDialog, TextDialog } from '../../ui/dialogs.tsx';
import { Mark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { stateWord } from '../../words.ts';
import { IMPACT_WORDS, questionGroups, readinessCitation, shortAnswer } from './questions.ts';

type Dialog = null | 'confirm' | 'answer' | 'change' | 'later' | 'drop' | 'reopen';

/** The dialogs of a question's actions, shared by its card and its row once settled. */
function useQuestionActions(projectId: string, q: Question) {
  const command = useCommand(projectId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const open = (d: Dialog) => {
    command.reset();
    setDialog(d);
  };
  const run = (name: string, data: Record<string, unknown>) =>
    command.mutate({ command: name, entityId: q.id, data }, { onSuccess: () => setDialog(null) });
  const close = (o: boolean) => {
    if (!o) setDialog(null);
  };
  const error = dialog ? command.error : null;
  const dialogs = (
    <>
      <ConfirmDialog
        open={dialog === 'confirm'}
        onOpenChange={close}
        title="Confirm this answer?"
        description={
          <>
            <p>{q.question}</p>
            <p className="mt-2 font-semibold text-ink">{q.conclusion}</p>
            <p className="mt-2">DEMIURGO assumed it. Confirming makes it your answer in the thread.</p>
          </>
        }
        confirm="Confirm"
        pending={command.isPending}
        error={error}
        onConfirm={() => run('question.confirm', {})}
      />
      <TextDialog
        open={dialog === 'answer' || dialog === 'change'}
        onOpenChange={close}
        title={dialog === 'change' ? 'Answer differently' : 'Answer the question'}
        description={q.question}
        label="Conclusion"
        submit={dialog === 'change' ? 'Confirm my answer' : 'Answer'}
        required
        initial={dialog === 'change' ? (q.conclusion ?? '') : ''}
        maxLength={3000}
        variant="primary"
        pending={command.isPending}
        error={error}
        onSubmit={(text) => run('question.confirm', { conclusion: text })}
      />
      <TextDialog
        open={dialog === 'later'}
        onOpenChange={close}
        title="Leave it for later"
        description="It stays in the thread for later, and it still keeps the feature from being ready. Say why."
        label="Reason"
        submit="Leave it for later"
        required
        maxLength={1000}
        pending={command.isPending}
        error={error}
        onSubmit={(text) => run('question.postpone', { reason: text })}
      />
      <TextDialog
        open={dialog === 'drop'}
        onOpenChange={close}
        title="Doesn't apply"
        description="It stays in the thread, marked as not applying. Say why."
        label="Reason"
        submit="Doesn't apply"
        required
        maxLength={1000}
        pending={command.isPending}
        error={error}
        onSubmit={(text) => run('question.discard', { reason: text })}
      />
      <TextDialog
        open={dialog === 'reopen'}
        onOpenChange={close}
        title="Reopen this question"
        description="Its history is kept. The answer has to be given again."
        label="Reason"
        submit="Reopen"
        maxLength={1000}
        pending={command.isPending}
        error={error}
        onSubmit={(text) => run('question.reopen', text ? { reason: text } : {})}
      />
    </>
  );
  return { open, dialogs };
}

function ThreadLink({ projectId, threadId }: { projectId: string; threadId: string }) {
  return (
    <Link
      to="/p/$projectId/threads/$explorationId"
      params={{ projectId, explorationId: threadId }}
      className="dm-text-caption inline-flex items-center gap-1 self-start px-1 font-semibold text-needs-strong hover:underline"
    >
      Talk about it in the thread
      <ChevronRight size={11} />
    </Link>
  );
}

function OpenQuestion({
  projectId,
  q,
  selected,
  onSelect,
}: {
  projectId: string;
  q: Question;
  selected: boolean;
  onSelect: () => void;
}) {
  const id = useId();
  const actions = useActions('question', q.state);
  const { open, dialogs } = useQuestionActions(projectId, q);
  const word = stateWord('question', q.state);
  const assumed = q.state === 'inferred' && !!q.conclusion;
  const handlers: Record<string, ActionHandler | undefined> = {
    'question.confirm': assumed
      ? { run: () => open('confirm'), label: `Confirm: ${shortAnswer(q.conclusion ?? '')}`, variant: 'primary' }
      : { run: () => open('answer'), label: 'Answer', variant: 'primary' },
    'question.postpone': { run: () => open('later'), label: 'Not now', variant: 'secondary' },
    'question.discard': { run: () => open('drop'), label: "Doesn't apply", variant: 'text' },
  };
  return (
    <div data-question={q.id} data-state={q.state} className="flex flex-col gap-1.5">
      {/* A click or the focus anywhere on the card makes it the question "If you confirm" talks about. */}
      <article
        aria-labelledby={id}
        onClick={onSelect}
        onFocus={onSelect}
        data-selected={selected ? 'true' : undefined}
        className={cn(
          'flex flex-col gap-2.5 rounded-card-md border bg-surface px-5 py-4',
          selected ? 'border-ink-3' : 'border-line',
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="flex h-6 w-4 shrink-0 items-center justify-center">
            <Mark kind={word.mark} label={word.word} />
          </span>
          <h2 id={id} className="dm-text-heading">
            {q.question}
          </h2>
        </div>
        {(q.reason || q.impact) && (
          <div className="dm-text-body flex flex-col gap-0.5 pl-[26px] text-ink-3">
            {q.reason && <p>Why it matters: {q.reason}</p>}
            {q.impact && <p>Impact: {IMPACT_WORDS[q.impact] ?? q.impact}</p>}
          </div>
        )}
        {assumed && (
          <div
            data-recommended
            className="ml-[26px] flex flex-col gap-0.5 rounded-card-md border-2 border-needs bg-needs-soft px-3 py-2"
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">
              {q.conclusion}
              <span className="dm-rec">Recommended</span>
            </span>
            {q.reasoning && <span className="dm-text-small text-ink-3">Why: {q.reasoning}</span>}
            <span className="dm-text-caption text-muted">DEMIURGO assumed it. Nothing is confirmed until you say so.</span>
          </div>
        )}
        <ActionButtons actions={actions} handlers={handlers} className="mt-1 pl-[26px]">
          {assumed && actions.some((a) => a.command === 'question.confirm') && (
            <Button variant="text" data-command="question.confirm" onClick={() => open('change')}>
              Answer differently
            </Button>
          )}
        </ActionButtons>
        {dialogs}
      </article>
      <ThreadLink projectId={projectId} threadId={q.exploration_id} />
    </div>
  );
}

function SettledRow({ projectId, q }: { projectId: string; q: Question }) {
  const actions = useActions('question', q.state);
  const { open, dialogs } = useQuestionActions(projectId, q);
  const word = stateWord('question', q.state);
  return (
    <li data-question={q.id} data-state={q.state} className="flex items-start gap-2.5 px-4 py-2.5">
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">
        <Mark kind={word.mark} label={word.word} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="dm-text-body text-ink">{q.question}</span>
        {q.state === 'confirmed' && q.conclusion && (
          <span className="dm-text-small text-ink-2">
            <span className="font-semibold">Answer: </span>
            {q.conclusion}
          </span>
        )}
        {q.state !== 'confirmed' && q.state_reason && (
          <span className="dm-text-caption text-muted">Reason: {q.state_reason}</span>
        )}
      </span>
      <ActionButtons
        actions={actions}
        handlers={{
          'question.discard': { run: () => open('drop'), label: "Doesn't apply", variant: 'text' },
          'question.reopen': { run: () => open('reopen'), label: 'Reopen', variant: 'secondary' },
        }}
      />
      {dialogs}
    </li>
  );
}

const GROUPS = [
  { key: 'answered', label: 'Answered' },
  { key: 'notNow', label: 'Not now', attr: 'not-now' },
  { key: 'doesNotApply', label: "Doesn't apply", attr: 'doesnt-apply' },
] as const;

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="dm-text-caption text-muted">{label}</span>
      {children}
    </div>
  );
}

/** "If you confirm" (canvas B2, aside), with only what H1 knows and does. */
function IfYouConfirm({ q, version, readiness }: { q: Question; version: RecordVersion; readiness: Readiness | null }) {
  const id = useId();
  const citation = readinessCitation(q, readiness);
  const checkMark = stateWord('record_version', version.state).mark;
  return (
    <section
      aria-labelledby={id}
      data-if-you-confirm
      className="sticky top-[76px] flex w-[320px] shrink-0 flex-col gap-3.5 rounded-card-md border border-line bg-surface-soft p-[18px] min-[1400px]:w-[360px]"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="dm-text-heading">
          If you confirm
        </h2>
        <p className="dm-text-caption text-ink-3">{q.question}</p>
      </div>
      <Block label="It becomes the confirmed answer in its thread">
        {q.state === 'inferred' && q.conclusion ? (
          <span className="dm-text-body flex items-start gap-2">
            <span className="mt-[6px] flex shrink-0">
              <Mark kind="confirmed" size={8} />
            </span>
            {q.conclusion}
          </span>
        ) : (
          <span className="dm-text-body text-ink-3">The answer you write.</span>
        )}
      </Block>
      {q.impact && (
        <Block label="It affects">
          <span className="dm-text-body">{IMPACT_WORDS[q.impact] ?? q.impact} impact</span>
        </Block>
      )}
      {citation && (
        <Block label="Before it can be built">
          <span className="dm-text-body">{citation.text}</span>
          {citation.reason && <span className="dm-text-small text-ink-3">{citation.reason}</span>}
        </Block>
      )}
      <div className="h-px bg-line" />
      <h3 className="dm-text-small font-semibold">How we'll know it works</h3>
      {version.criteria.length === 0 ? (
        <p className="dm-text-small text-ink-3">This version has no checks yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {version.criteria.map((c) => (
            <li key={c.id} data-aside-check className="dm-text-small flex items-start gap-2">
              <span className="mt-[5px] flex shrink-0">
                <Mark kind={checkMark} size={8} />
              </span>
              {c.title}
            </li>
          ))}
        </ul>
      )}
      <p data-later className="dm-text-caption rounded-control border border-dashed border-line-strong px-3 py-2 text-muted">
        <span className="font-semibold text-ink-3">Later</span> · Becomes a decision and adds checks on its own (later increment).
        Today confirming only answers the question.
      </p>
    </section>
  );
}

export function QuestionsTab({
  projectId,
  version,
  readiness,
}: {
  projectId: string;
  version: RecordVersion;
  readiness: Readiness | null;
}) {
  const threadId = version.origin_exploration;
  const thread = useQuery({ ...explorationQuery(projectId, threadId ?? ''), enabled: !!threadId });
  const [chosen, setChosen] = useState<string | null>(null);
  if (!threadId) return <EmptyState>This version doesn't come from a thread, so it has no questions.</EmptyState>;
  if (thread.error) return <Reasons error={thread.error} />;
  if (!thread.data) {
    return (
      <div role="status" aria-label="Loading the questions" className="flex flex-col gap-3">
        <Skeleton className="h-36 w-full rounded-card-md" />
        <Skeleton className="h-36 w-full rounded-card-md" />
      </div>
    );
  }
  const groups = questionGroups(thread.data.questions);
  const selected = groups.open.find((q) => q.id === chosen) ?? groups.open[0];
  return (
    <div className="flex items-start gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        {groups.open.length === 0 ? (
          <EmptyState>Nothing to answer here: no question of its thread is open.</EmptyState>
        ) : (
          <div data-open-questions className="flex flex-col gap-5">
            {groups.open.map((q) => (
              <OpenQuestion
                key={q.id}
                projectId={projectId}
                q={q}
                selected={q.id === selected?.id}
                onSelect={() => setChosen(q.id)}
              />
            ))}
          </div>
        )}
        {GROUPS.map((g) => {
          const list = groups[g.key];
          if (list.length === 0) return null;
          return (
            <details
              key={g.key}
              data-group={'attr' in g ? g.attr : g.key}
              className="rounded-card-md border border-line bg-surface"
            >
              <summary className="dm-text-small cursor-pointer px-4 py-2.5 font-semibold text-ink-2">
                {g.label} · {list.length}
              </summary>
              <ul className="flex flex-col divide-y divide-line-soft border-t border-line-soft">
                {list.map((q) => (
                  <SettledRow key={q.id} projectId={projectId} q={q} />
                ))}
              </ul>
            </details>
          );
        })}
        <Link
          to="/p/$projectId/threads/$explorationId"
          params={{ projectId, explorationId: threadId }}
          className="dm-text-small inline-flex items-center gap-1 self-start font-semibold text-needs-strong hover:underline"
        >
          Open the thread: {thread.data.purpose}
          <ChevronRight size={12} />
        </Link>
      </div>
      {selected && <IfYouConfirm q={selected} version={version} readiness={readiness} />}
    </div>
  );
}
