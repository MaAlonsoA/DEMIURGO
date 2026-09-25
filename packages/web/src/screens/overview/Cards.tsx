// The things of the product on the overview (DESIGN.md §3.5, D-015): features as cards, the other
// records and the threads as rows, what DEMIURGO drafts, the parked ideas and capturing a new one.
// Every title is a link that opens its page — one click means open everywhere — and a visible
// Preview button shows the facts beside the page, by keyboard too. What changed since the last
// visit is marked "Changed" with a left accent; nothing else is dimmed (INVENTORY §2 #14, #17).

import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { Exploration, ExplorationSummary, ProductRow, RunListItem } from '../../api/types.ts';
import { canCreate } from '../../api/tables.ts';
import { announce } from '../../components/announce.tsx';
import { Count, Tag } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { PromptDialog } from '../../components/Dialog.tsx';
import { ArrowRightIcon, DiffIcon, PlusIcon } from '../../components/icons.tsx';
import { Readiness } from '../../components/Meter.tsx';
import { PreviewButton } from '../../components/Preview.tsx';
import { RunStateBadge } from '../../components/runState.tsx';
import { Certainty, EntityState, StateIcon, StatusBadge } from '../../components/status.tsx';
import { Section } from '../../components/Page.tsx';
import { Elapsed, RelativeTime } from '../../components/Time.tsx';
import { TypeIcon, typeWord } from '../../components/types.tsx';
import { Who } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import { rowStage, type Waiting, waitingCount, waitingPhrase } from '../record/logic.ts';
import { useReturnFocus } from '../record/returnFocus.ts';
import type { FeatureStatus } from './progress.ts';

/** What the lens says of one thing: changed or not, and its short note ("Approved v2"). */
export type ChangeMark = { changed: boolean; note: string | null; since: string | null };

export const UNCHANGED: ChangeMark = { changed: false, note: null, since: null };

/** The title link covers its whole card or row (one click opens), under the controls. */
const STRETCHED = 'after:absolute after:inset-0 after:rounded-lg';
/** Controls inside a card sit above the stretched link. */
const ABOVE = 'relative z-10';

/** "Changed" beside a thing that changed since the last visit. */
export function ChangedBadge() {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-accent-edge bg-accent-soft px-1.5 text-xs font-medium whitespace-nowrap text-accent-text">
      <DiffIcon size={12} />
      Changed
    </span>
  );
}

/** The accent bar on the left edge of what changed. */
function ChangedEdge({ on }: { on: boolean }) {
  if (!on) return null;
  return <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent" />;
}

const verbOf = (row: ProductRow) => (row.latest.state === 'approved' ? 'approved' : 'drafted');

function needsWords(waiting: Waiting): string {
  const n = waitingCount(waiting);
  return waitingPhrase(waiting) || `${n} ${n === 1 ? 'thing needs' : 'things need'} you`;
}

/** A feature: where it stands (readiness), what of it waits for the person, and who touched it last. */
export function FeatureCard({
  projectId,
  row,
  waiting,
  status,
  change,
  onPreview,
}: {
  projectId: string;
  row: ProductRow;
  waiting: Waiting;
  status: FeatureStatus;
  change: ChangeMark;
  onPreview: () => void;
}) {
  const needs = waitingCount(waiting);
  const newer = row.current !== null && row.latest.n > row.current;
  const since = change.changed && change.note ? `Since your last visit: ${change.note}` : null;
  return (
    <article
      data-record={row.code}
      data-card
      data-changed={change.changed ? 'true' : undefined}
      className={cn(
        'relative flex min-w-0 flex-col gap-3 rounded-lg border bg-panel p-4 transition-colors duration-[var(--m-fast)] hover:border-edge-strong',
        change.changed ? 'border-accent-edge' : 'border-edge',
      )}
    >
      <ChangedEdge on={change.changed} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-2">
        <span className="inline-flex items-center gap-1.5">
          <TypeIcon type={row.type} size={14} className="text-fg-3" />
          {typeWord(row.type)}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {change.changed ? <ChangedBadge /> : null}
          <span data-certainty className="inline-flex">
            <Certainty status={row.epistemic_status} />
          </span>
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-md leading-snug font-semibold text-fg">
          <Link
            to="/p/$projectId/records/$code"
            params={{ projectId, code: row.code }}
            className={cn('line-clamp-2 rounded-xs hover:text-accent-text', STRETCHED)}
          >
            {row.title}
          </Link>
        </h3>
        {since ? (
          <p className="text-sm font-medium text-accent-text">{since}</p>
        ) : row.summary ? (
          <p className="line-clamp-2 text-sm text-fg-2">{row.summary}</p>
        ) : null}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <Readiness stage={rowStage(row)} blocking={row.readiness?.reasons.length ?? 0} />
        {needs > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-text">
            <Count n={needs} label={needsWords(waiting)} />
            <span aria-hidden>Needs you</span>
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-edge-subtle pt-2.5 text-xs text-fg-2">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Who actor={row.updated_by} size={16} showName={false} />
          <span className="truncate">
            {verbOf(row)} <RelativeTime iso={row.updated_at} />
          </span>
        </span>
        {newer ? <Tag>v{row.latest.n} draft</Tag> : null}
        {row.checks > 0 ? (
          <span className="tabular-nums">
            {row.checks} {row.checks === 1 ? 'check' : 'checks'}
          </span>
        ) : null}
        {status?.kind === 'working' ? (
          <span data-feature-working className="inline-flex items-center gap-1.5">
            <RunStateBadge run={status.run} />
            <Elapsed start={status.run.started_at ?? status.run.created_at} className="text-info-text" />
          </span>
        ) : null}
        <PreviewButton label={`Preview ${row.title}`} onClick={onPreview} className={cn(ABOVE, 'ml-auto -my-1')} />
      </div>
    </article>
  );
}

/** A list of rows inside one bordered surface. */
export function RowList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul
      aria-label={label}
      className="flex flex-col divide-y divide-edge-subtle overflow-hidden rounded-lg border border-edge bg-panel"
    >
      {children}
    </ul>
  );
}

