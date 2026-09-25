// Dev tools, only when the API runs with DEMIURGO_DEV_TOOLS=1 (INV-DEV-*): save the whole database
// as a snapshot, restore or delete one, or reset to an empty database. Not product UI. It opens from
// the sidebar and from the person's menu; restores and resets ask with the app's own dialogs.
// Saving, restoring and resetting restart the API's core: the page then reloads.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { type Snapshot, devSnapshotsQuery, dropSnapshot, resetEnvironment, restoreSnapshot, saveSnapshot } from '../api/dev.ts';
import { sessionQuery } from '../api/queries.ts';
import { Button } from '../components/Button.tsx';
import { ConfirmDialog, Dialog } from '../components/Dialog.tsx';
import { Field, TextInput } from '../components/Field.tsx';
import { ErrorNotice } from '../components/Notice.tsx';
import { RowsSkeleton, Spinner } from '../components/Spinner.tsx';
import { dayTime } from '../lib/time.ts';
import { visits } from '../screens/overview/lens/visit.ts';
import { hasDevTools, onOpenDevPanel, sizeOf, summaryOf } from '../screens/dev/snapshots.ts';

type Action =
  | { kind: 'save'; label: string }
  | { kind: 'restore'; snapshot: Snapshot }
  | { kind: 'drop'; snapshot: Snapshot }
  | { kind: 'reset' };

function run(a: Action): Promise<unknown> {
  if (a.kind === 'save') return saveSnapshot(a.label);
  if (a.kind === 'restore') return restoreSnapshot(a.snapshot.name);
  if (a.kind === 'drop') return dropSnapshot(a.snapshot.name);
  return resetEnvironment();
}

export function DevPanel() {
  const session = useQuery(sessionQuery);
  return hasDevTools(session.data) ? <Panel /> : null;
}

function Panel() {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [confirm, setConfirm] = useState<Action | null>(null);
  const client = useQueryClient();
  useEffect(() => onOpenDevPanel(() => setOpen(true)), []);
  const list = useQuery({ ...devSnapshotsQuery, enabled: open });
  const action = useMutation({
    mutationFn: run,
    onSuccess: (_r, a) => {
      if (a.kind === 'drop') {
        setConfirm(null);
        void client.invalidateQueries({ queryKey: devSnapshotsQuery.queryKey });
        return;
      }
      if (a.kind === 'save') {
        window.location.reload();
        return;
      }
      visits.forget();
      window.location.assign('/');
    },
  });
  const busy = action.isPending;
  const busyWord = action.variables?.kind === 'drop' ? 'Deleting…' : 'Restarting the API…';

  const save = (e: FormEvent) => {
    e.preventDefault();
    action.mutate({ kind: 'save', label: label.trim() });
  };

  const confirmText =
    confirm?.kind === 'restore'
      ? {
          title: `Restore «${confirm.snapshot.label}»?`,
          body: 'Everything done after it is lost. You stay signed in.',
          button: 'Restore',
        }
      : confirm?.kind === 'drop'
        ? { title: `Delete the snapshot «${confirm.snapshot.label}»?`, body: 'The snapshot is gone for good.', button: 'Delete' }
        : confirm?.kind === 'reset'
          ? {
              title: `Reset ${list.data?.database ?? 'the database'}?`,
              body: 'Every project is deleted. You stay signed in. Save a snapshot first if in doubt.',
              button: 'Reset',
            }
          : null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
        title="Snapshots"
        description={`Copies of the whole database (${list.data?.database ?? '…'}): projects, conversations, runs and knowledge. Development only.`}
      >
        <form onSubmit={save} className="flex items-end gap-2">
          <Field label="Label" optional className="flex-1">
            {(p) => (
              <TextInput
                {...p}
                value={label}
                maxLength={60}
                placeholder="after day 1"
                disabled={busy}
                onChange={(e) => setLabel(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            Save snapshot
          </Button>
        </form>
        {list.isPending ? (
          <RowsSkeleton label="Loading the snapshots" rows={3} />
        ) : list.error ? (
          <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.snapshots.length === 0 ? (
          <p className="text-base text-fg-2">No snapshots yet.</p>
        ) : (
          <ul className="flex max-h-72 flex-col divide-y divide-edge-subtle overflow-y-auto rounded-lg border border-edge">
            {list.data.snapshots.map((s) => (
              <li key={s.name} className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-medium text-fg">{s.label}</span>
                  <span className="text-sm text-fg-2">
                    {dayTime(s.created_at)} · {summaryOf(s)} · {sizeOf(s.size_bytes)}
                  </span>
                </div>
                <Button size="sm" disabled={busy} onClick={() => setConfirm({ kind: 'restore', snapshot: s })}>
                  Restore
                </Button>
                <Button
                  size="sm"
                  variant="quiet-danger"
                  disabled={busy}
                  onClick={() => setConfirm({ kind: 'drop', snapshot: s })}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-edge pt-3">
          <p className="text-sm text-fg-2">Reset: an empty database with the same people, ready for a new Day 1.</p>
          <Button variant="quiet-danger" disabled={busy} onClick={() => setConfirm({ kind: 'reset' })}>
            Reset…
          </Button>
        </div>
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-base text-info-text">
            <Spinner /> {busyWord}
          </p>
        ) : null}
        {action.error && !confirm ? <ErrorNotice error={action.error} /> : null}
      </Dialog>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => {
          if (!v && !busy) {
            setConfirm(null);
            action.reset();
          }
        }}
        title={confirmText?.title ?? ''}
        description={confirmText?.body ?? ''}
        confirm={confirmText?.button ?? 'Confirm'}
        tone="danger"
        pending={busy}
        pendingLabel={busyWord}
        error={action.error}
        onConfirm={() => {
          if (confirm) action.mutate(confirm);
        }}
      />
    </>
  );
}
