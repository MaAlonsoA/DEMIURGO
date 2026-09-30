// The side preview of the overview (DESIGN.md §3.5, D-015, INV-OVW-12/13): the facts of a record
// — what waits for you, its readiness with the server's reasons as they come, its versions, checks
// and origin — or of a feature being drafted, with the way to stop it. One sheet for the page;
// Esc or Close returns the focus to the Preview button that opened it. "Open" goes to the page.

import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { ProductRow, RunListItem } from '../../api/types.ts';
import { ActionBar } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { buttonClass } from '../../components/Button.tsx';
import { KeyValue, type KeyValueItem } from '../../components/Card.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { AlertTriangleIcon, ArrowRightIcon } from '../../components/icons.tsx';
import { Readiness } from '../../components/Meter.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { PreviewSheet } from '../../components/Preview.tsx';
import { RunStateBadge } from '../../components/runState.tsx';
import { Certainty, StatusBadge } from '../../components/status.tsx';
import { DayTime, Elapsed } from '../../components/Time.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { RecordKind } from '../../components/AspectTag.tsx';
import { aspectOfRecord } from '../../aspects.ts';
import { Who, whoName } from '../../components/Who.tsx';
import { useMessages } from '../../i18n/define.ts';
import { whoOf } from '../../words.ts';
import { ReasonText } from '../record/RecordAside.tsx';
import { useReturnFocus } from '../record/returnFocus.ts';
import { rowStage, type Waiting, waitingCount, waitingPhrase } from '../record/logic.ts';
import { PREVIEWS } from './words.i18n.ts';

export type PreviewTarget = { kind: 'record'; code: string } | { kind: 'draft'; runId: string } | null;

function by(actor: string, you: string): string {
  const who = whoOf(actor);
  return who.kind === 'you' ? you : whoName(who);
}

/** The reasons a record can't be built yet, as the server says them. */
function ReadinessFacts({ projectId, row }: { projectId: string; row: ProductRow }) {
  const t = useMessages(PREVIEWS);
  const r = row.readiness;
  if (!r) return null;
  const stage = rowStage(row);
  return (
    <section aria-label={r.ready ? t.readyToBuild : t.beforeItCanBeBuilt} className="flex flex-col gap-2">
      <Readiness stage={stage} blocking={r.reasons.length} reasons={r.reasons} size="md" />
      {r.ready ? (
        <p className="text-sm text-fg-2">{t.nothingBlocks}</p>
      ) : r.reasons.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg">
          {r.reasons.map((reason) => (
            <li key={reason} data-kind="reason">
              <ReasonText projectId={projectId} text={reason} />
            </li>
          ))}
        </ul>
      ) : null}
      {r.warnings.length > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-warning-text">
          <AlertTriangleIcon size={13} className="shrink-0" />
          {t.warning(r.warnings.length)}
        </p>
      ) : null}
    </section>
  );
}

function RecordFacts({
  projectId,
  row,
  waiting,
  thread,
}: {
  projectId: string;
  row: ProductRow;
  waiting: Waiting;
  thread: string | null;
}) {
  const t = useMessages(PREVIEWS);
  const shown = row.current ?? row.latest.n;
  const items: KeyValueItem[] = [
    { key: 'code', label: t.code, value: <Code>{`${row.code} · v${shown}`}</Code> },
    {
      key: 'versions',
      label: t.versions,
      value: (
        <>
          {row.current !== null ? t.current(row.current) : t.noneApprovedYet}
          {row.latest.n !== row.current ? <span className="text-fg-2"> · {t.draft(row.latest.n)}</span> : null}
        </>
      ),
    },
    ...(row.type !== 'decision'
      ? [{ key: 'checks', label: t.checks, value: row.checks === 0 ? t.noneYet : String(row.checks) }]
      : []),
    ...(row.origin_exploration
      ? [
          {
            key: 'origin',
            label: t.comesFrom,
            value: (
              <Link
                to="/p/$projectId/threads/$explorationId"
                params={{ projectId, explorationId: row.origin_exploration }}
                className="font-medium text-accent-text hover:underline"
              >
                {thread ?? t.itsThread}
              </Link>
            ),
          },
        ]
      : []),
    {
      key: 'last',
      label: row.latest.state === 'approved' ? t.approvedBy : t.draftedBy,
      value: (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Who actor={row.updated_by} size={16} showName={false} />
          {by(row.updated_by, t.you)} · <DayTime iso={row.updated_at} />
        </span>
      ),
    },
  ];
  const needs = waitingCount(waiting);
  return (
    <>
      {needs > 0 ? (
        <Notice tone="accent" title={t.needsYou}>
          {waitingPhrase(waiting).replace(/^Needs you: /, '')}
        </Notice>
      ) : null}
      {row.summary ? <p className="text-sm text-fg-2">{row.summary}</p> : null}
      <ReadinessFacts projectId={projectId} row={row} />
      <KeyValue items={items} />
    </>
  );
}

