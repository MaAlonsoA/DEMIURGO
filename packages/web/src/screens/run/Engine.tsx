// What the engine did for a run (DESIGN.md §3.4 "Engine calls", FDR-AGE-002): every call to the
// provider with its events as they arrived, polled while the run works, with a "Pause live
// updates" control so the list stops moving under the reader (R79). Failures are in product
// words (words.ts), never raw codes. `LiveProgress` is the one-line live reading shared with the
// thread and Day 1 ("Thinking… 1,240 tokens · 0:12", INV-RUN-19).

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type RunCall, providersQuery, runCallsQuery } from '../../api/models.ts';
import { type RunProgress, progressText } from '../../api/progress.ts';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { PauseCircleIcon, PlayIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { StatusBadge } from '../../components/status.tsx';
import { cn } from '../../lib/cn.ts';
import { failureWord } from '../../words.ts';
import { engineLabel, formatTokens } from '../models/engines.ts';
import { RawJson } from './Readable.tsx';
import { CALL_EVENT_WORDS, SESSION_WORDS, clockTime } from './runs.ts';

/** «Thinking… 1,240 tokens · 0:12» while the provider works. */
export function LiveProgress({
  progress,
  now,
  className,
}: {
  progress: RunProgress | undefined;
  now: number;
  className?: string;
}) {
  if (!progress) return null;
  return (
    <span data-run-progress className={cn('text-sm font-medium text-info-text tabular-nums', className)}>
      {progressText(progress, now)}
    </span>
  );
}

function offset(call: RunCall, at: string): string {
  const s = Math.max(0, (new Date(at).getTime() - new Date(call.started_at).getTime()) / 1000);
  return `+${s.toFixed(1)} s`;
}

const eventCount = (calls: readonly RunCall[] | undefined) => (calls ?? []).reduce((n, c) => n + c.events.length, 0);

/** The calls of a run: the engine calls tab of the run page. */
export function CallsPanel({ projectId, runId, active }: { projectId: string; runId: string; active: boolean }) {
  const [paused, setPaused] = useState<RunCall[] | null>(null);
  const live = active && paused === null;
  const calls = useQuery({ ...runCallsQuery(projectId, runId), refetchInterval: live ? 2000 : false });
  const catalogs = useQuery(providersQuery).data?.catalogs ?? [];

  if (calls.isPending) return <RowsSkeleton label="Loading the engine calls" rows={3} />;
  if (calls.error && !calls.data) return <ErrorNotice error={calls.error} onRetry={() => void calls.refetch()} />;
  const latest = calls.data ?? [];
  // While paused (and the run still works), the list is the one the person froze.
  const shown = active && paused ? paused : latest;
  const unseen = active && paused ? eventCount(latest) - eventCount(paused) : 0;

  return (
    <div data-run-calls className="flex flex-col gap-4">
      {active ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-2">
            {/* Only the switch is announced, never each new event (R80). */}
            <span role="status">{paused ? 'Live updates paused.' : 'Every event as it arrives.'}</span>
            {paused && unseen > 0 ? (
              <span className="font-medium text-fg"> {`${unseen} new ${unseen === 1 ? 'event' : 'events'} since.`}</span>
            ) : null}
          </p>
          <Button
            size="sm"
            variant="secondary"
            aria-pressed={paused !== null}
            icon={paused ? <PlayIcon size={14} /> : <PauseCircleIcon size={14} />}
            onClick={() => setPaused((p) => (p ? null : latest))}
          >
            {paused ? 'Resume live updates' : 'Pause live updates'}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-fg-2">Every event as it arrived.</p>
      )}
      {shown.length === 0 ? (
        <EmptyState title={active ? 'No engine call yet' : 'No engine calls'} headingLevel={3}>
          {active
            ? 'The engine is called once the run starts. Its events appear here as they arrive.'
            : 'This run ended before it called an engine.'}
        </EmptyState>
      ) : (
        <ol className="flex flex-col gap-3">
          {shown.map((c, i) => (
            <li key={c.id} className="rounded-lg border border-edge bg-panel">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-edge-subtle px-4 py-2.5">
                <h3 className="text-base font-semibold text-fg">{shown.length > 1 ? `Call ${i + 1}` : 'Call'}</h3>
                <span className="text-sm text-fg-2">
                  {engineLabel({ provider: c.provider, model: c.requested_model, effort: c.effort }, catalogs)}
                </span>
                <span className="text-sm text-fg-3">{SESSION_WORDS[c.session_mode] ?? c.session_mode}</span>
                <span className="ml-auto">
                  {c.state === 'error' ? (
                    <StatusBadge kind="problem" word="Failed" />
                  ) : c.state === 'running' ? (
                    <StatusBadge kind="working" word="Working" />
                  ) : (
                    <StatusBadge kind="done" word="Answered" />
                  )}
                </span>
              </div>
              <div className="flex flex-col gap-2 px-4 py-3">
                {c.state === 'error' ? (
                  <p className="text-sm text-danger-text">
                    {failureWord(c.failure_kind)}
                    {c.error ? <span className="block break-words text-fg-2">What it said: {c.error}</span> : null}
                  </p>
                ) : null}
                {c.events.length === 0 ? (
                  <p className="text-sm text-fg-3">{c.state === 'running' ? 'No events yet.' : 'It recorded no events.'}</p>
                ) : (
                  <ol aria-label={`Events of ${shown.length > 1 ? `call ${i + 1}` : 'the call'}`} className="flex flex-col">
                    {c.events.map((e) => (
                      <li
                        key={e.seq}
                        className="flex min-h-8 items-center gap-3 border-b border-edge-subtle text-sm last:border-b-0"
                      >
                        <span className="w-16 shrink-0 font-code text-xs text-fg-3 tabular-nums">{offset(c, e.received_at)}</span>
                        <span className={cn('font-medium', e.kind === 'error' ? 'text-danger-text' : 'text-fg')}>
                          {CALL_EVENT_WORDS[e.kind] ?? e.kind}
                        </span>
                        {e.tokens !== null ? (
                          <span className="text-fg-2 tabular-nums">{formatTokens(e.tokens)} tokens</span>
                        ) : null}
                        <time dateTime={e.received_at} className="ml-auto text-xs text-fg-3 tabular-nums">
                          {clockTime(e.received_at)}
                        </time>
                      </li>
                    ))}
                  </ol>
                )}
                {c.events.length > 0 ? <RawJson label="Raw events" value={c.events.map((e) => safeParse(e.raw))} /> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
