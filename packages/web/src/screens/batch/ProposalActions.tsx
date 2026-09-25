// The decision of one proposal (DESIGN.md §3.1.1): Accept as draft, Accept and approve, Change
// (the person's version of its fields, inline) and Reject — in a bar that stays at the bottom of
// the proposal. Buttons exist only if the tables allow them. Accepting is decisive: it asks first
// and says what happens; the button says "Accepting…" until the server answers, never before
// (R78). When the server already says accepting would fail, Accept stays as an inactive, focusable
// button with the reason next to it, instead of vanishing (R76). Never an "accept all".

import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { keys } from '../../api/queries.ts';
import { useAllows } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { ConfirmDialog, PromptDialog } from '../../components/Dialog.tsx';
import { Field, TextArea, TextInput } from '../../components/Field.tsx';
import { useReportDirty } from './guard.tsx';
import { APPROVABLE_TYPES, changedFields, EDITABLE_FIELDS, type EditableField, editedPayload, proposalTitle } from './model.ts';
import { DecisionBar, Disclosure } from './parts.tsx';
import { acceptEffects } from './proposal.ts';

export type ProposalRef = { id: string; type: string; payload: Record<string, unknown>; state: string };

const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');

type Dialog = null | 'accept' | 'approve' | 'edit' | 'reject';

/** The effects of accepting, as the confirmation says them. */
function Effects({ lines }: { lines: string[] }) {
  if (lines.length === 1) return <p>{lines[0]}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <p>Two things happen:</p>
      <ol className="list-decimal space-y-0.5 pl-5">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ol>
    </div>
  );
}

export function ProposalDecision({
  projectId,
  proposal: p,
  blocked = [],
  labels = {},
  onDone,
  sticky = true,
}: {
  projectId: string;
  proposal: ProposalRef;
  /** The server's reasons why accepting would fail now: Accept stays, inactive, with the reason. */
  blocked?: string[];
  /** Other words for a review: "Open a review", "Keep it as it is". */
  labels?: { accept?: string; reject?: string };
  /** After the server confirmed: what to say ("Accepted as a draft."). The caller announces it. */
  onDone?: (said: string) => void;
  sticky?: boolean;
}) {
  const command = useCommand(projectId);
  const client = useQueryClient();
  const allows = useAllows('proposal', p.state);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const fields = EDITABLE_FIELDS[p.type] ?? [];
  const title = proposalTitle(p);
  const isBlocked = blocked.length > 0;

  const canAccept = allows('proposal.accept');
  const canApprove = canAccept && !isBlocked && APPROVABLE_TYPES.has(p.type);
  const canChange = allows('proposal.accept_edited') && !isBlocked && fields.length > 0;
  const canReject = allows('proposal.reject');
  const acceptLabel = labels.accept ?? (APPROVABLE_TYPES.has(p.type) ? 'Accept as draft' : 'Accept');
  const rejectLabel = labels.reject ?? 'Reject';

  const open = (d: Dialog) => {
    command.reset();
    setDialog(d);
  };
  const close = () => {
    // After a refusal the page may be showing something old: fetch it again (INV-PROP-05).
    if (command.error instanceof ApiError && command.error.status === 409)
      void client.invalidateQueries({ queryKey: keys.project(projectId) });
    setDialog(null);
  };
  // mutateAsync, not mutate's callbacks: once accepted, the proposal is no longer pending and this
  // bar unmounts before the callbacks would run; the promise still resolves.
  const run = (name: string, data: Record<string, unknown>, said: string) => {
    void command.mutateAsync({ command: name, entityId: p.id, data }).then(
      () => {
        setDialog(null);
        setDraft(null);
        if (onDone) onDone(said);
        else announce(said);
      },
      () => {
        // The error is shown in the dialog (command.error).
      },
    );
  };

  if (draft) {
    return (
      <ChangeForm
        id={p.id}
        fields={fields}
        payload={p.payload}
        draft={draft}
        onChange={setDraft}
        onCancel={() => setDraft(null)}
        onSubmit={() => open('edit')}
        sticky={sticky}
      >
        <ConfirmDialog
          open={dialog === 'edit'}
          onOpenChange={(o) => !o && close()}
          title={`Accept your version of “${title}”?`}
          description={
            <p>
              DEMIURGO records it with your changes to{' '}
              {changedFields(p.payload, draft)
                .map((k) => fields.find((f) => f.key === k)?.label ?? k)
                .join(', ')}
              . The proposal is kept as it came.
            </p>
          }
          confirm="Accept my version"
          pendingLabel="Accepting…"
          pending={command.isPending}
          error={dialog === 'edit' ? command.error : null}
          onConfirm={() => run('proposal.accept_edited', { edit: editedPayload(p.payload, draft) }, 'Your version is accepted.')}
        />
      </ChangeForm>
    );
  }

  if (!canAccept && !canChange && !canReject) return null;

  const saidOnAccept =
    p.type === 'review' ? 'A thread to review it is open.' : APPROVABLE_TYPES.has(p.type) ? 'Accepted as a draft.' : 'Accepted.';

  return (
    <>
      <DecisionBar
        sticky={sticky}
        caption={
          canApprove ? (
            <div className="flex flex-col gap-1">
              <p>As draft, it is recorded but doesn&apos;t count yet. Approved, it is settled.</p>
              <Disclosure label="What's the difference?">
                As draft: it is recorded but doesn&apos;t count yet; you can discard it or make a new version. Approve: it becomes
                settled: agents take it as decided, features can build on it, and changing it takes a new version.
              </Disclosure>
            </div>
          ) : isBlocked && canAccept ? (
            <p>It can&apos;t be accepted until what it starts from is settled again: see why above.</p>
          ) : null
        }
      >
        {canAccept && !isBlocked ? (
          <Button variant="primary" data-command="proposal.accept" onClick={() => open('accept')}>
            {acceptLabel}
          </Button>
        ) : null}
        {canAccept && isBlocked ? (
          <Button variant="primary" data-command="proposal.accept" aria-disabled="true" data-blocked onClick={() => {}}>
            {acceptLabel}
          </Button>
        ) : null}
        {canApprove ? (
          <Button variant="secondary" data-command="proposal.accept" onClick={() => open('approve')}>
            Accept and approve
          </Button>
        ) : null}
        {canChange ? (
          <Button
            variant="secondary"
            data-command="proposal.accept_edited"
            onClick={() => setDraft(Object.fromEntries(fields.map((f) => [f.key, textOf(p.payload[f.key])])))}
          >
            Change
          </Button>
        ) : null}
        {canReject ? (
          <Button
            variant={p.type === 'review' ? 'secondary' : 'quiet-danger'}
            data-command="proposal.reject"
            onClick={() => open('reject')}
          >
            {rejectLabel}
          </Button>
        ) : null}
      </DecisionBar>
      <ConfirmDialog
        open={dialog === 'accept' || dialog === 'approve'}
        onOpenChange={(o) => !o && close()}
        title={dialog === 'approve' ? `Accept and approve “${title}”?` : `${acceptLabel}: “${title}”?`}
        description={<Effects lines={acceptEffects(p, dialog === 'approve')} />}
        confirm={dialog === 'approve' ? 'Accept and approve' : acceptLabel}
        pendingLabel="Accepting…"
        pending={command.isPending}
        error={dialog === 'accept' || dialog === 'approve' ? command.error : null}
        onConfirm={() =>
          dialog === 'approve'
            ? run('proposal.accept', { approve: true }, 'Accepted and approved.')
            : run('proposal.accept', {}, saidOnAccept)
        }
      />
      <PromptDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && close()}
        title={`${rejectLabel}: “${title}”`}
        description="Say why, if you want. The reason is kept with the proposal."
        label="Reason"
        submit={rejectLabel}
        pendingLabel={p.type === 'review' ? 'Keeping it…' : 'Rejecting…'}
        tone={p.type === 'review' ? 'primary' : 'danger'}
        pending={command.isPending}
        error={dialog === 'reject' ? command.error : null}
        onSubmit={(text) =>
          run('proposal.reject', text ? { reason: text } : {}, p.type === 'review' ? 'Kept as it is.' : 'Rejected.')
        }
      />
    </>
  );
}

