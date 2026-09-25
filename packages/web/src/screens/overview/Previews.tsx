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
import { TypeIcon, typeWord } from '../../components/types.tsx';
import { Who, whoName } from '../../components/Who.tsx';
import { whoOf } from '../../words.ts';
import { ReasonText } from '../record/RecordAside.tsx';
import { useReturnFocus } from '../record/returnFocus.ts';
import { rowStage, type Waiting, waitingCount, waitingPhrase } from '../record/logic.ts';

export type PreviewTarget = { kind: 'record'; code: string } | { kind: 'draft'; runId: string } | null;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function by(actor: string): string {
  const who = whoOf(actor);
  return who.kind === 'you' ? 'you' : whoName(who);
}

/** The reasons a record can't be built yet, as the server says them. */
function ReadinessFacts({ projectId, row }: { projectId: string; row: ProductRow }) {
  const r = row.readiness;
  if (!r) return null;
  const stage = rowStage(row);
  return (
    <section aria-label={r.ready ? 'Ready to build' : 'Before it can be built'} className="flex flex-col gap-2">
      <Readiness stage={stage} blocking={r.reasons.length} size="md" />
      {r.ready ? (
        <p className="text-sm text-fg-2">Nothing blocks it. Nothing is built yet.</p>
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
          {plural(r.warnings.length, 'warning')} on how its checks can be verified
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
  const shown = row.current ?? row.latest.n;
  const items: KeyValueItem[] = [
    { key: 'code', label: 'Code', value: <Code>{`${row.code} · v${shown}`}</Code> },
    {
      key: 'versions',
      label: 'Versions',
      value: (
        <>
          {row.current !== null ? `v${row.current} current` : 'None approved yet'}
          {row.latest.n !== row.current ? <span className="text-fg-2"> · v{row.latest.n} draft</span> : null}
        </>
      ),
    },
    ...(row.type !== 'decision'
      ? [{ key: 'checks', label: 'Checks', value: row.checks === 0 ? 'None yet' : String(row.checks) }]
      : []),
    ...(row.origin_exploration
      ? [
          {
            key: 'origin',
            label: 'Comes from',
            value: (
              <Link
                to="/p/$projectId/threads/$explorationId"
                params={{ projectId, explorationId: row.origin_exploration }}
                className="font-medium text-accent-text hover:underline"
              >
                {thread ?? 'Its thread'}
              </Link>
            ),
          },
        ]
      : []),
    {
      key: 'last',
      label: row.latest.state === 'approved' ? 'Approved by' : 'Drafted by',
      value: (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Who actor={row.updated_by} size={16} showName={false} />
          {by(row.updated_by)} · <DayTime iso={row.updated_at} />
        </span>
      ),
    },
  ];
  const needs = waitingCount(waiting);
  return (
    <>
      {needs > 0 ? (
        <Notice tone="accent" title="Needs you">
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
  return (
    <PreviewSheet
      open={open && !!row}
      onOpenChange={onOpenChange}
      title={row?.title ?? ''}
      eyebrow={
        row ? (
          <>
            <TypeIcon type={row.type} size={14} className="text-fg-3" />
            {typeWord(row.type)}
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
            Open <ArrowRightIcon size={14} />
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
  const command = useCommand(projectId);
  const [cancelling, setCancelling] = useState(false);
  const focus = useReturnFocus();
  return (
    <PreviewSheet
      open={open && !!run}
      onOpenChange={onOpenChange}
      title="A new feature"
      eyebrow={
        <>
          <TypeIcon type="fdr" size={14} className="text-fg-3" />
          Feature
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
              Open the run <ArrowRightIcon size={14} />
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
                From{' '}
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: from.code }}
                  className="font-medium text-accent-text hover:underline"
                >
                  {from.title}
                </Link>
              </>
            ) : (
              'From an approved decision'
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
            <Who actor={`agent:run:${run.id}`} model={run.model} size={18} />
            <span>is writing a first draft ·</span>
            <RunStateBadge run={run} withDetail />
            <Elapsed start={run.started_at ?? run.created_at} />
          </div>
          <p className="text-sm text-fg-2">It becomes a feature when you accept its package.</p>
          {command.error && !cancelling ? <ErrorNotice error={command.error} /> : null}
          <ConfirmDialog
            open={cancelling}
            onOpenChange={(o) => {
              setCancelling(o);
              if (!o) focus.restore();
            }}
            title="Cancel this draft?"
            description="DEMIURGO stops writing it. Nothing is applied; what it already wrote in the thread stays."
            confirm="Cancel the draft"
            cancel="Keep drafting"
            tone="danger"
            pendingLabel="Cancelling…"
            pending={command.isPending}
            error={cancelling ? command.error : null}
            onConfirm={() =>
              command.mutate(
                { command: 'run.cancel', entityId: run.id },
                {
                  onSuccess: () => {
                    setCancelling(false);
                    announce('The draft was cancelled.');
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
