// Dev tools panel, only when the API runs with DEMIURGO_DEV_TOOLS=1: save the whole database as a
// snapshot, restore or delete one, or reset to an empty database. It is not product UI: a "Dev"
// tab on the bottom edge opens it on every screen, including a fresh Day 1 after a reset, and so
// does "Snapshots…" in the person menu.

import { Working } from '@demiurgo/design-system';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { type FormEvent, useEffect, useId, useState } from 'react';
import {
  type Snapshot,
  devSnapshotsQuery,
  dropSnapshot,
  resetEnvironment,
  restoreSnapshot,
  saveSnapshot,
} from '../../api/dev.ts';
import { sessionQuery } from '../../api/queries.ts';
import { dayTime } from '../../lib/time.ts';
import { Button } from '../../ui/Button.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { visits } from '../overview/lens/visit.ts';
import { hasDevTools, onOpenDevPanel, sizeOf, summaryOf } from './snapshots.ts';

const overlay = 'fixed inset-0 z-50 bg-ink/25 animate-fade-in';
/** The panel floats like a dialog: the design system's panel, with its float shadow. */
const panel =
  'dm-panel dm-float fixed top-1/2 left-1/2 z-50 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 animate-fade-in gap-0 p-6';
const field =
  'dm-text-body w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink placeholder:text-muted focus:border-needs focus:outline-none';

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

export function DevTools() {
  const session = useQuery(sessionQuery);
  return hasDevTools(session.data) ? <DevPanel /> : null;
}

function DevPanel() {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  useEffect(() => onOpenDevPanel(() => setOpen(true)), []);
  const labelId = useId();
  const client = useQueryClient();
  const list = useQuery({ ...devSnapshotsQuery, enabled: open });
  const action = useMutation({
    mutationFn: run,
    onSuccess: async (_r, a) => {
      if (a.kind === 'drop') {
        await client.invalidateQueries({ queryKey: devSnapshotsQuery.queryKey });
        return;
      }
      // The API restarted: the live event streams are gone, so the page starts over.
      if (a.kind === 'save') {
        location.reload();
        return;
      }
      // An earlier (or empty) database: the stored visits and the current route may not exist in it.
      visits.forget();
      location.assign('/');
    },
  });
  const busy = action.isPending;
  const database = list.data?.database ?? 'the database';

  const save = (e: FormEvent) => {
    e.preventDefault();
    action.mutate({ kind: 'save', label: label.trim() });
  };
  const restore = (snapshot: Snapshot) => {
    if (confirm(`Restore «${snapshot.label}»? Everything done after it is lost. You stay signed in.`)) {
      action.mutate({ kind: 'restore', snapshot });
    }
  };
  const drop = (snapshot: Snapshot) => {
    if (confirm(`Delete the snapshot «${snapshot.label}»?`)) action.mutate({ kind: 'drop', snapshot });
  };
  const reset = () => {
    if (confirm(`Reset ${database}? Every project is deleted. You stay signed in. Save a snapshot first if in doubt.`)) {
      action.mutate({ kind: 'reset' });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="dm-code fixed bottom-0 left-1/2 z-40 -translate-x-1/2 rounded-t-tab border border-b-0 border-line-strong bg-surface px-3 py-0.5 font-semibold text-ink-2 hover:bg-line-soft hover:text-ink"
        >
          Dev
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={panel}>
          <Dialog.Title className="dm-text-heading font-semibold">Snapshots</Dialog.Title>
          <Dialog.Description className="dm-text-body mt-1 text-ink-2">
            Copies of the whole database ({database}): projects, conversations, runs and knowledge. Development only.
          </Dialog.Description>

          <form onSubmit={save} className="mt-5 flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor={labelId} className="dm-text-caption font-semibold text-ink-2">
                Label
              </label>
              <input
                id={labelId}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                placeholder="after day 1"
                className={`mt-1 ${field}`}
                disabled={busy}
              />
            </div>
            <Button type="submit" variant="secondary" disabled={busy}>
              Save snapshot
            </Button>
          </form>

          <ul className="mt-5 flex max-h-[320px] flex-col divide-y divide-line-soft overflow-y-auto border-y border-line-soft">
            {list.isPending ? <li className="dm-text-body py-3 text-muted">Loading…</li> : null}
            {list.data?.snapshots.length === 0 ? <li className="dm-text-body py-3 text-muted">No snapshots yet.</li> : null}
            {list.data?.snapshots.map((s) => (
              <li key={s.name} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="dm-text-body truncate font-semibold">{s.label}</p>
                  <p className="dm-text-caption truncate text-ink-2">
                    {dayTime(s.created_at)} · {summaryOf(s)} · {sizeOf(s.size_bytes)}
                  </p>
                </div>
                <Button disabled={busy} onClick={() => restore(s)}>
                  Restore
                </Button>
                <Button variant="text" disabled={busy} onClick={() => drop(s)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
          {list.error ? <Reasons error={list.error} className="mt-3" /> : null}

          <div className="mt-5 flex items-center gap-3">
            <p className="dm-text-caption flex-1 text-ink-2">
              Reset: an empty database with the same people, ready for a new Day 1.
            </p>
            <Button variant="secondary" disabled={busy} onClick={reset}>
              Reset
            </Button>
          </div>

          {busy ? (
            <p role="status" className="mt-4">
              <Working>{action.variables?.kind === 'drop' ? 'Deleting…' : 'Restarting the API…'}</Working>
            </p>
          ) : null}
          {action.error ? <Reasons error={action.error} className="mt-4" /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
