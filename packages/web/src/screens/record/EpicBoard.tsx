// The board of an epic (spec «Entrega por épicas», 2a), above its sections: how far its delivery
// goes, each feature of its list (a record with its code from the start) with its state, the one
// button that designs the next, changing the list by hand, the features outside the list, the
// walk-through ("Done when") and the epic's threads.

import { Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';
import type { ProductState, RecordDetail } from '../../api/types.ts';
import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleHalfIcon,
  CircleIcon,
} from '../../components/icons.tsx';
import { useMessages } from '../../i18n/define.ts';
import { canCreate } from '../../api/tables.ts';
import { useTables } from '../../lib/hooks.ts';
import { cn } from '../../lib/cn.ts';
import { DesignNextButton } from '../epics/DesignNext.tsx';
import {
  type EpicLine,
  type LineState,
  epicGroups,
  epicPlan,
  epicThreads,
  plannedOf,
} from '../epics/logic.ts';
import { AddFeature, LineControls } from '../epics/PlanEditing.tsx';
import { epicRef } from '../epics/plans.ts';
import { EPIC_BOARD } from '../epics/words.i18n.ts';
import { CopyBriefButton } from './CopyBrief.tsx';

const MARK: Record<LineState, ReactNode> = {
  built: <CheckCircleIcon size={14} className="text-success-text" />,
  ready: <CircleDotIcon size={14} className="text-accent-text" />,
  approved: <CircleIcon size={14} className="text-fg-2" />,
  designing: <CircleHalfIcon size={14} className="text-fg-2" />,
  unstarted: <CircleDashedIcon size={14} className="text-fg-3" />,
};

export function LineMark({ state }: { state: LineState }) {
  const t = useMessages(EPIC_BOARD);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-sm text-fg-2" data-line-state={state}>
      {MARK[state]}
      {t[`state_${state}`]}
    </span>
  );
}

