// Opening a thread (INV-THRS-03, INV-FORK-02, INV-FORK-07): its purpose is what DEMIURGO reads.
// The same dialog opens a thread at the top level, a thread inside another one, and a fork of a
// DEMIURGO message; on success it goes to the new thread. The server's reasons stay in the dialog
// with what was written (R87).

import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useCommand } from '../../api/commands.ts';
import { announce } from '../../components/announce.tsx';
import { PromptDialog } from '../../components/Dialog.tsx';

export function OpenThreadDialog({
  projectId,
  open,
  onOpenChange,
  parent,
  initial = '',
  fork = false,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The thread it opens inside, if any. */
  parent?: { id: string; purpose: string };
  /** The purpose to start from (a fork starts from the message it forks). */
  initial?: string;
  fork?: boolean;
}) {
  const command = useCommand(projectId);
  const navigate = useNavigate();
  const { reset } = command;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);
  return (
    <PromptDialog
      open={open}
      onOpenChange={onOpenChange}
      title={fork ? 'Fork into a new thread' : parent ? 'Open a thread inside' : 'Open a thread'}
      description={
        parent ? (
          <>
            Inside <span className="font-medium text-fg">{parent.purpose}</span>. Say what this thread explores.
          </>
        ) : (
          'Say what this thread explores. DEMIURGO reads it as its purpose.'
        )
      }
      label="Purpose"
      initial={initial}
      submit="Open thread"
      pendingLabel="Opening…"
      required
      maxLength={1000}
      pending={command.isPending}
      error={command.error}
      onSubmit={(purpose) =>
        command.mutate(
          {
            command: 'exploration.open',
            data: parent ? { purpose, parent_id: parent.id, origin: { type: 'exploration', id: parent.id } } : { purpose },
          },
          {
            onSuccess: (r) => {
              onOpenChange(false);
              announce('Thread opened.');
              void navigate({ to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId: r.entity_id } });
            },
          },
        )
      }
    />
  );
}
