// Needs you, knowledge reviews: after each approval, knowledge proposes a review for every record
// it may affect, and almost all are answered "Keep it as it is". With two or more waiting, one
// button keeps them all as they are: each closes with `proposal.reject` (the same command as the
// review's "Keep it as it is"), one after another, stopping at the first failure.

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { runCommand } from '../../api/commands.ts';
import { keys } from '../../api/queries.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import type { NeedItem } from './order.ts';
import { KEEP_ALL } from './words.i18n.ts';

/** What the rejection stores as its reason when the reviews are closed in bulk. */
export const KEEP_ALL_REASON = 'Kept in bulk from Needs you.';

/** The ids of the knowledge reviews that wait. */
export function reviewIdsOf(items: readonly NeedItem[]): string[] {
  return items.flatMap((i) => (i.kind === 'conflict' && i.proposal.type === 'review' ? [i.proposal.id] : []));
}

export function KeepAllReviews({ projectId, ids }: { projectId: string; ids: string[] }) {
  const t = useMessages(KEEP_ALL);
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  // Snapshot of the run: the list shrinks as reviews close, and this must stay until it ends.
  const [run, setRun] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const keepAll = async () => {
    const todo = [...ids];
    setConfirming(false);
    setError(null);
    setRun({ done: 0, total: todo.length });
    let done = 0;
    try {
      for (const id of todo) {
        await runCommand(projectId, { command: 'proposal.reject', entityId: id, data: { reason: KEEP_ALL_REASON } });
        done += 1;
        setRun({ done, total: todo.length });
      }
      announce(t.kept(done));
    } catch (e) {
      setError(e);
      announce(t.stopped(done, todo.length));
    } finally {
      setRun(null);
      await client.invalidateQueries({ queryKey: keys.project(projectId) });
    }
  };

  if (ids.length < 2 && !run && !error) return null;
  return (
    <section aria-label={t.section} data-keep-all className="flex flex-col gap-2 border-b border-edge pb-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-base font-medium text-fg">{t.count(ids.length)}</p>
          <p className="text-sm text-fg-2" role="status">
            {run ? t.progress(Math.min(run.done + 1, run.total), run.total) : t.hint}
          </p>
        </div>
        <Button
          variant="secondary"
          data-command="proposal.reject"
          pending={run !== null}
          pendingLabel={t.keeping}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          {t.action}
        </Button>
      </div>
      {error ? <ErrorNotice error={error} compact /> : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t.dialogTitle(ids.length)}
        description={<p>{t.dialogBody}</p>}
        confirm={t.action}
        onConfirm={() => void keepAll()}
      />
    </section>
  );
}
