// The decision of one proposal (DESIGN.md §3.1.1): Accept (keep working on it), Approve (settle it), Change
// (the person's version of its fields, inline) and Reject — in a bar that stays at the bottom of
// the proposal. Buttons exist only if the tables allow them. Accepting is decisive: it asks first
// and says what happens; the button says "Accepting…" until the server answers, never before
// (R78). When the server already says accepting would fail, Accept stays as an inactive, focusable
// button with the reason next to it, instead of vanishing (R76). Never an "accept all".

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { keys } from '../../api/queries.ts';
import { useAllows } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { ConfirmDialog, PromptDialog } from '../../components/Dialog.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Field, TextArea, TextInput } from '../../components/Field.tsx';
import { ASPECT_WORDS } from '../../aspects.i18n.ts';
import { useMessages } from '../../i18n/define.ts';
import { useLocale } from '../../i18n/locale.ts';
import { useReportDirty } from './guard.tsx';
import { APPROVABLE_TYPES, changedFields, EDITABLE_FIELDS, type EditableField, editedPayload, proposalTitle } from './model.ts';
import { DecisionBar, Disclosure } from './parts.tsx';
import { acceptEffects } from './proposal.ts';
import { PROPOSAL_ACTIONS, PROPOSAL_VIEW } from './words.i18n.ts';
import type { Aspect } from '../../aspects.ts';

export type ProposalRef = { id: string; type: string; payload: Record<string, unknown>; state: string };

const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');

type Dialog = null | 'accept' | 'approve' | 'edit' | 'reject';

