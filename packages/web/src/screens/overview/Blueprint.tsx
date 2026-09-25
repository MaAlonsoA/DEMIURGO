// Pieces of the product blueprint (canvas B1, S6A and S6C) that the H1 data supports: the progress
// line under the title, the features DEMIURGO is drafting, the ideas set aside, capturing an idea
// as a thread, what runs now and what was decided most recently.
// What needs a later increment (who uses it, the rules of the whole product) is a quiet "Later".

import { FeatureCard as DsFeatureCard } from '@demiurgo/design-system';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { Exploration, ProductRow, RunListItem } from '../../api/types.ts';
import { canCreate } from '../../api/tables.ts';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import { ago } from '../../lib/time.ts';
import { ActionBar } from '../../ui/ActionBar.tsx';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { Detail } from '../../ui/Card.tsx';
import { TextDialog } from '../../ui/dialogs.tsx';
import { ChevronRight, PlusIcon, RECORD_ICON, TypeIcon } from '../../ui/icons.tsx';
import { Mark, MarkWord, WorkingMark } from '../../ui/marks.tsx';
import { Peek } from '../../ui/Peek.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { whoOf } from '../../words.ts';
import { runDuration } from '../run/runs.ts';
import type { Progress } from './progress.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One stretch of the line, drawn as the design system's stage bar and as long as its share. */
function segment(n: number, className: string, key: string) {
  return n > 0 ? <span key={key} className={cn('dm-bar basis-0', className)} style={{ flexGrow: n }} /> : null;
}

/** The progress line under the title (canvas B1): features ready, needing you and in progress. */
export function ProgressLine({ progress }: { progress: Progress }) {
  const { total, ready, needs, working } = progress;
  if (total === 0 && working === 0) return <span className="dm-text-body text-ink-3">No features yet.</span>;
  const rest = Math.max(0, total - ready - needs - working);
  const parts = [needs ? `${needs} ${needs === 1 ? 'needs' : 'need'} you` : '', working ? `${working} in progress` : ''].filter(
    Boolean,
  );
  const text = `Ready to build: ${ready} of ${plural(total, 'feature')}`;
  return (
    <span className="mt-1.5 flex items-center gap-4" data-progress-line>
      <Tip text={[text, ...parts].join(' · ')}>
        {/* The language of the stage bars: ink is ready, amber is being worked on, empty is not yet; blue needs you. */}
        <span role="img" aria-label={[text, ...parts].join(', ')} className="dm-bars w-[320px]">
          {segment(ready, 'dm-bar--ink', 'ready')}
          {segment(needs, 'border-needs bg-needs', 'needs')}
          {segment(working, 'dm-bar--build', 'working')}
          {segment(rest, '', 'rest')}
        </span>
      </Tip>
      <span className="dm-text-small text-ink-2">
        <strong className="font-semibold text-ink">{text}</strong>
        {parts.map((p) => (
          <span key={p}>
            <span className="dm-sep"> · </span>
            {p}
          </span>
        ))}
      </span>
    </span>
  );
}

function Later({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="dm-text-caption font-semibold text-muted">
        {title}
      </h2>
      {/* Not there yet: the design system's faded look of what is not active. */}
      <p className="dm-text-small dm-faded flex min-h-[38px] items-center gap-2.5 rounded-control px-3 py-1.5 leading-snug">
        <span className="dm-label shrink-0 rounded-pill border border-dashed border-inactive px-2">Later</span>
        <span>{children}</span>
      </p>
    </section>
  );
}

/** Who uses it and the rules of the whole product: DEMIURGO reads them from the idea in a later increment (S6). */
export function LaterRows() {
  return (
    <div className="mb-7 grid grid-cols-2 gap-6" data-later>
      <Later title="Who uses it">In a later increment, DEMIURGO will read them from your idea.</Later>
      <Later title="Rules for the whole product">In a later increment, DEMIURGO will read them from your idea.</Later>
    </div>
  );
}