export function RecordPreview({
  projectId,
  row,
  waiting,
  thread,
  open,
  onOpenChange,
}: {
  projectId: string;
  row: ProductRow | undefined;
  waiting: Waiting;
  thread: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useMessages(PREVIEWS);
  return (
    <PreviewSheet
      open={open && !!row}
      onOpenChange={onOpenChange}
      title={row?.title ?? ''}
      eyebrow={
        row ? (
          <>
            <TypeIcon type={row.type} size={14} className="text-fg-3" />
            <RecordKind aspect={aspectOfRecord(row)} draft={row.current === null} />
            <Certainty status={row.epistemic_status} />
          </>
        ) : null
      }
      footer={
        row ? (
          <Link
            to="/p/$projectId/records/$code"
            params={{ projectId, code: row.code }}
            className={buttonClass({ variant: 'primary' })}
          >
            {t.open} <ArrowRightIcon size={14} />
          </Link>
        ) : null
      }
    >
      {row ? <RecordFacts projectId={projectId} row={row} waiting={waiting} thread={thread} /> : null}
    </PreviewSheet>
  );
}

/** A feature being drafted: where it comes from, how the run goes, and Cancel (which asks first). */
export function DraftPreview({
  projectId,
  run,
  from,
  open,
  onOpenChange,
}: {
  projectId: string;
  run: RunListItem | undefined;
  from: ProductRow | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useMessages(PREVIEWS);
  const command = useCommand(projectId);
  const [cancelling, setCancelling] = useState(false);
  const focus = useReturnFocus();
  return (
    <PreviewSheet
      open={open && !!run}
      onOpenChange={onOpenChange}
      title={t.aNewFeature}
      eyebrow={
        <>
          <TypeIcon type="fdr" size={14} className="text-fg-3" />
          {t.feature}
          <StatusBadge kind="proposed" />
        </>
      }
      footer={
        run ? (
          <>
            <Link
              to="/p/$projectId/runs/$runId"
              params={{ projectId, runId: run.id }}
              className={buttonClass({ variant: 'primary' })}
            >
              {t.openTheRun} <ArrowRightIcon size={14} />
            </Link>
            <ActionBar
              entity="ai_run"
              state={run.state}
              handlers={{
                'run.cancel': {
                  variant: 'quiet-danger',
                  run: () => {
                    command.reset();
                    focus.capture();
                    setCancelling(true);
                  },
                },
              }}
            />
          </>
        ) : null
      }
    >
      {run ? (
        <>
          <p className="text-sm text-fg">
            {from ? (
              <>
                {t.fromWord}{' '}
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: from.code }}
                  className="font-medium text-accent-text hover:underline"
                >
                  {from.title}
                </Link>
              </>
            ) : (
              t.fromApprovedDecision
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
            <Who actor={`agent:run:${run.id}`} model={run.model} size={18} />
            <span>{t.isWritingDraft}</span>
            <RunStateBadge run={run} withDetail />
            <Elapsed start={run.started_at ?? run.created_at} />
          </div>
          <p className="text-sm text-fg-2">{t.becomesFeature}</p>
          {command.error && !cancelling ? <ErrorNotice error={command.error} /> : null}
          <ConfirmDialog
            open={cancelling}
            onOpenChange={(o) => {
              setCancelling(o);
              if (!o) focus.restore();
            }}
            title={t.cancelThisDraft}
            description={t.cancelDraftDescription}
            confirm={t.cancelTheDraft}
            cancel={t.keepDrafting}
            tone="danger"
            pendingLabel={t.cancelling}
            pending={command.isPending}
            error={cancelling ? command.error : null}
            onConfirm={() =>
              command.mutate(
                { command: 'run.cancel', entityId: run.id },
                {
                  onSuccess: () => {
                    setCancelling(false);
                    announce(t.cancelledAnnounce);
                  },
                },
              )
            }
          />
        </>
      ) : null}
    </PreviewSheet>
  );
}
