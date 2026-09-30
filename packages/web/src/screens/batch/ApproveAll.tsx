// "Approve all N" for an item batch: one confirmation listing the titles, then the same command the
// per-item Approve runs (proposal.accept with approve: true), one proposal at a time, stopping at the
// first error. The per-item Accept / Approve / Change / Reject stay as they are.

import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { useAllows } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import { APPROVABLE_TYPES, proposalTitle } from './model.ts';
import type { ProposalView } from './proposal.ts';
import { APPROVE_ALL } from './words.i18n.ts';

/** The pending proposals the per-item "Approve" would offer: acceptable, approvable, with no warning. */
export function approvableOf(proposals: ProposalView[], canAccept: boolean): ProposalView[] {
  if (!canAccept) return [];
  return proposals.filter((p) => p.state === 'pending' && APPROVABLE_TYPES.has(p.type) && (p.obsolescence ?? []).length === 0);
}

export function ApproveAll({ projectId, proposals }: { projectId: string; proposals: ProposalView[] }) {
  const t = useMessages(APPROVE_ALL);
  const command = useCommand(projectId);
  const canAccept = useAllows('proposal', 'pending')('proposal.accept');
  const [open, setOpen] = useState(false);
  // Fixed when the confirmation opens, so the count does not move while they are approved.
  const [queue, setQueue] = useState<ProposalView[]>([]);
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const approvable = approvableOf(proposals, canAccept);
  if (approvable.length < 2 && !running && !error) return null;
  const n = running || error ? queue.length : approvable.length;

  const start = async () => {
    const list = queue;
    setRunning(true);
    setError(null);
    setDone(0);
    for (let i = 0; i < list.length; i++) {
      try {
        await command.mutateAsync({ command: 'proposal.accept', entityId: list[i]!.id, data: { approve: true } });
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
    announce(t.allApproved(list.length));
  };

  return (
    <div className="flex flex-col gap-2" data-approve-all>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={running}
          onClick={() => {
            setQueue(approvable);
            setError(null);
            setOpen(true);
          }}
        >
          {t.button(n)}
        </Button>
        {running ? <span className="text-sm text-fg-2">{t.progress(Math.min(done + 1, n), n)}</span> : null}
      </div>
      {error ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-fg-2">{t.stoppedAfter(done, n)}</p>
          <ErrorNotice error={error} compact />
        </div>
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => !running && setOpen(o)}
        title={t.dialogTitle(queue.length)}
        description={
          <>
            <p>{t.dialogBody}</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {queue.map((p) => (
                <li key={p.id}>{proposalTitle(p)}</li>
              ))}
            </ul>
          </>
        }
        confirm={t.button(queue.length)}
        pendingLabel={t.progress(Math.min(done + 1, queue.length), queue.length)}
        pending={running}
        onConfirm={() => void start()}
      />
    </div>
  );
}