/** Zone 2 of the card: a feature being drafted is Proposed, it waits for you once its package arrives. */
const DRAFT_MARK = (
  <span className="inline-flex tracking-normal">
    <MarkWord kind="proposed" word="Proposed" />
  </span>
);

type DraftingProps = {
  projectId: string;
  run: RunListItem;
  /** The decision it drafts from, when the product state knows it. */
  from: ProductRow | undefined;
  now: number;
};

/** What the peek of a feature being drafted says: where it comes from, the way to stop it and to its run. */
function DraftingPeek({ projectId, run, from, now }: DraftingProps) {
  const command = useCommand(projectId);
  return (
    <Detail
      floating
      icon="feature"
      type="Feature"
      status={DRAFT_MARK}
      title="A new feature"
      line={
        from ? (
          <>
            From{' '}
            <Link
              to="/p/$projectId/records/$code"
              params={{ projectId, code: from.code }}
              className="font-medium text-needs-strong hover:underline"
            >
              {from.title}
            </Link>
          </>
        ) : (
          'From an approved decision'
        )
      }
      who={
        <>
          <WhoMark actor={`agent:run:${run.id}`} model={run.model} size={18} />
          <span>Writing a first draft</span>
        </>
      }
      actions={
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
          <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: run.id }} className={buttonClass('secondary')}>
            Open
            <ChevronRight size={12} />
          </Link>
        </>
      }
    >
      <span className="flex">
        <WorkingMark>Drafting · {runDuration(run, now)}</WorkingMark>
      </span>
      <p className="dm-text-small text-ink-3">It becomes a feature when you accept its package.</p>
      {command.error ? <Reasons error={command.error} /> : null}
    </Detail>
  );
}

/** A feature DEMIURGO is drafting from a decision (B1 "Drafting"): the design system's card, Proposed
    and with the Working signal. It exists once its package is accepted. Pointing shows where it comes
    from and the way to stop it; Enter opens its run. */
export function DraftingCard({ projectId, run, from, now }: DraftingProps) {
  const navigate = useNavigate();
  const line = from ? `From ${from.title}` : 'From an approved decision';
  return (
    <div data-drafting={run.id} className="min-w-0">
      <Peek
        className="h-full"
        label={`A new feature DEMIURGO is drafting. ${line}`}
        onOpen={() => void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId: run.id } })}
        content={<DraftingPeek projectId={projectId} run={run} from={from} now={now} />}
      >
        {(kept) => (
          <DsFeatureCard
            width="100%"
            state="proposed"
            mark={DRAFT_MARK}
            title="A new feature"
            line={line}
            who="demiurgo"
            whoMark={<WhoMark actor={`agent:run:${run.id}`} model={run.model} size={18} />}
            when={`started ${ago(run.started_at ?? run.created_at, now)}`}
            signals={<WorkingMark>Drafting · {runDuration(run, now)}</WorkingMark>}
            selected={kept}
          />
        )}
      </Peek>
    </div>
  );
}

/** A thread set aside, as a parked idea (B1): the card template, faded like everything not active,
    with the way back to it. */
export function ParkedCard({ projectId, thread, dimmed }: { projectId: string; thread: Exploration; dimmed: boolean }) {
  return (
    <Link
      to="/p/$projectId/threads/$explorationId"
      params={{ projectId, explorationId: thread.id }}
      data-parked={thread.id}
      data-dimmed={dimmed ? 'true' : undefined}
      className={cn(
        'dm-card dm-faded h-[var(--card-height)] min-w-0 transition-opacity hover:border-inactive',
        dimmed && 'opacity-40 hover:opacity-100 focus-visible:opacity-100',
      )}
    >
      <span className="dm-card-type">
        <TypeIcon kind="idea" size={14} />
        IDEA
        <span className="dm-sep" aria-hidden="true">
          ·
        </span>
        <span className="inline-flex tracking-normal">
          <MarkWord kind="parked" word="Parked" />
        </span>
      </span>
      <strong className="dm-card-title">{thread.purpose}</strong>
      {thread.state_reason && <span className="dm-card-line">{thread.state_reason}</span>}
      <span className="dm-card-foot">
        <span className="flex items-center gap-1.5">
          <TypeIcon kind="thread" size={13} />
          Set aside {ago(thread.last_activity)}
        </span>
      </span>
    </Link>
  );
}

