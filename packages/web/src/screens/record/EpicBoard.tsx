// The body of an epic: Goal, its Features in order with their state and progress, Done when (its
// criteria), Out of scope, and folded the list editing, the coherence check and its threads. The one
// button that designs the next feature lives in the page header.

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { ProductState, RecordDetail, RecordVersion } from '../../api/types.ts';
import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleHalfIcon,
  CircleIcon,
} from '../../components/icons.tsx';
import { useMessages } from '../../i18n/define.ts';
import { canCreate } from '../../api/tables.ts';
import { useQuery } from '@tanstack/react-query';
import { inboxQuery } from '../../api/queries.ts';
import { attentionByCode } from '../../lib/attention.ts';
import { useTables } from '../../lib/hooks.ts';
import { cn } from '../../lib/cn.ts';
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
import { AttentionMark } from './AttentionMark.tsx';
import { CoherenceCheck } from './CoherenceCheck.tsx';
import { Block, CriteriaList, OtherSections, Prose, sectionOf } from './Delivery.tsx';
import type { Recording } from './Checks.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { DELIVERY } from './words.i18n.ts';

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

/** The name of a line: to its feature's page (the planned feature's own page until it is designed). */
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
  // Not designed yet: its own page, under its reserved code (its thread is linked from there).
  return (
    <Link to="/p/$projectId/records/$code" params={{ projectId, code: line.code }} className="font-medium text-fg hover:underline">
      {line.name}
      <span className="ml-2 font-mono text-xs text-fg-3">{line.code}</span>
    </Link>
  );
}

/** The plan of an epic, from the product state (null until it loads or for another record). */
export function useEpicPlan(state: ProductState | undefined, record: RecordDetail) {
  if (!state || record.type !== 'epic') return null;
  const rows = [...state.designs, ...state.decisions];
  const epic = rows.find((r) => r.code === record.code);
  if (!epic) return null;
  const features = epicGroups(rows).groups.find((g) => g.epic.code === record.code)?.features ?? [];
  const plan = epicPlan(epic, plannedOf(state, record.code), features, rows, state.explorations);
  return { epic, features, plan, ref: epicRef(epic) };
}

export function EpicBody({
  projectId,
  record,
  version,
  state,
  recording,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  state: ProductState | undefined;
  recording: Recording;
}) {
  const t = useMessages(EPIC_BOARD);
  const d = useMessages(DELIVERY);
  const tables = useTables();
  const attention = attentionByCode(useQuery(inboxQuery(projectId)).data);
  const found = useEpicPlan(state, record);
  const editable = !!tables && canCreate(tables, 'planned_feature.add');
  const doneText = sectionOf(version, 'Done when')?.content.trim();
  const plan = found?.plan;
  const threads =
    found && state
      ? epicThreads(
          state.explorations,
          record.versions.map((v) => v.id),
          found.features,
        )
      : [];
  return (
    <>
      <Prose version={version} section="Goal" label={d.goal} />
      <Block
        title={d.features}
        note={plan && plan.lines.length > 0 ? progressWords(t, plan.counts, plan.lines.length) : undefined}
      >
        {!found || !plan ? null : plan.lines.length === 0 ? (
          <p className="text-sm text-fg-2">{d.noFeatures}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-edge-subtle">
            {plan.lines.map((l, i) => (
              <li key={`${i}-${l.name}`} data-epic-line={l.name} className="flex flex-col gap-0.5 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="w-5 shrink-0 text-sm tabular-nums text-fg-3">{i + 1}.</span>
                  <LineName projectId={projectId} line={l} />
                  <span className="ml-auto flex items-center gap-3">
                    {attention.has(l.row?.code ?? l.code) ? <AttentionMark projectId={projectId} code={l.row?.code ?? l.code} /> : null}
                    <LineMark state={l.state} />
                  </span>
                </div>
                {l.phrase ? <p className="pl-8 text-sm text-fg-2">{l.phrase}</p> : null}
                {l.blockedBy.length > 0 ? (
                  <p className="pl-8 text-sm text-warning-text">{t.blockedBy(l.blockedBy.join(', '))}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Block>
      <Block title={d.doneWhen}>
        {doneText ? <Markdown className="max-w-prose">{doneText}</Markdown> : null}
        <CriteriaList criteria={version.criteria} recording={recording} />
      </Block>
      <Prose version={version} section="Out of scope" label={d.outOfScope} empty={d.notWritten} />
      <OtherSections version={version} used={['Goal', 'Done when', 'Out of scope']} />
      {found && plan ? (
        <details className="flex flex-col" data-epic-more>
          <summary className="cursor-pointer text-sm text-fg-2 hover:text-fg">{d.changeList}</summary>
          <div className="mt-4 flex flex-col gap-4">
            {plan.lines.length > 0 && editable ? (
              <ol className="flex flex-col divide-y divide-edge-subtle">
                {plan.lines.map((l, i) => (
                  <li key={`${i}-${l.name}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="w-5 shrink-0 text-sm tabular-nums text-fg-3">{i + 1}.</span>
                    <span className="min-w-0 flex-1 text-sm text-fg">{l.name}</span>
                    <LineControls projectId={projectId} line={l} index={i} count={plan.lines.length} />
                  </li>
                ))}
              </ol>
            ) : null}
            {editable ? <AddFeature projectId={projectId} epicId={record.id} /> : null}
            {plan.outside.length > 0 ? (
              <div className="flex flex-col gap-1.5" data-epic-outside>
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
            {found.ref ? (
              <CoherenceCheck
                projectId={projectId}
                epicId={record.id}
                code={record.code}
                allDesigned={plan.lines.length > 0 && plan.lines.every((l) => l.state !== 'unstarted' && l.state !== 'designing')}
              />
            ) : null}
            <div className="flex flex-col gap-1.5" data-epic-threads>
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
          </div>
        </details>
      ) : null}
    </>
  );
}