/**
 * "Change": the proposal's own text fields, prefilled, with their limits counted where the person
 * types (the old form let an over-long field fail only after confirming). Leaving it with changes
 * asks first (guard.tsx).
 */
function ChangeForm({
  id,
  fields,
  payload,
  draft,
  onChange,
  onCancel,
  onSubmit,
  sticky,
  children,
}: {
  id: string;
  fields: EditableField[];
  payload: Record<string, unknown>;
  draft: Record<string, string>;
  onChange: (d: Record<string, string>) => void;
  onCancel: () => void;
  onSubmit: () => void;
  sticky: boolean;
  children: React.ReactNode;
}) {
  const formId = useId();
  const changed = changedFields(payload, draft);
  useReportDirty(id, changed.length > 0);
  const empty = fields.filter((f) => (draft[f.key] ?? '').trim() === '').map((f) => f.label);
  const why = empty.length
    ? `${empty.join(', ')} can't be empty.`
    : changed.length === 0
      ? 'Change something to accept your version.'
      : null;
  return (
    <form
      id={formId}
      aria-label="Your version"
      data-change-form
      className="flex flex-col gap-4 border-t border-edge pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!why) onSubmit();
      }}
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-fg">Your version</h3>
        <p className="text-sm text-fg-2">Accepting it records your text. The proposal is kept as it came.</p>
      </div>
      {fields.map((f) => {
        const value = draft[f.key] ?? '';
        return (
          <Field key={f.key} label={f.label} count={[value.length, f.max]}>
            {(props) =>
              f.multiline ? (
                <TextArea
                  {...props}
                  autoGrow
                  rows={3}
                  maxLength={f.max}
                  value={value}
                  onChange={(e) => onChange({ ...draft, [f.key]: e.target.value })}
                />
              ) : (
                <TextInput
                  {...props}
                  maxLength={f.max}
                  value={value}
                  onChange={(e) => onChange({ ...draft, [f.key]: e.target.value })}
                />
              )
            }
          </Field>
        );
      })}
      <DecisionBar sticky={sticky} label="Your version" caption={why ? <span data-why>{why}</span> : null}>
        <Button type="submit" variant="primary" aria-disabled={why ? 'true' : undefined}>
          Accept my version
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </DecisionBar>
      {children}
    </form>
  );
}
