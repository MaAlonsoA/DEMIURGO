// Pieces of the product blueprint (canvas B1, S6A and S6C) that the H1 data supports: the progress
// line under the title, where each feature is (a pill), the features DEMIURGO is drafting, the
// ideas set aside, capturing an idea as a thread, what runs now and what was decided most recently.
// What needs a later increment (who uses it, the rules of the whole product) is a quiet "Later".

import { Link } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { Exploration, ProductRow, RunListItem } from '../../api/types.ts';
import { canCreate } from '../../api/tables.ts';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import { ago } from '../../lib/time.ts';
import { ActionBar } from '../../ui/ActionBar.tsx';
import { TextDialog } from '../../ui/dialogs.tsx';
import { ChevronRight, PlusIcon, RECORD_ICON, TypeIcon } from '../../ui/icons.tsx';
import { Mark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { whoOf } from '../../words.ts';
import { runDuration } from '../run/runs.ts';
import type { FeatureStatus, Progress } from './progress.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where a feature is, as the pill of its card: ink when ready, blue when it needs you, amber while DEMIURGO works. */
export function FeaturePill({ status, now }: { status: FeatureStatus; now: number }) {
  if (!status) return null;
  const base = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold';
  if (status.kind === 'ready') {
    return (
      <span data-feature-pill="ready" className={cn(base, 'bg-ink pl-2 text-white')}>
        <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5 12l5 5L20 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Ready to build
      </span>
    );
  }
  if (status.kind === 'needs') {
    return (
      <span data-feature-pill="needs" className={cn(base, 'bg-needs text-white')}>
        Needs you
      </span>
    );
  }
  return (
    <span data-feature-pill="working" className={cn(base, 'bg-working-bg pl-2 text-working-text')}>
      <span className="h-2 w-2 animate-pulse-soft rounded-full bg-working" aria-hidden="true" />
      Working · <span className="tabular-nums">{runDuration(status.run, now)}</span>
    </span>
  );
}

function segment(n: number, className: string, key: string) {
  return n > 0 ? <span key={key} className={cn('h-2 rounded-full', className)} style={{ flexGrow: n }} /> : null;
}

/** The progress line under the title (canvas B1): features ready, needing you and in progress. */
export function ProgressLine({ progress }: { progress: Progress }) {
  const { total, ready, needs, working } = progress;
  if (total === 0 && working === 0) return <span className="text-[14px] text-ink-3">No features yet.</span>;
  const rest = Math.max(0, total - ready - needs - working);
  const parts = [needs ? `${needs} ${needs === 1 ? 'needs' : 'need'} you` : '', working ? `${working} in progress` : ''].filter(
    Boolean,
  );
  const text = `Ready to build: ${ready} of ${plural(total, 'feature')}`;
  return (
    <span className="mt-1.5 flex items-center gap-4" data-progress-line>
      <Tip text={[text, ...parts].join(' · ')}>
        <span role="img" aria-label={[text, ...parts].join(', ')} className="flex w-[320px] gap-1">
          {segment(ready, 'bg-ink', 'ready')}
          {segment(needs, 'bg-needs', 'needs')}
          {segment(working, 'bg-working-bar', 'working')}
          {segment(rest, 'border border-bar-empty', 'rest')}
        </span>
      </Tip>
      <span className="text-[13px] text-ink-2">
        <strong className="font-semibold text-ink">{text}</strong>
        {parts.map((p) => (
          <span key={p}>
            <span className="text-inactive-light"> · </span>
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
      <h2 id={id} className="text-xs font-semibold text-muted">
        {title}
      </h2>
      <p className="flex min-h-[38px] items-center gap-2.5 rounded-[10px] border border-dashed border-line-strong px-3 py-1.5 text-[13px] leading-snug text-muted">
        <span className="shrink-0 rounded-full border border-dashed border-inactive px-2 text-[11px] font-semibold text-ink-3">
          Later
        </span>
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

/** A feature DEMIURGO is drafting from a decision (B1 "Drafting"): it exists once its package is accepted. */
export function DraftingCard({
  projectId,
  run,
  from,
  now,
}: {
  projectId: string;
  run: RunListItem;
  /** The decision it drafts from, when the product state knows it. */
  from: ProductRow | undefined;
  now: number;
}) {
  const command = useCommand(projectId);
  return (
    <div
      data-drafting={run.id}
      className="flex min-h-[150px] min-w-0 flex-col gap-1.5 rounded-[var(--radius-card)] border border-line bg-surface p-3.5"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
        <TypeIcon kind="feature" size={14} />
        Feature
      </span>
      <span className="mt-0.5 flex">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-working-bg py-0.5 pr-2.5 pl-2 text-xs font-semibold text-working-text">
          <Mark kind="working" size={9} label="Working" />
          Drafting · <span className="tabular-nums">{runDuration(run, now)}</span>
        </span>
      </span>
      <strong className="text-[15px] leading-snug font-semibold">A new feature</strong>
      <span className="line-clamp-2 text-[13px] text-ink-3">
        {from ? (
          <>
            From{' '}
            <Link
              to="/p/$projectId/records/$code"
              params={{ projectId, code: from.code }}
              className="font-medium text-ink-2 hover:text-needs"
            >
              {from.title}
            </Link>
          </>
        ) : (
          'From an approved decision'
        )}
      </span>
      <span className="mt-auto flex items-center justify-between gap-2 border-t border-line-soft pt-2 text-xs text-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          <WhoMark actor={`agent:run:${run.id}`} model={run.model} size={18} />
          <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: run.id }} className="truncate hover:text-ink">
            Writing a first draft
          </Link>
        </span>
        <ActionBar
          entity="ai_run"
          state={run.state}
          size="sm"
          handlers={{
            'run.cancel': {
              variant: 'working',
              disabled: command.isPending,
              run: () => command.mutate({ command: 'run.cancel', entityId: run.id }),
            },
          }}
        />
      </span>
      {command.error ? <Reasons error={command.error} /> : null}
    </div>
  );
}

/** A thread set aside, as a parked idea (B1): dashed, with the way back to it. */
export function ParkedCard({ projectId, thread, dimmed }: { projectId: string; thread: Exploration; dimmed: boolean }) {
  return (
    <Link
      to="/p/$projectId/threads/$explorationId"
      params={{ projectId, explorationId: thread.id }}
      data-parked={thread.id}
      data-dimmed={dimmed ? 'true' : undefined}
      className={cn(
        'flex min-h-[150px] min-w-0 flex-col gap-2 rounded-[var(--radius-card)] border border-dashed border-inactive p-3.5 text-ink transition-opacity hover:border-ink-3',
        dimmed && 'opacity-40 hover:opacity-100 focus-visible:opacity-100',
      )}
    >
      <span className="self-start rounded-full border border-dashed border-inactive px-2 py-px text-xs font-semibold text-ink-3">
        Parked idea
      </span>
      <strong className="line-clamp-2 text-[15px] leading-snug font-semibold">{thread.purpose}</strong>
      {thread.state_reason && <span className="line-clamp-2 text-[13px] text-ink-3">{thread.state_reason}</span>}
      <span className="mt-auto flex items-center gap-1.5 text-xs text-muted">
        <TypeIcon kind="thread" size={13} />
        Set aside {ago(thread.last_activity)}
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
    <div className="flex min-h-[150px] min-w-0 flex-col rounded-[var(--radius-card)] border border-dashed border-inactive">
      <button
        type="button"
        onClick={() => {
          command.reset();
          setOpen(true);
        }}
        className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-[var(--radius-card)] p-3.5 text-ink-3 hover:bg-surface/60 hover:text-ink"
      >
        <PlusIcon size={18} />
        <span className="font-semibold">Capture an idea</span>
      </button>
      {saved && (
        <p role="status" data-captured className="flex items-center justify-center gap-1.5 px-3 pb-3 text-xs text-ink-2">
          <Mark kind="done" size={9} label="Saved" />
          Saved as a thread
          <span className="text-inactive-light" aria-hidden="true">
            ·
          </span>
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId: saved.id }}
            aria-label={`Open the thread ${saved.purpose}`}
            className="inline-flex items-center gap-0.5 font-semibold text-needs hover:text-needs-hover"
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

/** What DEMIURGO is doing now (S6A, S6C): each run working, amber, with its time. */
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
      <h2 id={id} className="text-xs font-semibold text-muted">
        {title}
      </h2>
      {runs.length === 0 ? (
        <p className="text-[13px] text-ink-3">Nothing. I'm waiting for you.</p>
      ) : (
        <ul className="flex flex-col">
          {runs.map((r) => (
            <li key={r.id}>
              <Link
                to="/p/$projectId/runs/$runId"
                params={{ projectId, runId: r.id }}
                data-running={r.id}
                className="-mx-2 flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 text-[13px] hover:bg-line-soft"
              >
                <Mark kind="working" size={9} label="Working" />
                <span className="min-w-0 flex-1 truncate">
                  {r.action === 'design_proposal' ? 'Drafting a feature' : 'Answering'}
                  {r.exploration_id && threads.get(r.exploration_id) ? (
                    <span className="text-ink-3"> · {threads.get(r.exploration_id)}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs font-semibold text-working-text tabular-nums">{runDuration(r, now)}</span>
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
      <h2 id={id} className="text-xs font-semibold text-muted">
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
                className="-mx-2 flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 text-[13px] hover:bg-line-soft"
              >
                <Mark kind="confirmed" size={8} />
                <span className="flex shrink-0 text-muted">
                  <TypeIcon kind={RECORD_ICON[r.type] ?? 'decision'} size={12} />
                </span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
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
