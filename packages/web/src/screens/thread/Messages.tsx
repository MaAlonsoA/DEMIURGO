// The messages of a thread (DESIGN.md §3.3, §6.5; INV-THR-18…22, INV-FORK-01…05). The person on the
// right, in plain text; an outside agent or an automatic rule on the left with its mark; DEMIURGO's
// reply in rendered Markdown, with what it observed marked Proposed or Unknown — never Confirmed —
// what its run proposed and the way to review it, the threads it suggests opening (a draft choice,
// sent with the answers) and "Fork into a new thread". A message that asked DEMIURGO for an answer
// says when that answer waits for knowledge to catch up, so asking never looks like nothing happened.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { batchQuery, explorationsQuery } from '../../api/queries.ts';
import type { ExplorationDetail, Message, Proposal } from '../../api/types.ts';
import { Button } from '../../components/Button.tsx';
import { ArrowRightIcon, CheckIcon, ForkIcon, PackageIcon } from '../../components/icons.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Bone } from '../../components/Spinner.tsx';
import { EntityState, StatusBadge, WorkingDot } from '../../components/status.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { Who } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { OBSERVATION_WORDS } from '../../words.ts';
import { proposalsInWords } from '../run/runs.ts';
import { OpenThreadDialog } from '../threads/OpenThreadDialog.tsx';
import { plainText } from './answers.ts';
import { useDrafts } from './drafts.tsx';

/** A person (right), an outside agent or an automatic rule (left): plain text, as written. */
export function PersonMessage({ message: m, by }: { message: Message; by: 'you' | 'agent' | 'automatic' }) {
  const headId = useId();
  const mine = by === 'you';
  return (
    <article
      data-message-by={by}
      data-message={m.id}
      aria-labelledby={headId}
      className={cn('flex max-w-[88%] flex-col gap-1', mine ? 'items-end self-end' : 'items-start self-start')}
    >
      <header id={headId} className="flex items-center gap-1.5 text-xs text-fg-2">
        <Who actor={m.author} size={16} className="font-medium text-fg" />
        {by === 'automatic' ? <span className="text-fg-3">{m.author.replace(/^system:/, '')}</span> : null}
        <span aria-hidden>·</span>
        <RelativeTime iso={m.created_at} />
      </header>
      <div
        className={cn(
          'rounded-lg px-3.5 py-2.5 text-md whitespace-pre-wrap text-fg',
          mine ? 'rounded-tr-xs bg-selected' : 'rounded-tl-xs border border-edge bg-panel',
        )}
      >
        {m.body}
      </div>
      {mine ? <AnswerStatus message={m} /> : null}
    </article>
  );
}

/**
 * Where the answer a message asked for stands, when the thread can't show it as a run yet: waiting
 * for knowledge to catch up, or given up. A working run shows itself as a card below.
 */
function AnswerStatus({ message: m }: { message: Message }) {
  if (m.response === 'waiting')
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-info-text">
        <WorkingDot size={7} />
        DEMIURGO answers once it has caught up with your latest changes.
      </p>
    );
  if (m.response === 'abandoned')
    return <p className="text-xs text-fg-2">DEMIURGO didn't answer this message. Ask again when you're ready.</p>;
  return null;
}

/** DEMIURGO's answer: its reply, anything else it wrote in the same run, and what it observed. */
export function DemiurgoMessage({
  projectId,
  thread,
  reply,
  observations,
  model,
  batchId,
  canFork,
}: {
  projectId: string;
  thread: ExplorationDetail;
  reply: Message | null;
  observations: Message[];
  model: string | null;
  batchId: string | null;
  canFork: boolean;
}) {
  const headId = useId();
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
      aria-labelledby={headId}
      className="flex flex-col gap-3 rounded-lg border border-edge bg-panel px-4 py-3.5"
    >
      <header id={headId} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-2">
        <Who actor={first.author} model={model} size={20} className="font-medium text-fg" />
        <span aria-hidden>·</span>
        <RelativeTime iso={first.created_at} />
      </header>
      {reply ? <Markdown>{reply.body}</Markdown> : null}
      {more.map((m) => (
        <Markdown key={m.id}>{m.body}</Markdown>
      ))}
      {observed.length > 0 ? <Observations items={observed} divided={!!reply || more.length > 0} /> : null}
      {batchId ? <Proposed projectId={projectId} batchId={batchId} /> : null}
      {canFork ? (
        <div className="flex justify-end border-t border-edge-subtle pt-2">
          <Button
            size="sm"
            variant="quiet"
            icon={<ForkIcon size={14} />}
            data-command="exploration.open"
            onClick={() => setForking(true)}
          >
            Fork into a new thread
          </Button>
        </div>
      ) : null}
      {canFork ? (
        <OpenThreadDialog
          projectId={projectId}
          open={forking}
          onOpenChange={setForking}
          parent={{ id: thread.id, purpose: thread.purpose }}
          initial={plainText(reply?.body ?? first.body).slice(0, 1000)}
          fork
        />
      ) : null}
    </article>
  );
}

