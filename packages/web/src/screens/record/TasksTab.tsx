// The Tasks tab of a feature (Jira: the child work items of an epic; Linear: a project's issues in
// order): the drafts the planning agent proposed and the task records, in build order. Each row opens
// the task's own page. A package of drafts is accepted or rejected whole from here; a batch decided
// item by item is decided on each draft's page.

import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { canCreate } from '../../api/tables.ts';
import type { RecordDetail } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { useAllows } from '../../components/actions.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { PlusIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import { BUILD_TONE, Block, type DraftTasks, TONE_TEXT, liveTasks } from './Delivery.tsx';
import { DELIVERY } from './words.i18n.ts';

const ROW = 'flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5';

export function TasksTab({ projectId, record, draft }: { projectId: string; record: RecordDetail; draft: DraftTasks }) {
  const t = useMessages(DELIVERY);
  const tables = useTables();
  const tasks = liveTasks(record);
  const drafts = record.task_drafts ?? [];
  const uncovered = tasks.length > 0 ? (record.uncovered ?? []) : [];
  const writable = record.current !== null && !!tables && canCreate(tables, 'record.create');
  return (
    <Block id="tasks" title={t.tasks} note={t.buildOrder}>
      {tasks.length + drafts.length === 0 ? <p className="text-sm text-fg-2">{t.noTasks}</p> : null}
      <ol className="flex flex-col divide-y divide-edge-subtle">
        {tasks.map((x, i) => (
          <li key={x.code} data-task={x.code} className={ROW}>
            <span className="w-6 text-sm tabular-nums text-fg-3">{i + 1}.</span>
            <Link
              to="/p/$projectId/records/$code"
              params={{ projectId, code: x.code }}
              className="min-w-0 flex-1 basis-60 text-sm font-medium text-fg hover:underline"
            >
              <Code className="mr-2">{x.code}</Code>
              {x.title}
            </Link>
            <span className="flex items-center gap-3 text-sm text-fg-2">
              {x.size ? <span className="tabular-nums">{x.size}</span> : null}
              <span className={cn('font-medium', TONE_TEXT[BUILD_TONE[x.build]])}>{t[`st_${x.build}` as const]}</span>
            </span>
            {x.covers.length > 0 ? <span className="w-full pl-9 text-sm text-fg-2">{t.covers}: {x.covers.join(', ')}</span> : null}
          </li>
        ))}
        {drafts.map((d, i) => (
          <li key={d.proposal_id} data-task-draft={d.proposal_id} className={ROW}>
            <span className="w-6 text-sm tabular-nums text-fg-3">{tasks.length + i + 1}.</span>
            <Link
              to="/p/$projectId/records/$code/tasks/$proposalId"
              params={{ projectId, code: record.code, proposalId: d.proposal_id }}
              className="min-w-0 flex-1 basis-60 text-sm font-medium text-accent-text hover:underline"
            >
              {d.title}
            </Link>
            <span className="flex items-center gap-3 text-sm text-fg-2">
              {d.size ? <span className="tabular-nums">{d.size}</span> : null}
              <span className="font-medium text-warning-text">{t.st_proposed}</span>
            </span>
            {d.covers.length > 0 ? <span className="w-full pl-9 text-sm text-fg-2">{t.covers}: {d.covers.join(', ')}</span> : null}
          </li>
        ))}
      </ol>
      {drafts.length > 0 ? <DraftsDecision projectId={projectId} drafts={drafts} /> : null}
      {uncovered.length > 0 ? (
        <div className="flex flex-col items-start gap-2" data-uncovered={uncovered.join(' ')}>
          <p className="text-sm text-fg-2">{t.uncovered(uncovered.join(', '))}</p>
          {/* The approved feature has criteria no task covers (a newer version added them): plan only those. */}
          {writable && drafts.length === 0 ? (
            <Button variant="secondary" size="sm" pending={draft.pending} pendingLabel={t.drafting} onClick={draft.run} data-draft-missing>
              {t.draftMissing}
            </Button>
          ) : null}
          {draft.error ? <ErrorNotice error={draft.error} compact /> : null}
        </div>
      ) : null}
      {/* A failed draft request shows under the header's "Draft the tasks" button. */}
      {draft.asked ? <p className="text-sm text-fg-2">{t.draftAsked}</p> : null}
      {writable ? (
        <div>
          <Link
            to="/p/$projectId/records/new"
            params={{ projectId }}
            search={{ type: 'task', basedOn: record.code }}
            className={buttonClass({ variant: 'quiet', size: 'sm' })}
            data-add-task
          >
            <PlusIcon size={14} />
            {t.addTask}
          </Link>
        </div>
      ) : null}
    </Block>
  );
}

