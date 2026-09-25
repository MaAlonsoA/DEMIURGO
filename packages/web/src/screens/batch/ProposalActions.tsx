// A proposal's actions in place (canvas S7B): Accept, Accept and approve (one action, its two effects
// said before confirming), Change (the person's version of its fields) and Reject with a reason.
// Buttons exist only if the tables allow them from the proposal's state; never an "accept all".

import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { keys } from '../../api/queries.ts';
import { cn } from '../../lib/cn.ts';
import { useAllows } from '../../ui/ActionBar.tsx';
import { Button } from '../../ui/Button.tsx';
import { ConfirmDialog, TextDialog } from '../../ui/dialogs.tsx';
import { APPROVABLE_TYPES, changedFields, EDITABLE_FIELDS, editedPayload, proposalTitle } from './model.ts';

export type ProposalRef = { id: string; type: string; payload: Record<string, unknown>; state: string };

const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');

type Dialog = null | 'accept' | 'approve' | 'edit' | 'reject';

const NOUN: Record<string, string> = { decision: 'the decision', fdr: 'the feature', exploration: 'the thread' };

/** What accepting does, in words, before it happens. */
export function acceptEffects(p: ProposalRef, approve: boolean): ReactNode {
  const title = proposalTitle(p);
  if (p.type === 'review') {
    const r = p.payload.record as { code?: string; version?: number } | undefined;
    return (
      <p>
        DEMIURGO opens a thread to review {r?.code} v{r?.version}. The record itself doesn&apos;t change.
      </p>
    );
  }
  if (p.type === 'exploration') return <p>DEMIURGO opens the thread &ldquo;{title}&rdquo;.</p>;
  const checks = Array.isArray(p.payload.criteria) ? p.payload.criteria.length : 0;
  const what = `${NOUN[p.type] ?? 'it'} “${title}”${checks ? `, with its ${checks} ${checks === 1 ? 'check' : 'checks'}` : ''}`;
  if (!approve) return <p>DEMIURGO records {what} as a draft. You approve it later, on its page.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <p>Two things happen:</p>
      <ol className="list-decimal pl-5">
        <li>DEMIURGO records {what}.</li>
        <li>You approve it: it becomes the current version.</li>
      </ol>
    </div>
  );
}

