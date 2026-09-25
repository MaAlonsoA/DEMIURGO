// The conversation of a thread (spec §4.7): the person's messages on the right, DEMIURGO's reply
// with its observations (Proposed ○ or Unknown ?, never Confirmed) and an agent's messages on the
// left, and the runs between them. DEMIURGO's questions are its messages too (answered in place),
// a new thread it suggests shows inline, and any of its messages can be forked into a new thread.
// While the person reads the end, what arrives stays in view.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { batchQuery } from '../../api/queries.ts';
import type { ExplorationDetail, Message, Question, RunListItem } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { ago, dayTime } from '../../lib/time.ts';
import { Button } from '../../ui/Button.tsx';
import { ChevronRight, TypeIcon } from '../../ui/icons.tsx';
import { Skeleton } from '../../ui/layout.tsx';
import { ObservationChip, StateMark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { whoOf } from '../../words.ts';
import { useNow } from '../run/hooks.ts';
import { proposalsInWords } from '../run/runs.ts';
import { OpenThreadDialog } from '../threads/Threads.tsx';
import { RunCard } from './RunCards.tsx';
import { QuestionCard, useDrafts } from './ThreadQuestions.tsx';
import { type TimelineItem, isActive } from './timeline.ts';

export type QuestionHandlers = {
  thread: ExplorationDetail;
  stageTitle: string | null;
  deeper: string | null;
  onDeeper: (questionId: string) => void;
  onOwnWords: (questionId: string) => void;
};

export function Conversation({
  projectId,
  items,
  runs,
  questions,
  active,
  handlers,
}: {
  projectId: string;
  items: TimelineItem[];
  runs: RunListItem[];
  questions: Question[];
  active: boolean;
  handlers: QuestionHandlers;
}) {
  const runOf = new Map(runs.map((r) => [r.id, r]));
  const now = useNow(runs.some(isActive));
  const questionOf = (id: string | null) => (id ? questions.find((q) => q.id === id) : undefined);
  useFollowTheEnd(items.length);

  if (items.length === 0) {
    return (
      <p className="dm-text-small rounded-card-md border border-dashed border-line-strong px-5 py-6 text-center text-muted">
        {active ? 'Nothing written yet. Write below, then Send it or ask DEMIURGO.' : 'Nothing was written in this thread.'}
      </p>
    );
  }
  return (
    <section aria-label="Conversation" className="flex flex-col gap-5">
      {items.map((item) => {
        if (item.type === 'question')
          return (
            <QuestionCard
              key={item.key}
              thread={handlers.thread}
              question={item.question}
              stageTitle={item.question.stage_id ? handlers.stageTitle : null}
              deeperOpen={handlers.deeper === item.question.id}
              deeperCount={handlers.thread.messages.filter((m) => m.question_id === item.question.id).length}
              onDeeper={() => handlers.onDeeper(item.question.id)}
              onOwnWords={() => handlers.onOwnWords(item.question.id)}
            />
          );
        if (item.type === 'run')
          return <RunCard key={item.key} projectId={projectId} run={item.run} display={item.display} now={now} />;
        if (item.type === 'demiurgo') {
          const run = item.runId ? runOf.get(item.runId) : undefined;
          return (
            <DemiurgoMessage
              key={item.key}
              projectId={projectId}
              thread={handlers.thread}
              reply={item.reply}
              observations={item.observations}
              model={run?.model ?? null}
              batchId={run?.action === 'exploration_chat' ? run.batch_id : null}
            />
          );
        }
        return <PersonMessage key={item.key} message={item.message} by={item.by} about={questionOf(item.message.question_id)} />;
      })}
    </section>
  );
}

/** When the person is at the end of the page, new messages and runs keep the end in view. */
function useFollowTheEnd(count: number) {
  const atEnd = useRef(false);
  const previous = useRef(count);
  useLayoutEffect(() => {
    const onScroll = () => {
      atEnd.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    if (count > previous.current && atEnd.current) window.scrollTo({ top: document.documentElement.scrollHeight });
    previous.current = count;
  }, [count]);
}

function When({ at }: { at: string }) {
  return (
    <Tip text={dayTime(at)}>
      <time dateTime={at} className="text-muted">
        {ago(at)}
      </time>
    </Tip>
  );
}

function About({ question }: { question: Question | undefined }) {
  if (!question) return null;
  return <span className="dm-text-caption text-muted">On the question “{question.question}”</span>;
}

/** A person (right), an external agent or an automatic rule (left). */
function PersonMessage({ message: m, by, about }: { message: Message; by: 'you' | 'agent' | 'automatic'; about?: Question }) {
  if (by === 'you') {
    return (
      <article data-message-by="you" data-message={m.id} className="flex max-w-[580px] flex-col items-end gap-1 self-end">
        <span className="dm-text-caption flex items-center gap-1.5 text-muted">
          <span className="font-semibold text-ink-2">You</span>
          <span aria-hidden="true">·</span>
          <When at={m.created_at} />
          <WhoMark actor={m.author} size={16} />
        </span>
        <About question={about} />
        <div className="dm-text-body rounded-card-md rounded-br-tag bg-line-soft px-3.5 py-2.5 leading-relaxed whitespace-pre-wrap text-ink">
          {m.body}
        </div>
      </article>
    );
  }
  const who = whoOf(m.author);
  return (
    <article data-message-by={by} data-message={m.id} className="flex max-w-[640px] flex-col gap-1 self-start">
      <span className="dm-text-caption flex items-center gap-1.5 text-muted">
        <WhoMark actor={m.author} size={16} />
        <span className="font-semibold text-ink-2">{by === 'agent' ? who.name : 'Automatic'}</span>
        <span>{by === 'agent' ? 'Agent' : who.detail}</span>
        <span aria-hidden="true">·</span>
        <When at={m.created_at} />
      </span>
      <About question={about} />
      <div className="dm-text-body rounded-card-md rounded-tl-tag border border-line bg-surface px-3.5 py-2.5 leading-relaxed whitespace-pre-wrap">
        {m.body}
      </div>
    </article>
  );
}

/** DEMIURGO's answer: its reply and, below, what it observed with its chip. */
function DemiurgoMessage({
  projectId,
  thread,
  reply,
  observations,
  model,
  batchId,
}: {
  projectId: string;
  thread: ExplorationDetail;
  reply: Message | null;
  observations: Message[];
  model: string | null;
  batchId: string | null;
}) {
  const [forking, setForking] = useState(false);
  const first = reply ?? observations[0];
  if (!first) return null;
  // Observations carry their type; anything else DEMIURGO wrote in the same run reads as its reply.
  const observed = observations.filter((o) => o.kind);
  const more = observations.filter((o) => !o.kind);
  return (
    <article
      data-message-by="demiurgo"
      data-message={first.id}
      className="flex max-w-[640px] flex-col gap-2.5 self-start rounded-card-md border border-line bg-surface px-4 py-3.5"
    >
      <header className="dm-text-caption flex items-center gap-1.5 text-muted">
        <WhoMark actor={first.author} model={model} size={18} />
        <span className="font-semibold text-ink-2">DEMIURGO</span>
        {model && <span>{model}</span>}
        <span aria-hidden="true">·</span>
        <When at={first.created_at} />
      </header>
      {reply && <p className="dm-text-body leading-relaxed whitespace-pre-wrap text-ink">{reply.body}</p>}
      {more.map((m) => (
        <p key={m.id} className="dm-text-body leading-relaxed whitespace-pre-wrap text-ink">
          {m.body}
        </p>
      ))}
      {observed.length > 0 && (
        <div className={cn('flex flex-col gap-2', (reply || more.length > 0) && 'border-t border-line-soft pt-2.5')}>
          <h3 className="dm-label">What it observed</h3>
          <ul className="flex flex-col gap-2">
            {observed.map((o) => (
              <li key={o.id} data-observation={o.kind} className="dm-text-small flex items-start gap-2.5 leading-snug">
                <span className="mt-px shrink-0">
                  <ObservationChip kind={o.kind ?? 'unknown'} />
                </span>
                <span className="text-ink-2">{o.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {batchId && <Proposed projectId={projectId} batchId={batchId} />}
      {thread.state === 'active' && (
        <div className="flex justify-end border-t border-line-soft pt-2">
          <Button variant="text" onClick={() => setForking(true)} data-command="exploration.open">
            <ForkIcon />
            Fork into a new thread
          </Button>
        </div>
      )}
      <OpenThreadDialog
        projectId={projectId}
        open={forking}
        onOpenChange={setForking}
        parent={{ id: thread.id, purpose: thread.purpose }}
        initial={(reply?.body ?? first.body).slice(0, 1000)}
        fork
      />
    </article>
  );
}

function ForkIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="8" r="2" />
      <path d="M6 7v10" />
      <path d="M18 10c0 4-6 3-12 7" />
    </svg>
  );
}

/**
 * A new thread DEMIURGO suggests: the person explores it separately or keeps it here. The choice is
 * a draft, sent with the answers of the thread.
 */
function ForkSuggestion({ proposal }: { proposal: { id: string; state: string; payload: unknown } }) {
  const drafts = useDrafts();
  const choice = drafts?.forks[proposal.id];
  const purpose = String((proposal.payload as { purpose?: unknown } | null)?.purpose ?? '');
  if (proposal.state !== 'pending') {
    return (
      <p className="dm-text-caption text-muted">
        {proposal.state === 'accepted' ? `Opened as its own thread: «${purpose}»` : `Kept in this thread: «${purpose}»`}
      </p>
    );
  }
  return (
    <div
      data-fork-suggestion={proposal.id}
      className="flex flex-col gap-2 rounded-card-md border border-dashed border-line-strong px-3 py-2.5"
    >
      <p className="dm-text-small flex items-start gap-2 text-ink-2">
        <span className="mt-0.5 flex text-ink-3">
          <ForkIcon />
        </span>
        <span>
          Could deserve its own thread: <span className="font-semibold text-ink">«{purpose}»</span>
        </span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant={choice === 'explore' ? 'primary' : 'secondary'}
          aria-pressed={choice === 'explore'}
          disabled={!drafts}
          onClick={() => drafts?.setFork(proposal.id, choice === 'explore' ? null : 'explore')}
        >
          Explore separately
        </Button>
        <Button
          variant={choice === 'keep' ? 'primary' : 'text'}
          aria-pressed={choice === 'keep'}
          disabled={!drafts}
          onClick={() => drafts?.setFork(proposal.id, choice === 'keep' ? null : 'keep')}
        >
          Keep it here
        </Button>
        {choice && <span className="dm-text-caption ml-auto text-muted">Not sent yet</span>}
      </div>
    </div>
  );
}

/** What the conversation proposed: new threads inline; the rest waits in Needs you until resolved. */
function Proposed({ projectId, batchId }: { projectId: string; batchId: string }) {
  const batch = useQuery(batchQuery(projectId, batchId)).data;
  if (!batch) return <Skeleton className="h-4 w-1/2" />;
  const forks = batch.proposals.filter((p) => p.type === 'exploration');
  const rest = batch.proposals.filter((p) => p.type !== 'exploration');
  const pending = batch.state === 'pending' && rest.some((p) => p.state === 'pending');
  return (
    <>
      {forks.map((p) => (
        <ForkSuggestion key={p.id} proposal={p} />
      ))}
      {rest.length > 0 && (
        <div
          data-proposed={batch.id}
          className={cn(
            'dm-text-small flex items-center gap-2.5 rounded-sm border px-3 py-2',
            pending ? 'border-needs-line bg-needs-soft text-ink' : 'border-transparent bg-surface-soft text-ink-2',
          )}
        >
          <span className="flex text-muted">
            <TypeIcon kind="package" size={14} />
          </span>
          <span className="min-w-0 flex-1">
            Proposed <span className="font-semibold">{proposalsInWords(rest.map((p) => p.type))}</span>
            {pending ? ' for you to review.' : '.'}
          </span>
          {!pending && <StateMark entity="batch" state={batch.state} />}
          <Link
            to="/p/$projectId/batches/$batchId"
            params={{ projectId, batchId: batch.id }}
            className={cn(
              'inline-flex shrink-0 items-center gap-0.5 font-semibold',
              pending ? 'text-needs-strong hover:underline' : 'text-ink-2 hover:text-ink',
            )}
          >
            {pending ? 'Review' : 'Open'}
            <ChevronRight size={12} />
          </Link>
        </div>
      )}
    </>
  );
}