/** The progress of an epic in one line: built of total, ready and in design. */
export function progressWords(
  t: { progress: (built: number, total: number) => string; ready: (n: number) => string; designing: (n: number) => string },
  counts: Record<LineState, number>,
  total: number,
): string {
  return [
    t.progress(counts.built, total),
    counts.ready > 0 ? t.ready(counts.ready) : null,
    counts.designing > 0 ? t.designing(counts.designing) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The name of a line: to its feature's page, or to its thread while it is only being designed. */
export function LineName({ projectId, line }: { projectId: string; line: EpicLine }) {
  if (line.row) {
    return (
      <Link
        to="/p/$projectId/records/$code"
        params={{ projectId, code: line.row.code }}
        className="font-medium text-fg hover:underline"
      >
        {line.name}
        <span className="ml-2 font-mono text-xs text-fg-3">{line.row.code}</span>
      </Link>
    );
  }
  const code = <span className="ml-2 font-mono text-xs text-fg-3">{line.code}</span>;
  if (line.thread) {
    return (
      <Link
        to="/p/$projectId/threads/$explorationId"
        params={{ projectId, explorationId: line.thread.id }}
        className="font-medium text-fg hover:underline"
      >
        {line.name}
        {code}
      </Link>
    );
  }
  return (
    <span className="font-medium text-fg">
      {line.name}
      {code}
    </span>
  );
}

export function EpicBoard({
  projectId,
  record,
  state,
}: {
  projectId: string;
  record: RecordDetail;
  state: ProductState | undefined;
}) {
  const t = useMessages(EPIC_BOARD);
  const id = useId();
  const tables = useTables();
  if (!state) return null;
  const rows = [...state.designs, ...state.decisions];
  const epic = rows.find((r) => r.code === record.code);
  if (!epic) return null;
  const features = epicGroups(rows).groups.find((g) => g.epic.code === record.code)?.features ?? [];
  const planned = plannedOf(state, record.code);
  const plan = epicPlan(epic, planned, features, rows, state.explorations);
  const ref = epicRef(epic);
  const editable = !!tables && canCreate(tables, 'planned_feature.add');
  const threads = epicThreads(
    state.explorations,
    record.versions.map((v) => v.id),
    features,
  );
  const allBuilt = plan.lines.length > 0 && plan.lines.every((l) => l.state === 'built');

  return (
    <section aria-labelledby={id} data-epic-board className="flex flex-col gap-4 rounded-lg border border-edge bg-panel px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-lg font-semibold text-fg">
          {t.title}
        </h2>
        {plan.lines.length > 0 ? (
          <span className="text-sm tabular-nums text-fg-2">{progressWords(t, plan.counts, plan.lines.length)}</span>
        ) : null}
      </div>
      <p className="max-w-prose text-sm text-fg-2">{t.planNote}</p>
      {!ref ? <p className="text-sm text-fg-2">{t.approveFirst}</p> : null}
      {plan.lines.length === 0 ? (
        <p className="text-sm text-fg-2">{t.noList}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-edge-subtle">
          {plan.lines.map((l, i) => (
            <li key={`${i}-${l.name}`} data-epic-line={l.name} className="flex flex-col gap-1.5 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="w-5 shrink-0 text-sm tabular-nums text-fg-3">{i + 1}.</span>
                <LineName projectId={projectId} line={l} />
                <span className="ml-auto flex items-center gap-3">
                  {editable ? <LineControls projectId={projectId} line={l} index={i} count={plan.lines.length} /> : null}
                  {l.state === 'ready' && l.row ? <CopyBriefButton projectId={projectId} code={l.row.code} size="sm" /> : null}
                  <LineMark state={l.state} />
                </span>
              </div>
              {l.phrase ? <p className="pl-8 text-sm text-fg-2">{l.phrase}</p> : null}
              {l.blockedBy.length > 0 ? (
                <p className="pl-8 text-sm text-warning-text">{t.blockedBy(l.blockedBy.join(', '))}</p>
              ) : null}
              {ref && plan.next === l ? (
                <div className="pl-8 pt-1">
                  <DesignNextButton projectId={projectId} epic={ref} line={l} size="sm" />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {editable ? <AddFeature projectId={projectId} epicId={record.id} /> : null}
      {plan.outside.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-edge-subtle pt-3" data-epic-outside>
          <h3 className="text-base font-semibold text-fg">{t.outside}</h3>
          <p className="text-sm text-fg-2">{t.outsideNote}</p>
          <ul className="flex flex-col gap-1">
            {plan.outside.map((f) => (
              <li key={f.code} className="text-sm">
                <Link to="/p/$projectId/records/$code" params={{ projectId, code: f.code }} className="text-fg hover:underline">
                  <span className="mr-2 font-mono text-xs text-fg-3">{f.code}</span>
                  {f.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="border-t border-edge-subtle pt-3 text-sm text-fg-2">
        <span className="font-medium text-fg">{t.doneWhen}: </span>
        {record.implementation === 'implemented' ? t.walkChecked : t.walkUnchecked}
        {record.implementation !== 'implemented' && !allBuilt && plan.lines.length > 0 ? ` ${t.walkEarly}` : null}
      </p>
      <div className="flex flex-col gap-1.5 border-t border-edge-subtle pt-3" data-epic-threads>
        <h3 className="text-base font-semibold text-fg">{t.threads}</h3>
        {threads.length === 0 ? (
          <p className="text-sm text-fg-2">{t.noThreads}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {threads.map((th) => (
              <li key={th.id} className={cn('flex flex-wrap items-baseline gap-x-2 text-sm', th.parent_id && 'pl-4')}>
                <Link
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: th.id }}
                  className="text-fg hover:underline"
                >
                  {th.purpose}
                </Link>
                {th.open_questions > 0 ? <span className="text-fg-2">· {t.openQuestions(th.open_questions)}</span> : null}
                {th.state !== 'active' ? <span className="text-fg-3">· {t.closed}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
