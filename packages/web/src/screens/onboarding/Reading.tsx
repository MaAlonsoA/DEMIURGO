// DEMIURGO reading the idea (DESIGN.md §3.9, §4.2): the idea as written and the card of what
// DEMIURGO is doing. It waits while the durable response waits for the knowledge; while the run
// works it shows the run's state (Working, or Stalled when this tab hears nothing for 90 s), the
// live progress («Thinking… 1,240 tokens · 0:12»), the elapsed time and Cancel — which asks first
// and says what is kept. Its steps fill in as the stream brings the reading, every item with its
// real state in words. A reading that stopped is a card with the reason in product words and
// Retry. The compact status says the same inside the other screens of the day.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { progressText, useRunProgress } from '../../api/progress.ts';
import { batchQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Message, Question, RunListItem } from '../../api/types.ts';
import { ActionBar } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Button, type ButtonSize } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { ArrowRightIcon, ChevronRightIcon, RetryIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { RunStateBadge } from '../../components/runState.tsx';
import { EntityState, StateIcon, StatusBadge } from '../../components/status.tsx';
import { Elapsed, RelativeTime, useNow } from '../../components/Time.tsx';
import { WhoAvatar } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import { between, dayTime } from '../../lib/time.ts';
import { failureWord } from '../../words.ts';
import { proposalTitle } from '../batch/model.ts';
import type { Reading } from './day.ts';
import { ObservationList } from './parts.tsx';

export type Subject = 'idea' | 'correction' | 'decisions';

const CATCHING_UP = 'DEMIURGO is catching up on what you just decided…';

const WORDS: Record<Subject, { waiting: string; working: string; failed: string; cancelled: string; unanswered: string }> = {
  idea: {
    waiting: 'Waiting for DEMIURGO…',
    working: 'Reading your idea…',
    failed: "I couldn't finish reading your idea",
    cancelled: 'You stopped the reading',
    unanswered: "DEMIURGO hasn't read your idea yet",
  },
  correction: {
    waiting: 'Waiting for DEMIURGO…',
    working: 'Reading your correction…',
    failed: "I couldn't finish reading your correction",
    cancelled: 'You stopped the reading',
    unanswered: "DEMIURGO hasn't read your correction yet",
  },
  decisions: {
    waiting: 'Waiting for DEMIURGO…',
    working: 'Proposing decisions…',
    failed: "I couldn't finish proposing decisions",
    cancelled: 'You stopped it',
    unanswered: "DEMIURGO hasn't answered yet",
  },
};

export type ReadingContent = {
  reply: Message | null;
  observations: Message[];
  questions: Question[];
  batchId: string | null;
  model: string | null;
};

export const stopped = (r: Reading) => r.phase === 'failed' || r.phase === 'cancelled' || r.phase === 'unanswered';
const waitingFor = (r: Reading) => r.phase === 'waiting' || r.phase === 'catching_up';

/** Says out loud when the reading this screen waits for ends: finished, or stopped (R80). */
function useAnnounceEnd(reading: Reading, subject: Subject) {
  const was = useRef(reading.phase);
  useEffect(() => {
    const before = was.current;
    was.current = reading.phase;
    const busy = before === 'working' || before === 'waiting' || before === 'catching_up';
    if (!busy || reading.phase === before) return;
    if (reading.phase === 'read') announce(subject === 'decisions' ? 'DEMIURGO answered.' : 'DEMIURGO has read it.');
    else if (stopped(reading)) announce(`${WORDS[subject][reading.phase === 'failed' ? 'failed' : 'cancelled']}.`);
  }, [reading, subject]);
}

/**
 * The idea and DEMIURGO reading it, full size: the first moment of a new product. The section is
 * labelled by the page's h1, "DEMIURGO reads your idea".
 */
export function LiveReading({
  projectId,
  explorationId,
  name,
  idea,
  reading,
  content,
  onSee,
}: {
  projectId: string;
  explorationId: string;
  name: string | undefined;
  idea: Message;
  reading: Reading;
  content: ReadingContent | null;
  onSee: () => void;
}) {
  useAnnounceEnd(reading, 'idea');
  return (
    <section aria-labelledby="page-title" className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 pt-10 pb-16 sm:px-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-fg-2">{name ?? 'Your new product'}</p>
        <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold text-fg outline-none">
          DEMIURGO reads your idea
        </h1>
      </div>
      <figure className="flex items-start gap-3">
        <WhoAvatar kind="you" size={28} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <figcaption className="text-sm text-fg-2">
            <span className="font-medium text-fg">Your idea</span> · <RelativeTime iso={idea.created_at} />
          </figcaption>
          <blockquote className="text-md break-words whitespace-pre-wrap text-fg-2">“{idea.body}”</blockquote>
        </div>
      </figure>
      {stopped(reading) ? (
        <StoppedCard projectId={projectId} explorationId={explorationId} reading={reading} subject="idea" />
      ) : (
        <ReadingCard projectId={projectId} reading={reading} content={content} onSee={onSee} />
      )}
    </section>
  );
}

type StepState = 'done' | 'active' | 'pending';

const STEP_WORD: Record<StepState, string> = { done: 'Done', active: 'In progress', pending: 'Not yet' };

function Step({ state, title, children }: { state: StepState; title: string; children?: ReactNode }) {
  return (
    <li data-step={state} className="flex gap-3.5 border-t border-edge-subtle px-5 py-4 first:border-t-0 sm:px-6">
      <span className="flex h-6 w-5 shrink-0 items-center justify-center">
        <StateIcon kind={state === 'done' ? 'done' : state === 'active' ? 'working' : 'open'} size={18} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h3 className={cn('text-base', state === 'pending' ? 'font-medium text-fg-2' : 'font-semibold text-fg')}>
          {title}
          <span className="sr-only"> · {STEP_WORD[state]}</span>
        </h3>
        {children}
      </div>
    </li>
  );
}

/** The run at work: its state (Working, Stalled…), the engine's live progress and the elapsed time. */
function RunLive({ run }: { run: RunListItem }) {
  const progress = useRunProgress(run.id);
  const now = useNow(true);
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <RunStateBadge run={run} withDetail />
      {progress ? (
        <span data-run-progress className="text-sm text-info-text tabular-nums">
          {progressText(progress, now)}
        </span>
      ) : null}
      <span data-run-timer className="text-sm text-fg-2 tabular-nums">
        <Elapsed start={run.started_at ?? run.created_at} />
      </span>
    </span>
  );
}

