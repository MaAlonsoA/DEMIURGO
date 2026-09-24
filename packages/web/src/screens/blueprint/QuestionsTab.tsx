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
        variant="needs"
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
      className="inline-flex items-center gap-1 self-start px-1 text-xs font-semibold text-needs hover:text-needs-hover"
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
      ? { run: () => open('confirm'), label: `Confirm: ${shortAnswer(q.conclusion ?? '')}`, variant: 'needs' }
      : { run: () => open('answer'), label: 'Answer', variant: 'needs' },
    'question.postpone': { run: () => open('later'), label: 'Not now', variant: 'outline' },
    'question.discard': { run: () => open('drop'), label: "Doesn't apply", variant: 'ghost' },
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
          'flex flex-col gap-2.5 rounded-[var(--radius-card)] border bg-surface px-5 py-4',
          selected ? 'border-ink-3' : 'border-line',
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="flex h-6 w-4 shrink-0 items-center justify-center">
            <Mark kind={word.mark} label={word.word} />
          </span>
          <h2 id={id} className="text-[18px] leading-snug font-semibold">
            {q.question}
          </h2>
        </div>
        {(q.reason || q.impact) && (
          <div className="flex flex-col gap-0.5 pl-[26px] text-[14px] text-ink-3">
            {q.reason && <p>Why it matters: {q.reason}</p>}
            {q.impact && <p>Impact: {IMPACT_WORDS[q.impact] ?? q.impact}</p>}
          </div>
        )}
        {assumed && (
          <div
            data-recommended
            className="ml-[26px] flex flex-col gap-0.5 rounded-[var(--radius-control)] border-2 border-needs bg-needs-bg px-3 py-2"
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">
              {q.conclusion}
              <span className="rounded bg-needs-ring px-1.5 py-px text-[11px] font-bold text-needs-hover">Recommended</span>
            </span>
            {q.reasoning && <span className="text-[13px] text-ink-3">Why: {q.reasoning}</span>}
            <span className="text-xs text-muted">DEMIURGO assumed it. Nothing is confirmed until you say so.</span>
          </div>
        )}
        <ActionButtons actions={actions} handlers={handlers} className="mt-1 pl-[26px]">
          {assumed && actions.some((a) => a.command === 'question.confirm') && (
            <button
              type="button"
              data-command="question.confirm"
              onClick={() => open('change')}
              className="px-1 text-xs font-semibold text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            >
              Answer differently
            </button>
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
        <span className="text-[14px] text-ink">{q.question}</span>
        {q.state === 'confirmed' && q.conclusion && (
          <span className="text-[13px] text-ink-2">
            <span className="font-semibold">Answer: </span>
            {q.conclusion}
          </span>
        )}
        {q.state !== 'confirmed' && q.state_reason && <span className="text-xs text-muted">Reason: {q.state_reason}</span>}
      </span>
      <ActionButtons
        actions={actions}
        size="sm"
        handlers={{
          'question.discard': { run: () => open('drop'), label: "Doesn't apply", variant: 'ghost' },
          'question.reopen': { run: () => open('reopen'), label: 'Reopen', variant: 'outline' },
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
      <span className="text-xs text-muted">{label}</span>
      {children}
    </div>
  );
}

/** "If you confirm" (canvas B2, aside), with only what H1 knows and does. */
function IfYouConfirm({ q, version, readiness }: { q: Question; version: RecordVersion; readiness: Readiness | null }) {
  const id = useId();
  const citation = readinessCitation(q, version.inferred_questions, readiness);
  const checkMark = stateWord('record_version', version.state).mark;
  return (
    <section
      aria-labelledby={id}
      data-if-you-confirm
      className="sticky top-[76px] flex w-[320px] shrink-0 flex-col gap-3.5 rounded-[var(--radius-card)] border border-line bg-surface-2 p-[18px] min-[1400px]:w-[360px]"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="text-[15px] font-semibold">
          If you confirm
        </h2>
        <p className="text-xs text-ink-3">{q.question}</p>
      </div>
      <Block label="It becomes the confirmed answer in its thread">
        {q.state === 'inferred' && q.conclusion ? (
          <span className="flex items-start gap-2 text-[14px]">
            <span className="mt-[6px] flex shrink-0">
              <Mark kind="confirmed" size={8} />
            </span>
            {q.conclusion}
          </span>
        ) : (
          <span className="text-[14px] text-ink-3">The answer you write.</span>
        )}
      </Block>
      {q.impact && (
        <Block label="It affects">
          <span className="text-[14px]">{IMPACT_WORDS[q.impact] ?? q.impact} impact</span>
        </Block>
      )}
      {citation && (
        <Block label="Before it can be built">
          <span className="text-[14px]">{citation.text}</span>
          {citation.reason && <span className="text-[13px] text-ink-3">“{citation.reason}”</span>}
        </Block>
      )}
      <div className="h-px bg-line" />
      <h3 className="text-[13px] font-semibold">How we'll know it works</h3>
      {version.criteria.length === 0 ? (
        <p className="text-[13px] text-ink-3">This version has no checks yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {version.criteria.map((c) => (
            <li key={c.id} data-aside-check className="flex items-start gap-2 text-[13px]">
              <span className="mt-[5px] flex shrink-0">
                <Mark kind={checkMark} size={8} />
              </span>
              {c.title}
            </li>
          ))}
        </ul>
      )}
      <p
        data-later
        className="rounded-[var(--radius-control)] border border-dashed border-line-strong px-3 py-2 text-xs text-muted"
      >
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
        <Skeleton className="h-36 w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-36 w-full rounded-[var(--radius-card)]" />
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
              className="rounded-[var(--radius-card)] border border-line bg-surface"
            >
              <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-semibold text-ink-2">
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
          className="inline-flex items-center gap-1 self-start text-[13px] font-semibold text-needs hover:text-needs-hover"
        >
          Open the thread: {thread.data.purpose}
          <ChevronRight size={12} />
        </Link>
      </div>
      {selected && <IfYouConfirm q={selected} version={version} readiness={readiness} />}
    </div>
  );
}
