// Dev tools, only when the API runs with DEMIURGO_DEV_TOOLS=1 (INV-DEV-*): save the whole database
// as a snapshot, restore or delete one, or reset to an empty database; and a line on the inspector
// (Alt+click, screens/dev/Inspector.tsx). Not product UI. It opens from
// the sidebar and from the person's menu; restores and resets ask with the app's own dialogs.
// Saving, restoring and resetting restart the API's core: the page then reloads.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  type ProjectSnapshot,
  type Snapshot,
  deleteProject,
  devSnapshotsQuery,
  dropProjectSnapshot,
  dropSnapshot,
  projectSnapshotsQuery,
  resetEnvironment,
  restoreProjectSnapshot,
  restoreSnapshot,
  saveProjectSnapshot,
  saveSnapshot,
} from '../api/dev.ts';
import { keys, projectsQuery, sessionQuery } from '../api/queries.ts';
import { Button } from '../components/Button.tsx';
import { ConfirmDialog, Dialog } from '../components/Dialog.tsx';
import { Field, TextInput } from '../components/Field.tsx';
import { ErrorNotice, Notice } from '../components/Notice.tsx';
import { RowsSkeleton, Spinner } from '../components/Spinner.tsx';
import { useMessages } from '../i18n/define.ts';
import { useProjectId } from '../lib/hooks.ts';
import { dayTime } from '../lib/time.ts';
import { visits } from '../screens/overview/lens/visit.ts';
import { hasDevTools, onOpenDevPanel, sizeOf, summaryOf } from '../screens/dev/snapshots.ts';
import { useSafeLocale } from '../words.ts';
import { DEV_PANEL } from './words.i18n.ts';

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
  const t = useMessages(DEV_PANEL);
  const locale = useSafeLocale();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const projectId = useProjectId();
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
        const saved = (_r as { snapshot: Snapshot }).snapshot;
        setLabel('');
        setSaved(saved.label);
        void client.invalidateQueries();
        return;
      }
      visits.forget();
      window.location.assign('/');
    },
  });
  const busy = action.isPending;
  const busyWord = action.variables?.kind === 'drop' ? t.deleting : t.restarting;

  const save = (e: FormEvent) => {
    e.preventDefault();
    setSaved(null);
    action.mutate({ kind: 'save', label: label.trim() });
  };

  const confirmText =
    confirm?.kind === 'restore'
      ? { title: t.restoreTitle(confirm.snapshot.label), body: t.restoreBody, button: t.restore }
      : confirm?.kind === 'drop'
        ? { title: t.dropTitle(confirm.snapshot.label), body: t.dropBody, button: t.drop }
        : confirm?.kind === 'reset'
          ? {
              title: t.resetTitle(list.data?.database ?? (locale === 'es' ? 'la base de datos' : 'the database')),
              body: t.resetBody,
              button: t.reset,
            }
          : null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
        title={t.snapshotsTitle}
        description={t.snapshotsDescription(list.data?.database ?? '…')}
      >
        {projectId ? <ProjectSection projectId={projectId} disabled={busy} onBusy={() => setSaved(null)} /> : null}
        {projectId ? <h3 className="text-base font-semibold text-fg">{t.wholeDatabase}</h3> : null}
        <form onSubmit={save} className="flex items-end gap-2">
          <Field label={t.label} optional className="flex-1">
            {(p) => (
              <TextInput
                {...p}
                value={label}
                maxLength={60}
                placeholder={t.labelPlaceholder}
                disabled={busy}
                onChange={(e) => setLabel(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            {t.saveSnapshot}
          </Button>
        </form>
        {saved !== null ? (
          <Notice tone="success" role="status">
            {t.saved(saved)}
          </Notice>
        ) : null}
        {list.isPending ? (
          <RowsSkeleton label={t.loadingSnapshots} rows={3} />
        ) : list.error ? (
          <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.snapshots.length === 0 ? (
          <p className="text-base text-fg-2">{t.noSnapshots}</p>
        ) : (
          <ul className="flex max-h-72 flex-col divide-y divide-edge-subtle overflow-y-auto rounded-lg border border-edge">
            {list.data.snapshots.map((s) => (
              <li key={s.name} className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-medium text-fg">{s.label}</span>
                  <span className="text-sm text-fg-2">
                    {dayTime(s.created_at, undefined, locale)} · {summaryOf(s)} · {sizeOf(s.size_bytes)}
                  </span>
                </div>
                <Button size="sm" disabled={busy} onClick={() => setConfirm({ kind: 'restore', snapshot: s })}>
                  {t.restore}
                </Button>
                <Button
                  size="sm"
                  variant="quiet-danger"
                  disabled={busy}
                  onClick={() => setConfirm({ kind: 'drop', snapshot: s })}
                >
                  {t.drop}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-edge pt-3">
          <p className="text-sm text-fg-2">{t.resetLine}</p>
          <Button variant="quiet-danger" disabled={busy} onClick={() => setConfirm({ kind: 'reset' })}>
            {t.resetEllipsis}
          </Button>
        </div>
        <p className="text-sm text-fg-2">{t.inspectHint}</p>
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
        confirm={confirmText?.button ?? t.confirm}
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

type ProjectAction =
  | { kind: 'save'; label: string }
  | { kind: 'restore'; snapshot: ProjectSnapshot }
  | { kind: 'drop'; snapshot: ProjectSnapshot }
  | { kind: 'delete' };

/** One project's own snapshots (save, restore, delete) and its development-only deletion. */
function ProjectSection({ projectId, disabled, onBusy }: { projectId: string; disabled: boolean; onBusy: () => void }) {
  const t = useMessages(DEV_PANEL);
  const locale = useSafeLocale();
  const client = useQueryClient();
  const navigate = useNavigate();
  const projects = useQuery(projectsQuery);
  const name = projects.data?.find((p) => p.id === projectId)?.name ?? projectId;
  const list = useQuery(projectSnapshotsQuery(projectId));
  const [label, setLabel] = useState('');
  const [typed, setTyped] = useState('');
  const [confirm, setConfirm] = useState<ProjectAction | null>(null);
  const [done, setDone] = useState<{ text: string; detail?: string } | null>(null);

  const action = useMutation({
    mutationFn: (a: ProjectAction): Promise<unknown> => {
      if (a.kind === 'save') return saveProjectSnapshot(projectId, a.label);
      if (a.kind === 'restore') return restoreProjectSnapshot(a.snapshot.name);
      if (a.kind === 'drop') return dropProjectSnapshot(a.snapshot.name);
      return deleteProject(projectId);
    },
    onSuccess: async (r, a) => {
      setConfirm(null);
      if (a.kind === 'delete') {
        setTyped('');
        // Leave the project first, so its queries are no longer mounted when they are invalidated (404s).
        await navigate({ to: '/projects' });
        client.removeQueries({ queryKey: keys.project(projectId) });
      } else if (a.kind === 'save') {
        const saved = (r as { snapshot: ProjectSnapshot }).snapshot;
        setLabel('');
        setDone({ text: t.saved(saved.label) });
      } else if (a.kind === 'restore') {
        const out = r as { restored: ProjectSnapshot; git: string };
        setDone({ text: t.restored(out.restored.label), detail: out.git });
      } else {
        setDone({ text: t.deletedSnapshot(a.snapshot.label) });
      }
      void client.invalidateQueries();
    },
  });
  const busy = action.isPending;
  const busyWord = action.variables?.kind === 'restore' ? t.restarting : t.deleting;

  const text =
    confirm?.kind === 'restore'
      ? { title: t.projectRestoreTitle(confirm.snapshot.label), body: t.projectRestoreBody, button: t.restore }
      : confirm?.kind === 'drop'
        ? { title: t.dropTitle(confirm.snapshot.label), body: t.projectDropBody, button: t.drop }
        : confirm?.kind === 'delete'
          ? { title: t.deleteProjectTitle(name), body: t.deleteProjectBody, button: t.deleteProjectConfirm }
          : null;
  const close = () => {
    if (busy) return;
    setConfirm(null);
    setTyped('');
    action.reset();
  };

  return (
    <section aria-label={t.projectTitle(name)} className="flex flex-col gap-3 border-b border-edge pb-4">
      <h3 className="text-base font-semibold text-fg">{t.projectTitle(name)}</h3>
      <p className="text-sm text-fg-2">{t.projectLine}</p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onBusy();
          setDone(null);
          action.mutate({ kind: 'save', label: label.trim() });
        }}
      >
        <Field label={t.label} optional className="flex-1">
          {(p) => (
            <TextInput
              {...p}
              value={label}
              maxLength={60}
              placeholder={t.labelPlaceholder}
              disabled={busy || disabled}
              onChange={(e) => setLabel(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={busy || disabled}>
          {t.saveProjectSnapshot}
        </Button>
      </form>
      {done ? (
        <Notice tone="success" role="status">
          {done.text}
          {done.detail ? <span className="block">{done.detail}</span> : null}
        </Notice>
      ) : null}
      {list.isPending ? (
        <RowsSkeleton label={t.loadingSnapshots} rows={2} />
      ) : list.error ? (
        <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.snapshots.length === 0 ? (
        <p className="text-base text-fg-2">{t.noProjectSnapshots}</p>
      ) : (
        <ul className="flex max-h-56 flex-col divide-y divide-edge-subtle overflow-y-auto">
          {list.data.snapshots.map((s) => (
            <li key={s.name} className="flex items-center gap-3 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-medium text-fg">{s.label}</span>
                <span className="text-sm text-fg-2">
                  {dayTime(s.created_at, undefined, locale)} · {t.events(s.project.events)} · {sizeOf(s.size_bytes)}
                </span>
              </div>
              <Button size="sm" disabled={busy || disabled} onClick={() => setConfirm({ kind: 'restore', snapshot: s })}>
                {t.restore}
              </Button>
              <Button
                size="sm"
                variant="quiet-danger"
                disabled={busy || disabled}
                onClick={() => setConfirm({ kind: 'drop', snapshot: s })}
              >
                {t.drop}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {busy && !confirm ? (
        <p role="status" className="flex items-center gap-2 text-base text-info-text">
          <Spinner /> {busyWord}
        </p>
      ) : null}
      {action.error && !confirm ? <ErrorNotice error={action.error} /> : null}
      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-sm text-fg-2">{t.dangerZone}</p>
        <Button variant="quiet-danger" disabled={busy || disabled} onClick={() => setConfirm({ kind: 'delete' })}>
          {t.deleteProjectButton}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => {
          if (!v) close();
        }}
        title={text?.title ?? ''}
        description={text?.body ?? ''}
        confirm={text?.button ?? t.confirm}
        tone="danger"
        pending={busy}
        pendingLabel={busyWord}
        error={action.error}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === 'delete' && typed !== name) return;
          action.mutate(confirm);
        }}
      >
        {confirm?.kind === 'delete' ? (
          <Field label={t.typeName}>
            {(p) => <TextInput {...p} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />}
          </Field>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