/** What to do with the drafts: open each to decide it, or (a package) accept or reject them all. */
function DraftsDecision({ projectId, drafts }: { projectId: string; drafts: NonNullable<RecordDetail['task_drafts']> }) {
  const t = useMessages(DELIVERY);
  const command = useCommand(projectId);
  const allowsBatch = useAllows('batch', 'pending');
  const [dialog, setDialog] = useState<null | 'accept' | 'reject'>(null);
  const batchId = drafts[0]?.batch_id;
  if (!batchId) return null;
  const byItem = drafts.some((d) => d.resolution === 'item');
  // One batch per planning run: the package decision goes to the first one; the rest follow when it is decided.
  const inBatch = drafts.filter((d) => d.batch_id === batchId).length;
  const run = (name: 'batch.accept_package' | 'batch.reject_package', said: string) =>
    command.mutate(
      { command: name, entityId: batchId, data: {} },
      {
        onSuccess: () => {
          setDialog(null);
          announce(said);
        },
      },
    );
  return (
    <div className="flex flex-col gap-2 border-t border-edge-subtle pt-3">
      <p className="text-sm text-fg-2">{byItem ? t.draftsHintItem : t.draftsHint}</p>
      {byItem ? <ApproveAllTasks projectId={projectId} drafts={drafts} /> : null}
      {!byItem ? (
        <>
          {command.error && !dialog ? <ErrorNotice error={command.error} /> : null}
          <div className="flex flex-wrap gap-2">
            {allowsBatch('batch.accept_package') ? (
              <Button variant="secondary" size="sm" data-command="batch.accept_package" onClick={() => { command.reset(); setDialog('accept'); }}>
                {t.acceptAllN(inBatch)}
              </Button>
            ) : null}
            {allowsBatch('batch.reject_package') ? (
              <Button variant="quiet-danger" size="sm" data-command="batch.reject_package" onClick={() => { command.reset(); setDialog('reject'); }}>
                {t.rejectAllN(inBatch)}
              </Button>
            ) : null}
          </div>
          <ConfirmDialog
            open={dialog === 'accept'}
            onOpenChange={(o) => !o && setDialog(null)}
            title={t.acceptDraftsTitle}
            description={<p>{t.acceptDraftsBody(inBatch)}</p>}
            confirm={t.acceptAllN(inBatch)}
            pendingLabel={t.accepting}
            pending={command.isPending}
            error={dialog === 'accept' ? command.error : null}
            onConfirm={() => run('batch.accept_package', t.draftsAccepted)}
          />
          <ConfirmDialog
            open={dialog === 'reject'}
            onOpenChange={(o) => !o && setDialog(null)}
            title={t.rejectDraftsTitle}
            description={<p>{t.rejectDraftsBody}</p>}
            confirm={t.rejectAllN(inBatch)}
            pendingLabel={t.rejecting}
            tone="danger"
            pending={command.isPending}
            error={dialog === 'reject' ? command.error : null}
            onConfirm={() => run('batch.reject_package', t.draftsRejected)}
          />
        </>
      ) : null}
    </div>
  );
}

/** "Approve all N" for drafts decided one by one: one confirmation listing the titles, then the same
 *  proposal.accept the task page runs, one draft at a time, stopping at the first error. */
function ApproveAllTasks({ projectId, drafts }: { projectId: string; drafts: NonNullable<RecordDetail['task_drafts']> }) {
  const t = useMessages(DELIVERY);
  const command = useCommand(projectId);
  const canAccept = useAllows('proposal', 'pending')('proposal.accept');
  const [open, setOpen] = useState(false);
  // Fixed when the confirmation opens, so the count does not move while they are approved.
  const [queue, setQueue] = useState<typeof drafts>([]);
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pending = canAccept ? drafts.filter((d) => d.resolution === 'item') : [];
  if (pending.length < 1 && !running && !error) return null;
  const n = running || error ? queue.length : pending.length;

  const start = async () => {
    const list = queue;
    setRunning(true);
    setError(null);
    setDone(0);
    for (let i = 0; i < list.length; i++) {
      try {
        await command.mutateAsync({ command: 'proposal.accept', entityId: list[i]!.proposal_id, data: { approve: true } });
      } catch (e) {
        setError(e);
        setRunning(false);
        setOpen(false);
        return;
      }
      setDone(i + 1);
    }
    setRunning(false);
    setOpen(false);
    announce(t.allTasksApproved(list.length));
  };

  return (
    <div className="flex flex-col gap-2" data-approve-all-tasks>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={running}
          onClick={() => {
            setQueue(pending);
            setError(null);
            setOpen(true);
          }}
        >
          {t.approveAllN(n)}
        </Button>
        {running ? <span className="text-sm text-fg-2">{t.approvingK(Math.min(done + 1, n), n)}</span> : null}
      </div>
      {error ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-fg-2">{t.approveStopped(done, n)}</p>
          <ErrorNotice error={error} compact />
        </div>
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => !running && setOpen(o)}
        title={t.approveAllTitle(queue.length)}
        description={
          <>
            <p>{t.approveAllBody}</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {queue.map((d) => (
                <li key={d.proposal_id}>{d.title}</li>
              ))}
            </ul>
          </>
        }
        confirm={t.approveAllN(queue.length)}
        pendingLabel={t.approvingK(Math.min(done + 1, queue.length), queue.length)}
        pending={running}
        onConfirm={() => void start()}
      />
    </div>
  );
}