/** The effects of accepting, as the confirmation says them. */
function Effects({ lines }: { lines: string[] }) {
  const t = useMessages(PROPOSAL_ACTIONS);
  if (lines.length === 1) return <p>{lines[0]}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <p>{t.twoThingsHappen}</p>
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
  hints,
  onDone,
  sticky = true,
  aspect = null,
}: {
  projectId: string;
  proposal: ProposalRef;
  /** Another aspect the person picked for it: accepting then sends their version with it. */
  aspect?: Aspect | null;
  /** The server's reasons why accepting would fail now: Accept stays, inactive, with the reason. */
  blocked?: string[];
  /** Other words for a review: "Open a review", "Keep it as it is". */
  labels?: { accept?: string; reject?: string };
  /** What each button does, one quiet line each (the conflict page). */
  hints?: { accept?: string; reject?: string };
  /** After the server confirmed: what to say ("Accepted."). The caller announces it. */
  onDone?: (said: string) => void;
  sticky?: boolean;
}) {
  const t = useMessages(PROPOSAL_ACTIONS);
  const tv = useMessages(PROPOSAL_VIEW);
  const aspectWords = useMessages(ASPECT_WORDS);
  const locale = useLocale();
  const command = useCommand(projectId);
  const navigate = useNavigate();
  const client = useQueryClient();
  const allows = useAllows('proposal', p.state);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const fields = EDITABLE_FIELDS[p.type] ?? [];
  const title = proposalTitle(p);
  const isBlocked = blocked.length > 0;
  const retag = aspect && allows('proposal.accept_edited') ? aspect : null;
  const withAspect = (payload: Record<string, unknown>) => (retag ? { ...payload, aspect: retag } : payload);

  const canAccept = allows('proposal.accept');
  const canApprove = canAccept && !isBlocked && APPROVABLE_TYPES.has(p.type);
  const canChange = allows('proposal.accept_edited') && !isBlocked && fields.length > 0;
  const canReject = allows('proposal.reject');
  const acceptLabel = labels.accept ?? (APPROVABLE_TYPES.has(p.type) ? t.acceptAsDraft : t.accept);
  const rejectLabel = labels.reject ?? t.reject;

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
      (response) => {
        setDialog(null);
        setDraft(null);
        // A review opens a thread: go to it, where DEMIURGO's first turn explains the conflict.
        const effect = response.result as { type?: string; id?: string } | null;
        if (p.type === 'review' && name.startsWith('proposal.accept') && effect?.type === 'exploration' && effect.id)
          void navigate({ to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId: effect.id } });
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
          title={t.acceptYourVersionTitle(title)}
          description={
            <p>
              {t.acceptYourVersionDescriptionBefore}{' '}
              {changedFields(p.payload, draft)
                .map((k) => fields.find((f) => f.key === k)?.label ?? k)
                .join(', ')}
              {t.acceptYourVersionDescriptionAfter}
            </p>
          }
          confirm={t.acceptMyVersion}
          pendingLabel={t.acceptingEllipsis}
          pending={command.isPending}
          error={dialog === 'edit' ? command.error : null}
          onConfirm={() =>
            run('proposal.accept_edited', { edit: withAspect(editedPayload(p.payload, draft)) }, t.yourVersionAccepted)
          }
        />
      </ChangeForm>
    );
  }

  if (!canAccept && !canChange && !canReject) return null;

  // With hints, each button carries its consequence right under it (two columns, one per button).
  const paired = !!hints && !canApprove && !canChange && !isBlocked && (canAccept || canReject);
  const saidOnAccept = p.type === 'review' ? t.reviewOpened : APPROVABLE_TYPES.has(p.type) ? t.acceptedAsDraft : t.accepted;

  return (
    <>
      {/* The refusal stays on the page when its dialog is gone (closed by the person or remounted), never silent. */}
      {!dialog && command.error ? <ErrorNotice error={command.error} /> : null}
      <DecisionBar
        sticky={sticky}
        caption={
          canApprove ? (
            <div className="flex flex-col gap-1">
              {retag ? <p data-retagged>{tv.retagged(aspectWords[retag])}</p> : null}
              <p>{t.draftCaption}</p>
              <Disclosure label={t.whatsTheDifference}>{t.draftDisclosure}</Disclosure>
            </div>
          ) : isBlocked && canAccept ? (
            <p>{t.blockedCaption}</p>
          ) : hints && !paired ? (
            <ul className="flex flex-col gap-0.5">
              {canAccept && hints.accept ? <li>{hints.accept}</li> : null}
              {canReject && hints.reject ? <li>{hints.reject}</li> : null}
            </ul>
          ) : null
        }
      >
        {paired ? (
          <div className="grid w-full items-start gap-x-6 gap-y-4 sm:grid-cols-2">
            {canAccept ? (
              <div className="flex flex-col items-start gap-1.5">
                <Button variant="primary" data-command="proposal.accept" onClick={() => open('accept')}>
                  {acceptLabel}
                </Button>
                {hints?.accept ? <p className="max-w-prose text-sm text-fg-2">{hints.accept}</p> : null}
              </div>
            ) : null}
            {canReject ? (
              <div className="flex flex-col items-start gap-1.5">
                <Button
                  variant={p.type === 'review' ? 'secondary' : 'quiet-danger'}
                  data-command="proposal.reject"
                  onClick={() => open('reject')}
                >
                  {rejectLabel}
                </Button>
                {hints?.reject ? <p className="max-w-prose text-sm text-fg-2">{hints.reject}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {!paired && canAccept && !isBlocked ? (
          <Button variant="primary" data-command="proposal.accept" onClick={() => open('accept')}>
            {acceptLabel}
          </Button>
        ) : null}
        {!paired && canAccept && isBlocked ? (
          <Button variant="primary" data-command="proposal.accept" aria-disabled="true" data-blocked onClick={() => {}}>
            {acceptLabel}
          </Button>
        ) : null}
        {canApprove ? (
          <Button variant="secondary" data-command="proposal.accept" onClick={() => open('approve')}>
            {t.acceptAndApprove}
          </Button>
        ) : null}
        {canChange ? (
          <Button
            variant="secondary"
            data-command="proposal.accept_edited"
            onClick={() => setDraft(Object.fromEntries(fields.map((f) => [f.key, textOf(p.payload[f.key])])))}
          >
            {t.change}
          </Button>
        ) : null}
        {!paired && canReject ? (
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
        title={dialog === 'approve' ? t.approveDialogTitle(title) : t.acceptDialogTitle(acceptLabel, title)}
        description={<Effects lines={acceptEffects(p, dialog === 'approve', locale)} />}
        confirm={dialog === 'approve' ? t.acceptAndApprove : acceptLabel}
        pendingLabel={t.acceptingEllipsis}
        pending={command.isPending}
        error={dialog === 'accept' || dialog === 'approve' ? command.error : null}
        onConfirm={() =>
          retag
            ? run(
                'proposal.accept_edited',
                { edit: withAspect(p.payload), approve: dialog === 'approve' },
                dialog === 'approve' ? t.acceptedAndApproved : saidOnAccept,
              )
            : dialog === 'approve'
              ? run('proposal.accept', { approve: true }, t.acceptedAndApproved)
              : run('proposal.accept', {}, saidOnAccept)
        }
      />
      <PromptDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && close()}
        title={t.rejectDialogTitle(rejectLabel, title)}
        description={t.rejectDialogDescription}
        label={t.reasonLabel}
        required={p.type !== 'review'}
        submit={rejectLabel}
        pendingLabel={p.type === 'review' ? t.keepingEllipsis : t.rejectingEllipsis}
        tone={p.type === 'review' ? 'primary' : 'danger'}
        pending={command.isPending}
        error={dialog === 'reject' ? command.error : null}
        onSubmit={(text) => run('proposal.reject', text ? { reason: text } : {}, p.type === 'review' ? t.keptAsItIs : t.rejected)}
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
  const t = useMessages(PROPOSAL_ACTIONS);
  const formId = useId();
  const changed = changedFields(payload, draft);
  useReportDirty(id, changed.length > 0);
  const empty = fields.filter((f) => (draft[f.key] ?? '').trim() === '').map((f) => f.label);
  const why = empty.length ? t.emptyFields(empty.join(', ')) : changed.length === 0 ? t.changeSomething : null;
  return (
    <form
      id={formId}
      aria-label={t.yourVersionLabel}
      data-change-form
      className="flex flex-col gap-4 border-t border-edge pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!why) onSubmit();
      }}
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-fg">{t.yourVersionLabel}</h3>
        <p className="text-sm text-fg-2">{t.yourVersionBody}</p>
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
      <DecisionBar sticky={sticky} label={t.yourVersionLabel} caption={why ? <span data-why>{why}</span> : null}>
        <Button type="submit" variant="primary" aria-disabled={why ? 'true' : undefined}>
          {t.acceptMyVersion}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {t.cancel}
        </Button>
      </DecisionBar>
      {children}
    </form>
  );
}
