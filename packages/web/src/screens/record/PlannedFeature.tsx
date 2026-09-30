// The page of a feature its epic lists and nobody has designed yet (a planned feature): its reserved
// code, its name and sentence, where it sits in its epic's list and the one step that designs it. It
// hangs from its epic in the breadcrumb; once designed, its FDR takes this same code and this address.

import { Link } from '@tanstack/react-router';
import type { Inbox, PlannedFeatureRow, ProductState } from '../../api/types.ts';
import { canCreate } from '../../api/tables.ts';
import { buttonClass } from '../../components/Button.tsx';
import { Code } from '../../components/Badge.tsx';
import { PageHeader } from '../../components/Page.tsx';
import { useMessages } from '../../i18n/define.ts';
import { pendingProposalsOf } from '../../lib/attention.ts';
import { useTables } from '../../lib/hooks.ts';
import { epicGroups, epicPlan, plannedOf } from '../epics/logic.ts';
import { LineControls } from '../epics/PlanEditing.tsx';
import { epicRef } from '../epics/plans.ts';
import { Block, DeliveryBanner, PrimaryAction, StatusWord, type Status, useDraftTasks } from './Delivery.tsx';
import { recordCrumbs } from './Header.tsx';
import { PendingProposals } from './PendingProposals.tsx';
import { DELIVERY, HEADER } from './words.i18n.ts';

export function PlannedFeaturePage({
  projectId,
  planned,
  state,
  inbox,
}: {
  projectId: string;
  planned: PlannedFeatureRow;
  state: ProductState;
  inbox?: Inbox | undefined;
}) {
  const t = useMessages(DELIVERY);
  const h = useMessages(HEADER);
  const tables = useTables();
  const draft = useDraftTasks(projectId, '');
  const rows = [...state.designs, ...state.decisions];
  const epic = rows.find((r) => r.code === planned.epic_code);
  const features = epicGroups(rows).groups.find((g) => g.epic.code === planned.epic_code)?.features ?? [];
  const plan = epic ? epicPlan(epic, plannedOf(state, epic.code), features, rows, state.explorations) : null;
  const index = plan ? plan.lines.findIndex((l) => l.code === planned.code) : -1;
  const line = plan && index >= 0 ? plan.lines[index] : undefined;
  const before = plan && index > 0 ? plan.lines[index - 1] : undefined;
  const after = plan && index >= 0 ? plan.lines[index + 1] : undefined;
  const ref = epic ? epicRef(epic) : null;
  const editable = !!tables && canCreate(tables, 'planned_feature.add');
  const waiting = pendingProposalsOf(inbox, planned.code) > 0;
  const status: Status = line?.thread ? { word: t.st_designing, tone: 'accent' } : { word: t.st_planned, tone: 'neutral' };
  const primary = line?.thread ? (
    <PrimaryAction projectId={projectId} primary={{ kind: 'thread', id: line.thread.id }} draft={draft} />
  ) : ref && line ? (
    <PrimaryAction projectId={projectId} primary={{ kind: 'design', epic: ref, line, label: t.designThis }} draft={draft} />
  ) : epic ? (
    <Link to="/p/$projectId/records/$code" params={{ projectId, code: epic.code }} className={buttonClass()}>
      {t.openEpic}
    </Link>
  ) : null;
  const sibling = (label: string, l: typeof before) =>
    l ? (
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-xs font-medium text-fg-3">{label}</dt>
        <dd className="text-sm">
          <Link to="/p/$projectId/records/$code" params={{ projectId, code: l.code }} className="text-accent-text hover:underline">
            <span className="mr-1.5 font-mono text-xs text-fg-3">{l.code}</span>
            {l.name}
          </Link>
        </dd>
      </div>
    ) : null;

  return (
    <div data-planned-feature={planned.code}>
      <PageHeader
        crumbs={recordCrumbs(projectId, { code: planned.code, type: 'fdr' }, planned.name, [], h, epic ? [epic] : [])}
        eyebrow={
          <>
            <Code>{planned.code}</Code>
            <StatusWord status={status} />
          </>
        }
        title={planned.name}
        meta={
          plan && index >= 0 && epic ? (
            <span className="tabular-nums">{t.plannedPlace(index + 1, plan.lines.length, `${epic.code} ${epic.title}`)}</span>
          ) : null
        }
        actions={<div data-planned-next>{primary}</div>}
      />
      <div className="@container">
        <div className="flex flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 @4xl:flex-row @4xl:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            {waiting ? (
              <DeliveryBanner
                projectId={projectId}
                banner={{ tone: 'accent', text: t.proposalWaiting(planned.code), action: { label: t.reviewProposal, anchor: 'proposal' } }}
              />
            ) : null}
            <PendingProposals projectId={projectId} code={planned.code} inbox={inbox} rows={rows} />
            <Block title={t.goal}>
              <p className="max-w-prose text-md text-fg">{planned.summary}</p>
              <p className="max-w-prose text-sm text-fg-2">
                {line?.thread ? t.plannedDesigning : !ref && epic ? t.approveEpic(epic.code) : t.plannedNote}
              </p>
            </Block>
          </div>
          <aside aria-label={t.railLabel} className="order-first flex w-full shrink-0 flex-col gap-4 @4xl:order-last @4xl:w-72 @6xl:w-80">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @4xl:grid-cols-1">
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs font-medium text-fg-3">{t.state}</dt>
                <dd>
                  <StatusWord status={status} />
                </dd>
              </div>
              {epic ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-xs font-medium text-fg-3">{t.epic}</dt>
                  <dd className="text-sm">
                    <Link to="/p/$projectId/records/$code" params={{ projectId, code: epic.code }} className="text-accent-text hover:underline">
                      <span className="mr-1.5 font-mono text-xs text-fg-3">{epic.code}</span>
                      {epic.title}
                    </Link>
                  </dd>
                </div>
              ) : null}
              {sibling(t.before, before)}
              {sibling(t.after, after)}
            </dl>
            {line && editable ? <LineControls projectId={projectId} line={line} index={index} count={plan?.lines.length ?? 0} /> : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