function ReadingCard({
  projectId,
  reading,
  content,
  onSee,
}: {
  projectId: string;
  reading: Reading;
  content: ReadingContent | null;
  onSee: () => void;
}) {
  const run = reading.run;
  const finished = reading.phase === 'read';
  const working = reading.phase === 'working';
  const headline = finished
    ? "Here's a first reading of your idea"
    : reading.phase === 'catching_up'
      ? CATCHING_UP
      : WORDS.idea[working ? 'working' : 'waiting'];
  const shown = finished ? content : null;
  const first: StepState = finished ? 'done' : working ? 'active' : 'pending';
  const rest: StepState = finished ? 'done' : 'pending';
  return (
    <Card padding="none" data-reading={reading.phase} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-edge px-5 py-4 sm:px-6">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
          <WhoAvatar kind="demiurgo" size={28} />
          <h2 className="min-w-0 text-lg font-semibold text-fg">{headline}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {working && run ? <RunLive run={run} /> : null}
          {waitingFor(reading) ? <StatusBadge kind="working" word="Waiting" /> : null}
          {finished && run ? (
            <span className="text-sm text-fg-2 tabular-nums">
              {between(run.started_at ?? run.created_at, run.finished_at)}
              {run.model ? ` · ${run.model}` : ''}
            </span>
          ) : null}
          {working && run ? <CancelRun projectId={projectId} run={run} /> : null}
        </div>
      </div>
      {waitingFor(reading) ? (
        <p className="border-b border-edge-subtle bg-sunken px-5 py-2.5 text-sm text-fg-2 sm:px-6">
          It starts as soon as its knowledge is up to date with your idea.
        </p>
      ) : null}
      <ol aria-label="What DEMIURGO does" aria-busy={!finished || undefined}>
        <Step state={first} title="What I understood">
          {shown ? (
            <>
              {shown.reply ? <p className="text-md break-words whitespace-pre-wrap text-fg">{shown.reply.body}</p> : null}
              <ObservationList observations={shown.observations} compact />
            </>
          ) : null}
        </Step>
        <Step state={rest} title="What I still need to ask you">
          {shown ? (
            shown.questions.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {shown.questions.map((q) => (
                  <li key={q.id} data-reading-question={q.id} className="flex items-start gap-2.5 text-base text-fg">
                    <EntityState entity="question" state={q.state} className="mt-px" />
                    <span className="min-w-0 break-words">{q.question}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-2">Nothing for now.</p>
            )
          ) : null}
        </Step>
        {shown?.batchId ? <ProposedStep projectId={projectId} batchId={shown.batchId} /> : null}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-edge bg-sunken px-5 py-3.5 sm:px-6">
        <p className="min-w-0 flex-1 basis-64 text-sm text-fg-2">
          {finished
            ? 'Everything above is only proposed. You will review it before anything is decided.'
            : 'DEMIURGO is only reading. Nothing is decided without you.'}
        </p>
        {finished ? (
          <Button variant="primary" trailing={<ArrowRightIcon size={15} />} onClick={onSee}>
            See what I understood
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** What the reading proposed (decisions, threads…), each with its real state; they wait on their batch page. */
function ProposedStep({ projectId, batchId }: { projectId: string; batchId: string }) {
  const batch = useQuery(batchQuery(projectId, batchId));
  return (
    <Step state="done" title="What I propose">
      {batch.error ? <ErrorNotice error={batch.error} compact focus={false} onRetry={() => void batch.refetch()} /> : null}
      <ul className="flex flex-col gap-2">
        {(batch.data?.proposals ?? []).map((p) => (
          <li key={p.id} data-reading-proposal={p.id} className="flex items-start gap-2.5 text-base text-fg">
            <EntityState entity="proposal" state={p.state} className="mt-px" />
            <span className="min-w-0 break-words">{proposalTitle(p)}</span>
          </li>
        ))}
      </ul>
    </Step>
  );
}

/** Cancel a run that works, after saying what is kept (R27): nothing is applied. */
export function CancelRun({ projectId, run, size }: { projectId: string; run: RunListItem; size?: ButtonSize }) {
  const command = useCommand(projectId);
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionBar
        entity="ai_run"
        state={run.state}
        {...(size ? { size } : {})}
        handlers={{
          'run.cancel': {
            label: 'Cancel',
            variant: 'secondary',
            run: () => {
              command.reset();
              setOpen(true);
            },
          },
        }}
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cancel this run?"
        description="DEMIURGO stops here. Nothing is applied; what it already wrote in the thread stays."
        confirm="Cancel the run"
        pendingLabel="Cancelling…"
        tone="danger"
        pending={command.isPending}
        error={open ? command.error : null}
        onConfirm={() =>
          command.mutate(
            { command: 'run.cancel', entityId: run.id },
            {
              onSuccess: () => {
                setOpen(false);
                announce('Cancelled. Nothing was applied.');
              },
            },
          )
        }
      />
    </>
  );
}

/** A reading that stopped: tinted when it failed, neutral when it was cancelled or never came. */
function StoppedCard({
  projectId,
  explorationId,
  reading,
  subject,
  compact = false,
}: {
  projectId: string;
  explorationId: string;
  reading: Reading;
  subject: Subject;
  compact?: boolean;
}) {
  const tables = useTables();
  const command = useCommand(projectId);
  const run = reading.run;
  const failed = reading.phase === 'failed';
  const title =
    WORDS[subject][reading.phase === 'failed' ? 'failed' : reading.phase === 'cancelled' ? 'cancelled' : 'unanswered'];
  const reason = run
    ? failureWord(run.failure_kind ?? (reading.phase === 'cancelled' ? 'cancelled' : null), run.state)
    : 'Nothing was lost: what you wrote is in the thread.';
  const canRetry = !!run && !!tables && canCreate(tables, 'run.retry');
  const canAsk = !run && !!tables && canCreate(tables, 'run.request');
  const H = compact ? 'h3' : 'h2';
  const size: ButtonSize = compact ? 'sm' : 'md';
  return (
    <Card
      data-reading={reading.phase}
      {...(failed ? { tone: 'danger' as const } : {})}
      padding="none"
      className={cn('flex flex-col gap-3', compact ? 'px-4 py-3' : 'px-5 py-4 sm:px-6')}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {run ? <EntityState entity="ai_run" state={run.state} /> : null}
            <H className={cn('font-semibold text-fg', compact ? 'text-base' : 'text-lg')}>{title}</H>
          </div>
          <p className={cn('text-base', failed ? 'text-danger-text' : 'text-fg-2')}>{reason}</p>
          {run ? (
            <p className="text-sm text-fg-2">
              Conversation · {dayTime(run.finished_at ?? run.created_at)}
              {run.model ? ` · ${run.model}` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {run ? (
            <Link
              to="/p/$projectId/runs/$runId"
              params={{ projectId, runId: run.id }}
              aria-label="Details of the conversation run"
              className="inline-flex h-8 items-center gap-0.5 rounded-md px-2 text-sm font-medium text-fg-2 hover:bg-hover hover:text-fg"
            >
              Details
              <ChevronRightIcon size={13} />
            </Link>
          ) : null}
          {canRetry && run ? (
            <Button
              size={size}
              variant={compact ? 'secondary' : 'primary'}
              icon={<RetryIcon size={14} />}
              data-command="run.retry"
              pending={command.isPending}
              pendingLabel="Retrying…"
              onClick={() =>
                command.mutate(
                  { command: 'run.retry', data: { run_id: run.id } },
                  { onSuccess: () => announce('Retrying. DEMIURGO reads it again.') },
                )
              }
            >
              Retry
            </Button>
          ) : null}
          {canAsk ? (
            <Button
              size={size}
              variant={compact ? 'secondary' : 'primary'}
              data-command="run.request"
              pending={command.isPending}
              pendingLabel="Asking…"
              onClick={() =>
                command.mutate(
                  {
                    command: 'run.request',
                    data: { action: 'exploration_chat', agent: 'onboarding', scope: { type: 'exploration', id: explorationId } },
                  },
                  { onSuccess: () => announce('Asked. DEMIURGO reads it.') },
                )
              }
            >
              Ask DEMIURGO
            </Button>
          ) : null}
        </div>
      </div>
      {command.error ? <ErrorNotice error={command.error} compact /> : null}
    </Card>
  );
}

/** The same, compact, inside the other screens of the day: waiting, working (with Cancel), or stopped. */
export function ReadingStatus({
  projectId,
  explorationId,
  reading,
  subject,
}: {
  projectId: string;
  explorationId: string;
  reading: Reading;
  subject: Subject;
}) {
  useAnnounceEnd(reading, subject);
  if (reading.phase === 'read') return null;
  if (stopped(reading)) {
    return <StoppedCard projectId={projectId} explorationId={explorationId} reading={reading} subject={subject} compact />;
  }
  const run = reading.run;
  const working = reading.phase === 'working';
  return (
    <Card tone="info" padding="none" data-reading={reading.phase} className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <WhoAvatar kind="demiurgo" size={20} />
        <p className="min-w-0 flex-1 basis-48 text-base font-medium text-fg">
          {reading.phase === 'catching_up' ? CATCHING_UP : WORDS[subject][working ? 'working' : 'waiting']}
        </p>
        {working && run ? <RunLive run={run} /> : <StatusBadge kind="working" word="Waiting" />}
        {working && run ? <CancelRun projectId={projectId} run={run} size="sm" /> : null}
      </div>
      {waitingFor(reading) ? (
        <p className="text-sm text-fg-2">It starts as soon as its knowledge is up to date with what you wrote.</p>
      ) : null}
    </Card>
  );
}
