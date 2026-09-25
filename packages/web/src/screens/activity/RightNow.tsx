// "Right now" on Activity (DESIGN.md §3.4, §4.2; R06 R11): the runs that are queued or working,
// each with its state — Late and Stalled included, as the UI's reading — what it is doing now
// (the live progress), how long it has been at it, and the way to its page. Shown only while
// something works.

import { Link } from '@tanstack/react-router';
import { useRunProgress } from '../../api/progress.ts';
import type { RunListItem } from '../../api/types.ts';
import { ArrowRightIcon } from '../../components/icons.tsx';
import { Section } from '../../components/Page.tsx';
import { RunStateBadge, useRunView } from '../../components/runState.tsx';
import { useNow } from '../../components/Time.tsx';
import { ACTION_WORDS } from '../../words.ts';
import { LiveProgress } from '../run/Engine.tsx';
import { runDuration } from '../run/runs.ts';

export function RightNow({
  projectId,
  runs,
  purposeOf,
}: {
  projectId: string;
  runs: RunListItem[];
  purposeOf: (id: string | null) => string | undefined;
}) {
  if (runs.length === 0) return null;
  return (
    <Section title="Right now" id="right-now" note={`${runs.length} ${runs.length === 1 ? 'run is' : 'runs are'} on it.`}>
      <ul className="flex flex-col gap-2">
        {runs.map((r) => (
          <WorkingRun key={r.id} projectId={projectId} run={r} purpose={purposeOf(r.exploration_id)} />
        ))}
      </ul>
    </Section>
  );
}

function WorkingRun({ projectId, run: r, purpose }: { projectId: string; run: RunListItem; purpose: string | undefined }) {
  const view = useRunView(r);
  const now = useNow(true);
  const progress = useRunProgress(r.id);
  const worried = view.kind === 'stalled' || view.kind === 'late';
  return (
    <li
      data-right-now={r.id}
      className={
        worried
          ? 'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-warning-edge bg-warning-soft px-4 py-3'
          : 'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-edge bg-panel px-4 py-3'
      }
    >
      <RunStateBadge run={r} size="md" />
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-base">
          <span className="font-medium text-fg">{ACTION_WORDS[r.action] ?? r.action}</span>
          {purpose ? <span className="min-w-0 truncate text-fg-2">in {purpose}</span> : null}
        </p>
        <p className="flex flex-wrap items-baseline gap-x-3 text-sm text-fg-2">
          {view.detail ? <span className="font-medium text-warning-text">{view.detail}</span> : null}
          {progress && view.kind !== 'queued' && view.kind !== 'late' ? <LiveProgress progress={progress} now={now} /> : null}
          <span>
            {view.kind === 'queued' || view.kind === 'late' ? 'Waiting ' : 'Running '}
            <span className="tabular-nums">{runDuration(r, now)}</span>
          </span>
        </p>
      </div>
      <Link
        to="/p/$projectId/runs/$runId"
        params={{ projectId, runId: r.id }}
        className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-accent-text hover:bg-hover"
      >
        Open the run
        <span className="sr-only">
          : {ACTION_WORDS[r.action] ?? r.action}
          {purpose ? ` in ${purpose}` : ''}
        </span>
        <ArrowRightIcon size={14} />
      </Link>
    </li>
  );
}