/** "+ Capture an idea" (B1): saved as a thread, without asking DEMIURGO and without leaving the overview. */
export function CaptureIdea({ projectId }: { projectId: string }) {
  const tables = useTables();
  const command = useCommand(projectId);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<{ id: string; purpose: string } | null>(null);
  if (!tables || !canCreate(tables, 'exploration.open')) return null;
  return (
    <div className="dm-card dm-dashed h-[var(--card-height)] min-w-0 items-center justify-center gap-2.5">
      <Button
        variant="secondary"
        onClick={() => {
          command.reset();
          setOpen(true);
        }}
      >
        <PlusIcon size={14} />
        Capture an idea
      </Button>
      {saved && (
        <p role="status" data-captured className="dm-text-caption flex items-center justify-center gap-1.5 text-ink-2">
          <Mark kind="done" label="Saved" />
          Saved as a thread
          <span className="dm-sep" aria-hidden="true">
            ·
          </span>
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId: saved.id }}
            aria-label={`Open the thread ${saved.purpose}`}
            className="inline-flex items-center gap-0.5 font-semibold text-needs-strong hover:underline"
          >
            Open
            <ChevronRight size={11} />
          </Link>
        </p>
      )}
      <TextDialog
        open={open}
        onOpenChange={setOpen}
        title="Capture an idea"
        description="It is saved as a thread, to think it through later. DEMIURGO is not asked anything."
        label="Your idea"
        submit="Save as a thread"
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
              },
            },
          )
        }
      />
    </div>
  );
}

/** What DEMIURGO is doing now (S6A, S6C): each run, with the Working mark and its time at the end. */
export function RunningNow({
  projectId,
  runs,
  threads,
  now,
  title = 'Running now',
}: {
  projectId: string;
  runs: RunListItem[];
  threads: Map<string, string>;
  now: number;
  title?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h2 id={id} className="dm-text-caption font-semibold text-muted">
        {title}
      </h2>
      {runs.length === 0 ? (
        <p className="dm-text-small text-ink-3">Nothing. I'm waiting for you.</p>
      ) : (
        <ul className="flex flex-col">
          {runs.map((r) => (
            <li key={r.id}>
              <Link
                to="/p/$projectId/runs/$runId"
                params={{ projectId, runId: r.id }}
                data-running={r.id}
                className="dm-text-small -mx-2 flex items-center gap-2 rounded-control px-2 py-1 hover:bg-line-soft"
              >
                <span className="min-w-0 flex-1 truncate">
                  {r.action === 'design_proposal' ? 'Drafting a feature' : 'Answering'}
                  {r.exploration_id && threads.get(r.exploration_id) ? (
                    <span className="text-ink-3"> · {threads.get(r.exploration_id)}</span>
                  ) : null}
                </span>
                <WorkingMark>{runDuration(r, now)}</WorkingMark>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What was decided most recently (B1): the records a person approved last. */
export function RecentlyDecided({ projectId, rows }: { projectId: string; rows: ProductRow[] }) {
  const id = useId();
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h2 id={id} className="dm-text-caption font-semibold text-muted">
        Recently decided
      </h2>
      <ul className="flex flex-col">
        {rows.map((r) => {
          const who = whoOf(r.updated_by);
          return (
            <li key={r.code}>
              <Link
                to="/p/$projectId/records/$code"
                params={{ projectId, code: r.code }}
                data-decided={r.code}
                className="dm-text-small -mx-2 flex items-center gap-2 rounded-control px-2 py-1 hover:bg-line-soft"
              >
                <Mark kind="confirmed" />
                <span className="flex shrink-0 text-muted">
                  <TypeIcon kind={RECORD_ICON[r.type] ?? 'decision'} size={12} />
                </span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="dm-text-caption flex shrink-0 items-center gap-1 text-muted">
                  {ago(r.updated_at)}
                  {who.kind === 'you' ? ', by you' : ''}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
