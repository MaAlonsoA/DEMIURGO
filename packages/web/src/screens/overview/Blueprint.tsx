// Pieces of the product's standing that more than one page shows (DESIGN.md §3.5, §3.1 "You're up
// to date"): the progress line with its segmented bar and text legend, what runs now, the features
// ready to build and what was decided most recently. `ProgressLine` and `RunningNow` are also used by
// Needs you when nothing is left.

import { Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';
import type { ProductRow, RunListItem } from '../../api/types.ts';
import { ErrorNotice } from '../../components/Notice.tsx';
import { type BarSegment, SegmentedBar } from '../../components/Meter.tsx';
import { RunStateBadge } from '../../components/runState.tsx';
import { StateIcon } from '../../components/status.tsx';
import { Elapsed, RelativeTime } from '../../components/Time.tsx';
import { TypeIcon, typeWord } from '../../components/types.tsx';
import { cn } from '../../lib/cn.ts';
import { useMessages } from '../../i18n/define.ts';
import { whoOf } from '../../words.ts';
import type { Progress } from './progress.ts';
import { BLUEPRINT } from './words.i18n.ts';

/**
 * "Ready to build 1 of 3 features", then a bar whose every segment is named in a text legend (the
 * colors never carry the meaning alone, INVENTORY INV-OVW-03). Features being drafted don't exist
 * yet: they are said apart, not mixed into the features' total.
 */
export function ProgressLine({ progress, drafting = 0 }: { progress: Progress; drafting?: number }) {
  const t = useMessages(BLUEPRINT);
  const { total, ready, needs } = progress;
  const working = Math.max(0, progress.working - drafting);
  if (total === 0 && drafting === 0) return <p className="text-sm text-fg-2">{t.noFeaturesYet}</p>;
  const rest = Math.max(0, total - ready - needs - working);
  const segments: BarSegment[] = [
    { key: 'ready', value: ready, tone: 'success', label: t.readyToBuild },
    { key: 'needs', value: needs, tone: 'accent', label: needs === 1 ? t.needsYou : t.needYou },
    { key: 'working', value: working, tone: 'info', label: t.inProgress },
    { key: 'rest', value: rest, tone: 'neutral', label: t.notReadyYet },
  ];
  return (
    <div data-progress-line className="flex max-w-xl flex-col gap-2">
      <p className="text-sm text-fg-2">
        <strong className="font-semibold text-fg">{t.readyToBuildOf(ready, total)}</strong>
        {drafting > 0 ? <> · {drafting === 1 ? t.newOneBeingDrafted : t.newOnesBeingDrafted(drafting)}</> : null}
      </p>
      {total > 0 ? <SegmentedBar total={total} segments={segments.filter((s) => s.value > 0)} /> : null}
    </div>
  );
}

/** A panel of the side column: a small h2 and its content. */
export function AsidePanel({
  title,
  children,
  className,
  actions,
  ...rest
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
} & Record<`data-${string}`, unknown>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-2', className)} {...rest}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="text-base font-semibold text-fg">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

const ROW = '-mx-2 flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover';

/** What DEMIURGO is doing now: each run with its live state (Late and Stalled included) and time. */
export function RunningNow({
  projectId,
  runs,
  threads,
  title,
  error,
  onRetry,
}: {
  projectId: string;
  runs: RunListItem[];
  threads: Map<string, string>;
  /** Kept for callers that pass the clock: durations tick on their own now. */
  now?: number;
  title?: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  const t = useMessages(BLUEPRINT);
  return (
    <AsidePanel title={title ?? t.runningNow}>
      {error ? (
        <ErrorNotice error={error} compact focus={false} {...(onRetry ? { onRetry } : {})} />
      ) : runs.length === 0 ? (
        <p className="text-sm text-fg-2">{t.nothingWaitingForYou}</p>
      ) : (
        <ul className="flex flex-col">
          {runs.map((r) => {
            const thread = r.exploration_id ? threads.get(r.exploration_id) : undefined;
            return (
              <li key={r.id}>
                <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: r.id }} data-running={r.id} className={ROW}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-fg">
                      {r.action === 'design_proposal' ? t.draftingFeature : t.answering}
                    </span>
                    {thread ? <span className="block truncate text-xs text-fg-2">{thread}</span> : null}
                  </span>
                  <RunStateBadge run={r} />
                  <Elapsed start={r.started_at ?? r.created_at} className="w-10 shrink-0 text-right text-xs text-fg-2" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AsidePanel>
  );
}

/** The features whose readiness says nothing blocks them. */
export function ReadyToBuild({ projectId, rows }: { projectId: string; rows: ProductRow[] }) {
  const t = useMessages(BLUEPRINT);
  return (
    <AsidePanel title={t.readyToBuildTitle}>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-2">{t.nothingReadyYet}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.code}>
              <Link to="/p/$projectId/records/$code" params={{ projectId, code: r.code }} data-ready={r.code} className={ROW}>
                <StateIcon kind="done" />
                <span className="min-w-0 flex-1 truncate font-medium text-fg">{r.title}</span>
                <span className="sr-only">{t.readyToBuildSr}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AsidePanel>
  );
}

/** What a person decided most recently: the records whose latest version was approved last. */
export function RecentlyDecided({ projectId, rows }: { projectId: string; rows: ProductRow[] }) {
  const t = useMessages(BLUEPRINT);
  if (rows.length === 0) return null;
  return (
    <AsidePanel title={t.recentlyDecided}>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.code}>
            <Link to="/p/$projectId/records/$code" params={{ projectId, code: r.code }} data-decided={r.code} className={ROW}>
              <TypeIcon type={r.type} size={15} className="shrink-0 text-fg-3" />
              <span className="sr-only">{typeWord(r.type)}: </span>
              <span className="min-w-0 flex-1 truncate text-fg">{r.title}</span>
              <span className="shrink-0 text-xs text-fg-2">
                <RelativeTime iso={r.updated_at} />
                {whoOf(r.updated_by).kind === 'you' ? t.byYou : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </AsidePanel>
  );
}
