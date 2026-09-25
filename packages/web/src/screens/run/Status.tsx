// The summary of a run, first on its page (DESIGN.md §3.4, §4.2; R28 R05 R04): a status card that
// says in plain words what is happening or what happened — the live progress while it works, the
// UI's own reading when it looks stalled or late, the failure in product words with the agent's
// own error, and the next step, which differs for Failed and Interrupted (R09) — and the phase
// strip Requested → Context → Model → Result with the phase where it stopped marked (R01, R10).

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { forwardRef } from 'react';
import { runCallsQuery } from '../../api/models.ts';
import { useRunProgress } from '../../api/progress.ts';
import type { RunDetail, RunListItem } from '../../api/types.ts';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CircleIcon,
  HourglassIcon,
  MinusCircleIcon,
  XCircleIcon,
} from '../../components/icons.tsx';
import type { RunView } from '../../components/runState.tsx';
import { WorkingDot } from '../../components/status.tsx';
import { useNow } from '../../components/Time.tsx';
import { cn } from '../../lib/cn.ts';
import { failureWord } from '../../words.ts';
import { LiveProgress } from './Engine.tsx';
import { runEventsQuery } from './hooks.ts';
import { PHASE_STATE_WORDS, type Phase, phasesOf } from './phases.ts';
import { clockTime, nextStep, runDuration } from './runs.ts';

const linkClass = 'inline-flex items-center gap-1 text-base font-medium text-accent-text hover:underline';

const TONE_CLASS = {
  danger: 'border-danger-edge bg-danger-soft',
  warning: 'border-warning-edge bg-warning-soft',
  success: 'border-success-edge bg-success-soft',
  info: 'border-info-edge bg-info-soft',
  neutral: 'border-edge bg-sunken',
} as const;

/** "What is happening" / "What happened": the first thing on a run's page. */
export const StatusCard = forwardRef<
  HTMLElement,
  { projectId: string; run: RunDetail; item: RunListItem | undefined; view: RunView }