/** A row: its title takes the room it needs, and the badges go under it on a narrow screen. */
const ROW =
  'relative flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 transition-colors duration-[var(--m-fast)] hover:bg-hover';
const ROW_TITLE = 'min-w-0 flex-1 basis-52';

/** A decision, a tech decision, a bug or a stage record as a row: type, title, what waits, certainty. */
export function RecordRow({
  projectId,
  row,
  waiting,
  change,
  onPreview,
}: {
  projectId: string;
  row: ProductRow;
  waiting: Waiting;
  change: ChangeMark;
  onPreview: () => void;
}) {
  const needs = waitingCount(waiting);
  return (
    <li data-record={row.code} data-card data-changed={change.changed ? 'true' : undefined} className={ROW}>
      <ChangedEdge on={change.changed} />
      <TypeIcon type={row.type} size={16} className="shrink-0 text-fg-3" />
      <span className={ROW_TITLE}>
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId, code: row.code }}
          className={cn('line-clamp-2 text-base font-medium text-fg hover:text-accent-text', STRETCHED, 'after:rounded-none')}
        >
          <span className="sr-only">{typeWord(row.type)}: </span>
          {row.title}
        </Link>
        {change.changed && change.note ? <span className="block truncate text-xs text-accent-text">{change.note}</span> : null}
      </span>
      {change.changed ? <ChangedBadge /> : null}
      <Count n={needs} label={needsWords(waiting)} />
      <span data-certainty className="inline-flex">
        <Certainty status={row.epistemic_status} />
      </span>
      <PreviewButton label={`Preview ${row.title}`} onClick={onPreview} className={ABOVE} />
    </li>
  );
}

/** A thread with open questions: its real state, how many are open and how many wait for you. */
export function ThreadRow({
  projectId,
  thread,
  waiting,
  change,
}: {
  projectId: string;
  thread: ExplorationSummary;
  waiting: number;
  change: ChangeMark;
}) {
  const open = thread.open_questions;
  return (
    <li data-thread={thread.id} data-card data-changed={change.changed ? 'true' : undefined} className={ROW}>
      <ChangedEdge on={change.changed} />
      <TypeIcon type="thread" size={16} className="shrink-0 text-fg-3" />
      <span className={ROW_TITLE}>
        <Link
          to="/p/$projectId/threads/$explorationId"
          params={{ projectId, explorationId: thread.id }}
          className={cn('line-clamp-2 text-base font-medium text-fg hover:text-accent-text', STRETCHED, 'after:rounded-none')}
        >
          {thread.purpose}
        </Link>
        <span className="block text-xs text-fg-2 tabular-nums">
          {open} open {open === 1 ? 'question' : 'questions'}
          {change.changed && change.note ? <span className="text-accent-text"> · {change.note}</span> : null}
        </span>
      </span>
      {change.changed ? <ChangedBadge /> : null}
      <Count n={waiting} label={`${waiting} ${waiting === 1 ? 'question waits' : 'questions wait'} for you`} />
      <EntityState entity="exploration" state={thread.state} />
    </li>
  );
}