/** What DEMIURGO observed: each one Proposed (a claim or a hypothesis) or Unknown, in words. */
export function Observations({ items, divided = true }: { items: Message[]; divided?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-2', divided && 'border-t border-edge-subtle pt-3')}>
      <h3 className="text-sm font-medium text-fg-2">What it observed</h3>
      <ul className="flex flex-col gap-2">
        {items.map((o) => {
          const w = OBSERVATION_WORDS[o.kind ?? 'unknown'] ?? { word: 'Unknown', mark: 'unknown' as const };
          return (
            <li key={o.id} data-observation={o.kind} className="flex flex-wrap items-start gap-x-2 gap-y-1 text-base">
              <StatusBadge kind={w.mark === 'unknown' ? 'unknown' : 'proposed'} className="mt-0.5" />
              {w.mark !== 'unknown' ? <span className="mt-px text-sm text-fg-3">{w.word}</span> : null}
              <span className="min-w-0 flex-1 basis-60 text-fg">{o.body}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What the conversation proposed: suggested threads inline; the rest waits in Needs you. */
function Proposed({ projectId, batchId }: { projectId: string; batchId: string }) {
  const batch = useQuery(batchQuery(projectId, batchId));
  if (!batch.data) {
    if (batch.isError)
      return <ErrorNotice error={batch.error} compact focus={false} onRetry={() => void batch.refetch()} className="text-sm" />;
    return <Bone className="h-4 w-1/2" />;
  }
  const b = batch.data;
  const forks = b.proposals.filter((p) => p.type === 'exploration');
  const rest = b.proposals.filter((p) => p.type !== 'exploration');
  const pending = b.state === 'pending' && rest.some((p) => p.state === 'pending');
  return (
    <>
      {forks.map((p) => (
        <ForkSuggestion key={p.id} projectId={projectId} proposal={p} />
      ))}
      {rest.length > 0 ? (
        <div
          data-proposed={b.id}
          className={cn(
            'flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border px-3 py-2 text-base',
            pending ? 'border-accent-edge bg-accent-soft' : 'border-edge-subtle bg-sunken',
          )}
        >
          <PackageIcon size={16} className={pending ? 'text-accent-text' : 'text-fg-3'} />
          <span className="min-w-0 flex-1 text-fg">
            Proposed <span className="font-semibold">{proposalsInWords(rest.map((p) => p.type))}</span>
            {pending ? ' for you to review.' : '.'}
          </span>
          {!pending ? <EntityState entity="batch" state={b.state} /> : null}
          <Link
            to="/p/$projectId/batches/$batchId"
            params={{ projectId, batchId: b.id }}
            className={cn(
              'inline-flex min-h-6 items-center gap-1 text-sm font-medium hover:underline',
              pending ? 'text-accent-text' : 'text-fg-2 hover:text-fg',
            )}
          >
            {pending ? 'Review' : 'Open'}
            <ArrowRightIcon size={12} />
          </Link>
        </div>
      ) : null}
    </>
  );
}

const purposeOf = (p: Pick<Proposal, 'payload'>): string => {
  const raw = (p.payload as { purpose?: unknown } | null)?.purpose;
  return typeof raw === 'string' ? raw : '';
};

/**
 * A thread DEMIURGO suggests opening apart: explore it separately or keep it here. The choice is a
 * draft, sent with the answers; once resolved it says what happened, with the way to the new thread.
 */
function ForkSuggestion({ projectId, proposal: p }: { projectId: string; proposal: Proposal }) {
  const drafts = useDrafts();
  const threads = useQuery({ ...explorationsQuery(projectId), enabled: p.state !== 'pending' }).data;
  const purpose = purposeOf(p);
  const choice = drafts?.forks[p.id];
  const labelId = useId();

  if (p.state !== 'pending') {
    const opened = p.state === 'accepted' || p.state === 'accepted_edited';
    const child = opened ? threads?.find((t) => t.origin_type === 'proposal' && t.origin_id === p.id) : undefined;
    return (
      <p data-fork-resolved={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-2">
        <ForkIcon size={14} className="text-fg-3" />
        <span>
          {opened ? 'Opened as its own thread: ' : p.state === 'rejected' ? 'Kept in this thread: ' : 'No longer suggested: '}
          <span className="text-fg">«{purpose}»</span>
        </span>
        {child ? (
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId: child.id }}
            className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
          >
            Open it
            <ArrowRightIcon size={12} />
          </Link>
        ) : null}
      </p>
    );
  }

  const toggle = (c: 'explore' | 'keep') => drafts?.setFork(p.id, choice === c ? null : c);
  const option = (c: 'explore' | 'keep', label: string) => (
    <Button
      size="sm"
      variant="secondary"
      aria-pressed={choice === c}
      disabled={!drafts}
      icon={choice === c ? <CheckIcon size={13} /> : undefined}
      onClick={() => toggle(c)}
      className="aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-text"
    >
      {label}
    </Button>
  );
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      data-fork-suggestion={p.id}
      className="flex flex-col gap-2 rounded-md border border-dashed border-edge-strong px-3 py-2.5"
    >
      <p id={labelId} className="flex items-start gap-2 text-base text-fg-2">
        <ForkIcon size={15} className="mt-0.5 shrink-0 text-fg-3" />
        <span>
          Could deserve its own thread: <span className="font-medium text-fg">«{purpose}»</span>
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        {option('explore', 'Explore separately')}
        {option('keep', 'Keep it here')}
        {choice ? <span className="ml-auto text-sm font-medium text-accent-text">Not sent yet</span> : null}
      </div>
    </div>
  );
}