>(function StatusCard({ projectId, run: r, item, view }, ref) {
  const now = useNow(view.active);
  const progress = useRunProgress(view.active ? r.id : undefined);
  const tone: keyof typeof TONE_CLASS =
    view.kind === 'failed' || view.kind === 'interrupted'
      ? 'danger'
      : view.kind === 'stalled' || view.kind === 'late'
        ? 'warning'
        : view.kind === 'completed'
          ? 'success'
          : view.kind === 'cancelled'
            ? 'neutral'
            : 'info';
  const next = nextStep(r);

  return (
    <section
      ref={ref}
      data-run-status={view.kind}
      aria-labelledby="run-status-title"
      tabIndex={-1}
      className={cn('flex flex-col gap-3 rounded-lg border p-4 outline-none', TONE_CLASS[tone])}
    >
      <h2 id="run-status-title" className="text-sm font-medium text-fg-2">
        {view.active ? 'What is happening' : 'What happened'}
      </h2>

      {view.kind === 'queued' || view.kind === 'late' ? (
        <div className="flex flex-col gap-1">
          <p className="text-md font-medium text-fg">Waiting to start.</p>
          <p className="text-base text-fg-2">
            Queued for{' '}
            <span data-run-timer className="tabular-nums">
              {runDuration(r, now)}
            </span>
            .{' '}
            {view.kind === 'late'
              ? "That is longer than usual: this page's reading, not DEMIURGO's. You can wait or cancel it."
              : 'An engine takes it as soon as one is free.'}
          </p>
        </div>
      ) : null}

      {view.kind === 'working' || view.kind === 'stalled' ? (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-md font-medium text-fg">
            {view.kind === 'working' ? <WorkingDot /> : <HourglassIcon size={16} className="text-warning-text" />}
            DEMIURGO is working…
          </p>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-base text-fg-2">
            {progress ? (
              <LiveProgress progress={progress} now={now} />
            ) : (
              <span>{"This page hasn't heard from its engine yet."}</span>
            )}
            <span>
              Running for{' '}
              <span data-run-timer className="tabular-nums">
                {runDuration(r, now)}
              </span>
            </span>
          </p>
          {view.kind === 'stalled' ? (
            <p className="text-base text-warning-text">
              {`${view.detail}. This is this page's reading, not DEMIURGO's: the engine may still be thinking. You can wait or cancel it.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {view.kind === 'completed' ? (
        <div className="flex flex-col gap-2">
          <p className="text-md font-medium text-fg">Finished in {runDuration(r) || '0:00'}.</p>
          <p className="text-base text-fg-2">
            {item?.batch_id
              ? 'It proposed what it found: it waits for you before anything changes.'
              : 'What it wrote is in its thread.'}
          </p>
          {item?.batch_id ? (
            <Link to="/p/$projectId/batches/$batchId" params={{ projectId, batchId: item.batch_id }} className={linkClass}>
              Review
              <ArrowRightIcon size={14} />
            </Link>
          ) : item?.exploration_id ? (
            <Link
              to="/p/$projectId/threads/$explorationId"
              params={{ projectId, explorationId: item.exploration_id }}
              className={linkClass}
            >
              Open the thread
              <ArrowRightIcon size={14} />
            </Link>
          ) : null}
        </div>
      ) : null}

      {view.kind === 'failed' || view.kind === 'interrupted' || view.kind === 'cancelled' ? (
        <div className="flex flex-col gap-2">
          <p className="text-md font-medium text-fg">
            {failureWord(r.failure_kind ?? (view.kind === 'cancelled' ? 'cancelled' : null), r.state)}
          </p>
          {r.error ? (
            <p className="text-base text-fg-2">
              <span className="font-medium text-fg">What it said: </span>
              <span className="break-words">{r.error}</span>
            </p>
          ) : null}
          {next ? (
            <p className="text-base text-fg-2">
              <span className="font-medium text-fg">Next: </span>
              {next}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});

const PHASE_ICON = {
  done: CheckCircleIcon,
  stopped: XCircleIcon,
  pending: CircleIcon,
} as const;

/** Requested → Context → Model → Result, each with its time and a word for its state. */
export function PhaseStrip({ projectId, run: r }: { projectId: string; run: RunDetail }) {
  const events = useQuery(runEventsQuery(projectId, r)).data;
  const calls = useQuery(runCallsQuery(projectId, r.id)).data;
  const contextAt = events?.find((e) => e.command === 'context_pack.build')?.at ?? null;
  const answered = (calls ?? []).some((c) => c.state === 'ok');
  const phases = phasesOf(r, { contextAt, answered });
  const stoppedAs = r.state === 'cancelled' ? 'Cancelled here' : r.state === 'interrupted' ? 'Interrupted here' : null;
  return (
    <section aria-labelledby="run-phases-title" className="flex flex-col gap-3">
      <h2 id="run-phases-title" className="text-base font-semibold text-fg">
        How far it got
      </h2>
      <ol data-run-phases className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:gap-0">
        {phases.map((p, i) => (
          <PhaseStep key={p.key} phase={p} last={i === phases.length - 1} stoppedAs={stoppedAs} />
        ))}
      </ol>
    </section>
  );
}

function PhaseStep({ phase: p, last, stoppedAs }: { phase: Phase; last: boolean; stoppedAs: string | null }) {
  const word = p.state === 'stopped' && stoppedAs ? stoppedAs : PHASE_STATE_WORDS[p.state];
  const cancelled = stoppedAs === 'Cancelled here';
  const Icon = p.state === 'current' ? null : p.state === 'stopped' && cancelled ? MinusCircleIcon : PHASE_ICON[p.state];
  return (
    <li data-phase={p.key} data-phase-state={p.state} className="relative flex items-start gap-2.5 sm:flex-col sm:gap-2 sm:pr-3">
      <div className="flex items-center gap-2 sm:w-full">
        <span
          className={cn(
            'relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-panel',
            p.state === 'done' && 'border-success-edge text-success-text',
            p.state === 'current' && 'border-info-edge',
            p.state === 'stopped' && (cancelled ? 'border-edge-strong text-fg-2' : 'border-danger-edge text-danger-text'),
            p.state === 'pending' && 'border-edge text-fg-3',
          )}
        >
          {Icon ? <Icon size={14} /> : <WorkingDot size={8} />}
        </span>
        {!last ? (
          <span aria-hidden className={cn('hidden h-px flex-1 sm:block', p.state === 'done' ? 'bg-success-edge' : 'bg-edge')} />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-base font-medium text-fg">{p.label}</span>
        <span
          className={cn(
            'text-sm',
            p.state === 'stopped' && !cancelled ? 'font-medium text-danger-text' : 'text-fg-2',
            p.state === 'current' && 'font-medium text-info-text',
          )}
        >
          {word}
          {p.at && p.state !== 'pending' ? (
            <>
              {' · '}
              <time dateTime={p.at} className="tabular-nums">
                {clockTime(p.at)}
              </time>
            </>
          ) : null}
        </span>
      </div>
    </li>
  );
}