export function ProposalActions({
  projectId,
  proposal: p,
  blocked = false,
  labels = {},
  className,
  onResolved,
}: {
  projectId: string;
  proposal: ProposalRef;
  /** The server already says its dependencies changed: accepting would fail, so only Reject is offered. */
  blocked?: boolean;
  labels?: { accept?: string; reject?: string };
  className?: string;
  onResolved?: () => void;
}) {
  const command = useCommand(projectId);
  const client = useQueryClient();
  const allows = useAllows('proposal', p.state);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const fields = EDITABLE_FIELDS[p.type] ?? [];

  const open = (d: Dialog) => {
    command.reset();
    setDialog(d);
  };
  const close = () => {
    // After a rejected action the page may be showing something old: fetch it again.
    if (command.error instanceof ApiError && command.error.status === 409)
      void client.invalidateQueries({ queryKey: keys.project(projectId) });
    setDialog(null);
  };
  const run = (name: string, data: Record<string, unknown>) =>
    command.mutate(
      { command: name, entityId: p.id, data },
      {
        onSuccess: () => {
          setDialog(null);
          setDraft(null);
          onResolved?.();
        },
      },
    );

  const canAccept = allows('proposal.accept') && !blocked;
  const canApprove = canAccept && APPROVABLE_TYPES.has(p.type);
  const canChange = allows('proposal.accept_edited') && !blocked && fields.length > 0;
  const canReject = allows('proposal.reject');
  const title = proposalTitle(p);
  const changed = draft ? changedFields(p.payload, draft) : [];

  if (draft) {
    return (
      <ChangeForm
        fields={fields}
        draft={draft}
        onChange={setDraft}
        changed={changed}
        onCancel={() => setDraft(null)}
        onSubmit={() => open('edit')}
        className={className}
      >
        <ConfirmDialog
          open={dialog === 'edit'}
          onOpenChange={(o) => !o && close()}
          title={`Accept your version of “${title}”?`}
          description={
            <p>
              DEMIURGO records it with your changes ({changed.map((k) => fields.find((f) => f.key === k)?.label ?? k).join(', ')}
              ). The proposal is kept as it came.
            </p>
          }
          confirm="Accept my version"
          pending={command.isPending}
          error={command.error}
          onConfirm={() => run('proposal.accept_edited', { edit: editedPayload(p.payload, draft) })}
        />
      </ChangeForm>
    );
  }

  if (!canAccept && !canChange && !canReject) return null;

  // With both, say the difference: a draft can still change; approved is what the rest builds on.
  const acceptLabel = labels.accept ?? (canApprove ? 'Accept as draft' : 'Accept');
  return (
    <div className={cn('flex flex-wrap items-center gap-2.5', className)}>
      {canAccept && (
        <Button variant="primary" data-command="proposal.accept" onClick={() => open('accept')}>
          {acceptLabel}
        </Button>
      )}
      {canApprove && (
        <Button variant="secondary" data-command="proposal.accept" onClick={() => open('approve')}>
          Accept and approve
        </Button>
      )}
      {canChange && (
        <Button
          variant="secondary"
          data-command="proposal.accept_edited"
          onClick={() => setDraft(Object.fromEntries(fields.map((f) => [f.key, textOf(p.payload[f.key])])))}
        >
          Change
        </Button>
      )}
      {canReject && (
        <Button variant="secondary" data-command="proposal.reject" onClick={() => open('reject')}>
          {labels.reject ?? 'Reject'}
        </Button>
      )}

      {canAccept && canApprove && (
        <p className="dm-text-caption w-full text-muted">
          As draft: it is recorded but doesn&apos;t count yet; you can discard it or make a new version. Approve: it
          becomes settled: agents take it as decided, features can build on it, and changing it takes a new version.
        </p>
      )}
      <ConfirmDialog
        open={dialog === 'accept' || dialog === 'approve'}
        onOpenChange={(o) => !o && close()}
        title={dialog === 'approve' ? `Accept and approve “${title}”?` : `${acceptLabel}: “${title}”?`}
        description={acceptEffects(p, dialog === 'approve')}
        confirm={dialog === 'approve' ? 'Accept and approve' : acceptLabel}
        pending={command.isPending}
        error={command.error}
        onConfirm={() => run('proposal.accept', dialog === 'approve' ? { approve: true } : {})}
      />
      <TextDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && close()}
        title={`${labels.reject ?? 'Reject'}: “${title}”`}
        description="Say why, if you want. The reason is kept with the proposal."
        label="Reason"
        submit={labels.reject ?? 'Reject'}
        pending={command.isPending}
        error={command.error}
        onSubmit={(text) => run('proposal.reject', text ? { reason: text } : {})}
      />
    </div>
  );
}

/** "Change": the proposal's own text fields, to accept the person's version of it. */
function ChangeForm({
  fields,
  draft,
  changed,
  onChange,
  onCancel,
  onSubmit,
  className,
  children,
}: {
  fields: { key: string; label: string; max: number; multiline: boolean }[];
  draft: Record<string, string>;
  changed: string[];
  onChange: (d: Record<string, string>) => void;
  onCancel: () => void;
  onSubmit: () => void;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const empty = fields.filter((f) => (draft[f.key] ?? '').trim() === '').map((f) => f.label);
  const why = empty.length
    ? `${empty.join(', ')} can't be empty.`
    : changed.length === 0
      ? 'Change something to accept your version.'
      : null;
  const field =
    'dm-text-body w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink placeholder:text-muted focus:border-needs focus:outline-none';
  return (
    <form
      className={cn('flex flex-col gap-3 border-t border-line-soft pt-3', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!why) onSubmit();
      }}
    >
      <p className="dm-text-small font-semibold">Your version</p>
      {fields.map((f) => (
        <label key={f.key} htmlFor={`${id}-${f.key}`} className="dm-text-caption flex flex-col gap-1 font-semibold text-ink-2">
          {f.label}
          {f.multiline ? (
            <textarea
              id={`${id}-${f.key}`}
              rows={3}
              value={draft[f.key] ?? ''}
              onChange={(e) => onChange({ ...draft, [f.key]: e.target.value })}
              className={cn(field, 'font-normal')}
            />
          ) : (
            <input
              id={`${id}-${f.key}`}
              value={draft[f.key] ?? ''}
              onChange={(e) => onChange({ ...draft, [f.key]: e.target.value })}
              className={cn(field, 'font-normal')}
            />
          )}
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-2.5">
        <Button type="submit" variant="primary" disabled={!!why}>
          Accept my version
        </Button>
        <Button variant="text" onClick={onCancel}>
          Cancel
        </Button>
        {why && <span className="dm-text-caption text-muted">{why}</span>}
      </div>
      {children}
    </form>
  );
}
