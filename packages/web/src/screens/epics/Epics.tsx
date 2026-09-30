// The epics of the product (EPC), each with its features under it: how far its delivery goes, each
// feature of its list with its state and the next step. Work on an epic happens on its page.

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { inboxQuery, projectsQuery, stateQuery } from '../../api/queries.ts';
import type { Inbox, ProductRow, ProductState } from '../../api/types.ts';
import { buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { JourneyIcon } from '../../components/icons.tsx';
import { Certainty } from '../../components/status.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, usePageTitle } from '../../components/Page.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { useMessages } from '../../i18n/define.ts';
import { attentionByCode, attentionOf, type Attention } from '../../lib/attention.ts';
import { useProjectId, useTables } from '../../lib/hooks.ts';
import { canCreate } from '../../api/tables.ts';
import { useCommand } from '../../api/commands.ts';
import { Button } from '../../components/Button.tsx';
import { RecordRow, RowList, UNCHANGED } from '../overview/Cards.tsx';
import { AttentionMark } from '../record/AttentionMark.tsx';
import { CopyBriefButton } from '../record/CopyBrief.tsx';
import { LineMark, LineName, progressWords } from '../record/EpicBoard.tsx';
import { waitingFor } from '../record/logic.ts';
import { DesignNextButton } from './DesignNext.tsx';
import { type EpicGroup, epicGroups, epicPlan, epicStatus, plannedOf } from './logic.ts';
import { epicRef } from './plans.ts';
import { EPIC_BOARD, EPICS } from './words.i18n.ts';

/** One epic in small: its progress, each line of its list with its state, and the next step. */
function EpicSummary({
  projectId,
  group,
  state,
  inbox,
  attention,
}: {
  projectId: string;
  group: EpicGroup;
  state: ProductState;
  inbox: Inbox | undefined;
  attention: Map<string, Attention>;
}) {
  const t = useMessages(EPICS);
  const b = useMessages(EPIC_BOARD);
  const navigate = useNavigate();
  const rows = [...state.designs, ...state.decisions];
  const plan = epicPlan(group.epic, plannedOf(state, group.epic.code), group.features, rows, state.explorations);
  const ref = epicRef(group.epic);
  const row = (r: ProductRow) => (
    <RecordRow
      key={r.code}
      projectId={projectId}
      row={r}
      waiting={waitingFor(r.code, inbox, r.origin_exploration)}
      change={UNCHANGED}
      onPreview={() => void navigate({ to: '/p/$projectId/records/$code', params: { projectId, code: r.code } })}
    />
  );
  if (plan.lines.length === 0) {
    return group.features.length === 0 ? (
      <p className="text-sm text-fg-2">{t.noFeatures}</p>
    ) : (
      <RowList label={`${t.features}: ${group.epic.title}`}>{group.features.map(row)}</RowList>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-epic-summary={group.epic.code}>
      <p className="text-sm tabular-nums text-fg-2">
        {progressWords(b, plan.counts, plan.lines.length)}
        {!ref ? ` · ${b.approveFirst}` : null}
      </p>
      <ol className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge bg-panel">
        {plan.lines.map((l, i) => (
          <li key={`${i}-${l.name}`} data-epic-line={l.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
            <span className="w-5 shrink-0 text-sm tabular-nums text-fg-3">{i + 1}.</span>
            <LineName projectId={projectId} line={l} />
            {l.blockedBy.length > 0 ? <span className="text-sm text-warning-text">{b.blockedBy(l.blockedBy.join(', '))}</span> : null}
            <span className="ml-auto flex items-center gap-3">
              {ref && plan.next === l ? <DesignNextButton projectId={projectId} epic={ref} line={l} size="sm" /> : null}
              {l.state === 'ready' && l.row ? <CopyBriefButton projectId={projectId} code={l.row.code} size="sm" /> : null}
              {attention.has(l.row?.code ?? l.code) ? <AttentionMark projectId={projectId} code={l.row?.code ?? l.code} /> : null}
              <LineMark state={l.state} />
            </span>
          </li>
        ))}
      </ol>
      {plan.outside.length > 0 ? (
        <>
          <p className="text-sm text-fg-2">
            <span className="font-medium text-fg">{b.outside}: </span>
            {b.outsideNote}
          </p>
          <RowList label={`${b.outside}: ${group.epic.title}`}>{plan.outside.map(row)}</RowList>
        </>
      ) : null}
    </div>
  );
}

/** Up and down in the backlog order: the person ranks the epics by hand. */
function EpicMoves({ projectId, epic, index, count }: { projectId: string; epic: ProductRow; index: number; count: number }) {
  const t = useMessages(EPICS);
  const command = useCommand(projectId);
  const move = (direction: 'up' | 'down') =>
    command.mutate({ command: 'record.move_epic', entityId: epic.id ?? '', data: { direction } });
  return (
    <span className="inline-flex items-center gap-1" data-epic-moves={epic.code}>
      <Button size="sm" variant="quiet" disabled={index === 0 || command.isPending} onClick={() => move('up')} aria-label={t.moveUp(epic.title)}>
        ↑
      </Button>
      <Button
        size="sm"
        variant="quiet"
        disabled={index === count - 1 || command.isPending}
        onClick={() => move('down')}
        aria-label={t.moveDown(epic.title)}
      >
        ↓
      </Button>
    </span>
  );
}

/** The epic's own code and those of its features, designed or not. */
function epicCodes(state: ProductState, g: EpicGroup): string[] {
  const rows = [...state.designs, ...state.decisions];
  const plan = epicPlan(g.epic, plannedOf(state, g.epic.code), g.features, rows, state.explorations);
  return [g.epic.code, ...plan.lines.map((l) => l.row?.code ?? l.code), ...plan.outside.map((f) => f.code)];
}

export function EpicsScreen() {
  const t = useMessages(EPICS);
  const projectId = useProjectId();
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId));
  const project = useQuery(projectsQuery).data?.find((p) => p.id === projectId);
  usePageTitle([t.title, project?.name]);

  const s = state.data;
  const attention = attentionByCode(inbox.data);
  const tables = useTables();
  const canMove = !!tables && canCreate(tables, 'record.move_epic');
  const { groups } = epicGroups(s ? [...s.designs, ...s.decisions] : []);
  const featureCount = s ? groups.reduce((n, g) => n + Math.max(plannedOf(s, g.epic.code).length, g.features.length), 0) : 0;

  return (
    <>
      <PageHeader title={t.title} meta={s && groups.length > 0 ? <span className="tabular-nums">{t.meta(groups.length, featureCount)}</span> : null} />
      <PageBody width="wide" className="flex flex-col gap-8">
        {state.isPending ? (
          <Skeleton label={t.loading}>
            <Bone className="h-24 w-full" />
            <Bone className="h-24 w-full" />
          </Skeleton>
        ) : !s ? (
          <ErrorNotice error={state.error} onRetry={() => void state.refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState
            size="spacious"
            icon={<JourneyIcon size={28} />}
            title={t.noneYet}
            action={
              <Link to="/p/$projectId" params={{ projectId }} className={buttonClass({ variant: 'primary' })}>
                {t.goToProduct}
              </Link>
            }
          >
            {t.noneHint}
          </EmptyState>
        ) : (
          groups.map((g, i) => (
            <Section
              key={g.epic.code}
              id={`epic-${g.epic.code}`}
              title={
                <>
                  <span className="font-mono text-sm text-fg-3">{g.epic.code}</span> {g.epic.title}
                </>
              }
              note={g.epic.summary ?? undefined}
              actions={
                <span className="flex items-center gap-3">
                <span className="text-sm text-fg-2" data-epic-status={epicStatus(epicPlan(g.epic, plannedOf(s, g.epic.code), g.features, [...s.designs, ...s.decisions], s.explorations))}>
                  {t[`status_${epicStatus(epicPlan(g.epic, plannedOf(s, g.epic.code), g.features, [...s.designs, ...s.decisions], s.explorations))}`]}
                </span>
                {canMove ? <EpicMoves projectId={projectId} epic={g.epic} index={i} count={groups.length} /> : null}
                {s && attentionOf(attention, epicCodes(s, g)) > 0 ? <AttentionMark projectId={projectId} code={g.epic.code} /> : null}
                <Certainty status={g.epic.epistemic_status} />
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: g.epic.code }}
                  className={buttonClass({ size: 'sm' })}
                >
                  {t.open}
                </Link>
                </span>
              }
            >
              <EpicSummary projectId={projectId} group={g} state={s} inbox={inbox.data} attention={attention} />
            </Section>
          ))
        )}
      </PageBody>
    </>
  );
}
