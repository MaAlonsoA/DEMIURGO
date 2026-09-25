// DEMIURGO reading the idea (canvas S4B): the idea as written and the card of what DEMIURGO is
// doing. It waits while the durable response waits for the knowledge, it is amber while the run
// works (with its time and Cancel), and its sections fill in as the stream brings the reading, all
// Proposed, Unknown or Open. A failed run is the rust card with its reason and Retry.
// The compact card says the same inside the other screens of the day.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useCommand } from '../../api/commands.ts';
import { useRunProgress } from '../../api/progress.ts';
import { LiveProgress } from '../run/Engine.tsx';
import { batchQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Message, Question, RunListItem } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import { ago, dayTime } from '../../lib/time.ts';
import { ActionBar } from '../../ui/ActionBar.tsx';
import { Button } from '../../ui/Button.tsx';
import { ArrowRight, ChevronRight, TickIcon } from '../../ui/icons.tsx';
import { Mark, WorkingMark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoGlyph } from '../../ui/signals.tsx';
import { OBSERVATION_WORDS, failureWord } from '../../words.ts';
import { proposalTitle } from '../batch/model.ts';
import { runDuration } from '../run/runs.ts';
import type { Reading } from './day.ts';

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

const stopped = (r: Reading) => r.phase === 'failed' || r.phase === 'cancelled' || r.phase === 'unanswered';

/** The idea and DEMIURGO reading it, full size: the first moment of a new product. */
export function LiveReading({
  projectId,
  explorationId,
  idea,
  reading,
  content,
  now,
  onSee,
}: {
  projectId: string;
  explorationId: string;
  idea: Message;
  reading: Reading;
  content: ReadingContent | null;
  now: number;
  onSee: () => void;
}) {
  return (
    <section aria-label="DEMIURGO reads your idea" className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <WhoGlyph kind="you" size={26} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="dm-text-caption text-muted">Your idea · {ago(idea.created_at, now)}</span>
          <p className="dm-text-body leading-relaxed whitespace-pre-wrap text-ink-2">“{idea.body}”</p>
        </div>
      </div>
      {stopped(reading) ? (
        <StoppedCard projectId={projectId} explorationId={explorationId} reading={reading} subject="idea" />
      ) : (
        <ReadingCard projectId={projectId} reading={reading} content={content} now={now} onSee={onSee} />
      )}
    </section>
  );
}

type StepState = 'done' | 'active' | 'pending';