/** A feature DEMIURGO is drafting from a decision: it exists once its package is accepted. */
export function DraftingCard({
  projectId,
  run,
  from,
  onPreview,
}: {
  projectId: string;
  run: RunListItem;
  from: ProductRow | undefined;
  onPreview: () => void;
}) {
  return (
    <article
      data-drafting={run.id}
      className="relative flex min-w-0 flex-col gap-3 rounded-lg border border-dashed border-accent-edge bg-panel p-4 hover:border-accent"
    >
      <div className="flex items-center gap-2 text-xs text-fg-2">
        <span className="inline-flex items-center gap-1.5">
          <TypeIcon type="fdr" size={14} className="text-fg-3" />
          Feature
        </span>
        <StatusBadge kind="proposed" className="ml-auto" />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-md leading-snug font-semibold text-fg">
          <Link
            to="/p/$projectId/runs/$runId"
            params={{ projectId, runId: run.id }}
            className={cn('rounded-xs hover:text-accent-text', STRETCHED)}
          >
            A new feature
          </Link>
        </h3>
        <p className="line-clamp-2 text-sm text-fg-2">{from ? `From ${from.title}` : 'From an approved decision'}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-edge-subtle pt-2.5 text-xs text-fg-2">
        <Who actor={`agent:run:${run.id}`} model={run.model} size={16} />
        <span className="inline-flex items-center gap-1.5">
          <RunStateBadge run={run} />
          <span>
            Drafting · <Elapsed start={run.started_at ?? run.created_at} />
          </span>
        </span>
        <PreviewButton label="Preview the new feature" onClick={onPreview} className={cn(ABOVE, 'ml-auto -my-1')} />
      </div>
    </article>
  );
}

/** A thread set aside: a parked idea, with the way back to it. */
export function ParkedRow({ projectId, thread, change }: { projectId: string; thread: Exploration; change: ChangeMark }) {
  return (
    <li data-parked={thread.id} data-card data-changed={change.changed ? 'true' : undefined} className={ROW}>
      <ChangedEdge on={change.changed} />
      <TypeIcon type="idea" size={16} className="shrink-0 text-fg-3" />
      <span className={ROW_TITLE}>
        <Link
          to="/p/$projectId/threads/$explorationId"
          params={{ projectId, explorationId: thread.id }}
          className={cn('line-clamp-2 text-base font-medium text-fg hover:text-accent-text', STRETCHED, 'after:rounded-none')}
        >
          {thread.purpose}
        </Link>
        <span className="block truncate text-xs text-fg-2">
          {thread.state_reason ? `${thread.state_reason} · ` : ''}
          <RelativeTime iso={thread.last_activity} prefix="Set aside" />
        </span>
      </span>
      {change.changed ? <ChangedBadge /> : null}
      <EntityState entity="exploration" state={thread.state} />
    </li>
  );
}

/**
 * Parked ideas (threads set aside) and "Capture an idea": an idea is saved as a thread without
 * asking DEMIURGO and without leaving the overview; the note says where it went.
 */
export function ParkedIdeas({
  projectId,
  threads,
  changeOf,
}: {
  projectId: string;
  threads: Exploration[];
  changeOf: (id: string) => ChangeMark;
}) {
  const tables = useTables();
  const command = useCommand(projectId);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<{ id: string; purpose: string } | null>(null);
  const focus = useReturnFocus();
  const canCapture = !!tables && canCreate(tables, 'exploration.open');
  if (threads.length === 0 && !canCapture) return null;
  return (
    <Section
      id="parked-ideas"
      title={<>Parked ideas{threads.length > 0 ? <span className="font-normal text-fg-2"> · {threads.length}</span> : null}</>}
      note="Threads set aside, to think through later."
      actions={
        canCapture ? (
          <Button
            size="sm"
            icon={<PlusIcon size={14} />}
            onClick={() => {
              command.reset();
              focus.capture();
              setOpen(true);
            }}
          >
            Capture an idea
          </Button>
        ) : null
      }
    >
      {saved ? (
        <p role="status" data-captured className="flex flex-wrap items-center gap-1.5 text-sm text-fg-2">
          <StateIcon kind="done" />
          Saved as a thread ·
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId: saved.id }}
            aria-label={`Open the thread ${saved.purpose}`}
            className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
          >
            Open the thread <ArrowRightIcon size={12} />
          </Link>
        </p>
      ) : null}
      {threads.length > 0 ? (
        <RowList label="Parked ideas">
          {threads.map((t) => (
            <ParkedRow key={t.id} projectId={projectId} thread={t} change={changeOf(t.id)} />
          ))}
        </RowList>
      ) : (
        <p className="text-sm text-fg-2">No idea is parked. Capture one to think it through later.</p>
      )}
      <PromptDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) focus.restore();
        }}
        title="Capture an idea"
        description="It is saved as a thread, to think it through later. DEMIURGO is not asked anything."
        label="Your idea"
        submit="Save as a thread"
        pendingLabel="Saving…"
        required
        maxLength={1000}
        pending={command.isPending}
        error={open ? command.error : null}
        onSubmit={(idea) =>
          command.mutate(
            { command: 'exploration.open', data: { purpose: idea.slice(0, 1000) } },
            {
              onSuccess: (r) => {
                setSaved({ id: r.entity_id, purpose: idea });
                setOpen(false);
                focus.restore();
                announce('Saved as a thread.');
              },
            },
          )
        }
      />
    </Section>
  );
}