function Step({ state, title, children }: { state: StepState; title: string; children?: ReactNode }) {
  return (
    <div data-step={state} className="flex gap-3.5 border-t border-line-soft py-3">
      <span className="flex h-[22px] w-5 shrink-0 items-center justify-center">
        {state === 'done' && (
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-ink text-surface">
            <TickIcon size={10} />
          </span>
        )}
        {state === 'active' && <Mark kind="working" label="Working" />}
        {state === 'pending' && <span className="dm-dot border-[1.5px] border-inactive-soft" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h3 className={cn('dm-text-heading font-semibold', state === 'pending' && 'font-medium text-muted')}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

const chip =
  'dm-text-small inline-flex max-w-full items-start gap-[7px] rounded-sm border border-line bg-surface-soft px-2.5 py-[5px]';

function ReadingCard({
  projectId,
  reading,
  content,
  now,
  onSee,
}: {
  projectId: string;
  reading: Reading;
  content: ReadingContent | null;
  now: number;
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
    <div data-reading={reading.phase} className="dm-panel gap-0 px-6 py-[22px]">
      <div className="flex items-center justify-between gap-4 pb-3">
        <span className="flex items-center gap-2.5">
          <WhoGlyph kind="demiurgo" size={26} />
          <h2 className="dm-text-heading">{headline}</h2>
        </span>
        <span className="flex items-center gap-3">
          {working && run && <RunProgressLine runId={run.id} now={now} />}
          {working && run && (
            <WorkingMark>
              <span data-run-timer>{runDuration(run, now)}</span>
            </WorkingMark>
          )}
          {finished && run && (
            <span className="dm-text-small text-muted">
              {runDuration(run)}
              {run.model ? ` · ${run.model}` : ''}
            </span>
          )}
          {working && run && <CancelRun projectId={projectId} run={run} />}
        </span>
      </div>
      {(reading.phase === 'waiting' || reading.phase === 'catching_up') && (
        <p className="dm-text-small pb-3 text-ink-3">It starts as soon as its knowledge is up to date with your idea.</p>
      )}
      <Step state={first} title="What I understood">
        {shown && (
          <>
            {shown.reply && <p className="dm-text-body leading-relaxed text-ink-2">{shown.reply.body}</p>}
            {shown.observations.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {shown.observations.map((o) => {
                  const w = OBSERVATION_WORDS[o.kind ?? 'unknown'] ?? { word: o.kind ?? '', mark: 'unknown' as const };
                  return (
                    <li key={o.id} data-observation={o.kind} className={chip}>
                      <span className="mt-[3px] flex">
                        <Mark kind={w.mark} label={w.word} />
                      </span>
                      <span>{o.body}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Step>
      <Step state={rest} title="What I still need to ask you">
        {shown &&
          (shown.questions.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {shown.questions.map((q) => (
                <li key={q.id} data-reading-question={q.id} className={chip}>
                  <span className="mt-[3px] flex">
                    <Mark kind="open" label="Open" />
                  </span>
                  <span>{q.question}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dm-text-small text-muted">Nothing for now.</p>
          ))}
      </Step>
      {shown?.batchId && <ProposedStep projectId={projectId} batchId={shown.batchId} />}
      <div className="flex items-center justify-between gap-4 border-t border-line-soft pt-3.5">
        <span className="dm-text-small text-ink-3">
          {finished
            ? 'Everything above is only proposed. You will review it before anything is decided.'
            : 'DEMIURGO is only reading. Nothing is decided without you.'}
        </span>
        {finished && (
          <Button variant="primary" onClick={onSee}>
            See what I understood
            <ArrowRight size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}

/** What the reading proposed (decisions, threads…): each waits for the person on its batch page. */
function ProposedStep({ projectId, batchId }: { projectId: string; batchId: string }) {
  const batch = useQuery(batchQuery(projectId, batchId)).data;
  return (
    <Step state="done" title="What I propose">
      <ul className="flex flex-wrap gap-2">
        {(batch?.proposals ?? []).map((p) => (
          <li key={p.id} data-reading-proposal={p.id} className={chip}>
            <span className="mt-[3px] flex">
              <Mark kind="proposed" label="Proposed" />
            </span>
            <span>{proposalTitle(p)}</span>
          </li>
        ))}
      </ul>
    </Step>
  );
}

function CancelRun({ projectId, run }: { projectId: string; run: RunListItem }) {
  const command = useCommand(projectId);
  return (
    <>
      <ActionBar
        entity="ai_run"
        state={run.state}
        handlers={{
          'run.cancel': {
            variant: 'secondary',
            disabled: command.isPending,
            run: () => command.mutate({ command: 'run.cancel', entityId: run.id }),
          },
        }}
      />
      {command.error ? <Reasons error={command.error} /> : null}
    </>
  );
}

/** A reading that stopped: rust when it failed, grey when it was cancelled or never came. */
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
  return (
    <div
      data-reading={reading.phase}
      className={cn(
        // A failure is the rust box: the card's shape on problem-tint, without a line.
        compact ? 'dm-card gap-3 px-4 py-3' : 'dm-panel px-6 py-[22px]',
        failed && 'border-transparent bg-problem-tint text-problem',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-5 shrink-0 items-center justify-center">
          <Mark kind={failed ? 'problem' : 'inactive'} label={failed ? 'Failed' : 'Stopped'} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className={cn('font-semibold', compact ? 'dm-text-body' : 'dm-text-heading', failed ? 'text-problem' : 'text-ink')}>
            {title}
          </h2>
          <p className={cn('dm-text-body', failed ? 'text-problem' : 'text-ink-2')}>{reason}</p>
          {run && (
            <p className={cn('dm-text-caption', failed ? 'text-problem' : 'text-muted')}>
              Conversation · {dayTime(run.finished_at ?? run.created_at)}
              {run.model ? ` · ${run.model}` : ''}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {run && (
            <Link
              to="/p/$projectId/runs/$runId"
              params={{ projectId, runId: run.id }}
              aria-label="Details of the conversation run"
              className={cn(
                'dm-text-small inline-flex items-center gap-0.5 font-semibold hover:underline',
                failed ? 'text-problem' : 'text-ink-2',
              )}
            >
              Details
              <ChevronRight size={12} />
            </Link>
          )}
          {canRetry && run && (
            <Button
              variant="secondary"
              data-command="run.retry"
              disabled={command.isPending}
              onClick={() => command.mutate({ command: 'run.retry', data: { run_id: run.id } })}
            >
              {command.isPending ? 'Retrying…' : 'Retry'}
            </Button>
          )}
          {canAsk && (
            <Button
              variant="secondary"
              data-command="run.request"
              disabled={command.isPending}
              onClick={() =>
                command.mutate({
                  command: 'run.request',
                  data: { action: 'exploration_chat', agent: 'onboarding', scope: { type: 'exploration', id: explorationId } },
                })
              }
            >
              {command.isPending ? 'Asking…' : 'Ask DEMIURGO'}
            </Button>
          )}
        </div>
      </div>
      {command.error ? <Reasons error={command.error} /> : null}
    </div>
  );
}

/** The same, compact, inside the other screens of the day: waiting, amber while it works, or stopped. */
export function ReadingStatus({
  projectId,
  explorationId,
  reading,
  subject,
  now,
}: {
  projectId: string;
  explorationId: string;
  reading: Reading;
  subject: Subject;
  now: number;
}) {
  if (reading.phase === 'read') return null;
  if (stopped(reading)) {
    return <StoppedCard projectId={projectId} explorationId={explorationId} reading={reading} subject={subject} compact />;
  }
  const run = reading.run;
  const working = reading.phase === 'working';
  // DEMIURGO at work is the design system's Working: its amber dot and what it is doing, with the
  // time ("Reading your correction… · 0:42") and Cancel next to it.
  return (
    <div data-reading={reading.phase} className="dm-card flex-row items-center gap-3 px-4 py-3">
      <WhoGlyph kind="demiurgo" size={18} />
      <span className="min-w-0 flex-1">
        <WorkingMark label={working ? 'Working' : 'Waiting'}>
          <span>
            {reading.phase === 'catching_up' ? CATCHING_UP : WORDS[subject][working ? 'working' : 'waiting']}
            {working && run && (
              <>
                {' · '}
                <span data-run-timer>{runDuration(run, now)}</span>
              </>
            )}
          </span>
        </WorkingMark>
      </span>
      {working && run && <RunProgressLine runId={run.id} now={now} />}
      {working && run && <CancelRun projectId={projectId} run={run} />}
    </div>
  );
}

/** What the engine is doing right now («Thinking… 1,240 tokens · 0:12»), from the live stream. */
function RunProgressLine({ runId, now }: { runId: string; now: number }) {
  const progress = useRunProgress(runId);
  return progress ? (
    <span className="dm-text-small text-working-text">
      <LiveProgress progress={progress} now={now} />
    </span>
  ) : null;
}
