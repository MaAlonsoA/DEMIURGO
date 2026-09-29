// A package from DEMIURGO (DESIGN.md §3.2): what it proposes, each record in full as it will be
// recorded, decided whole. Its decision — Accept package, Accept and approve, Reject package — sits
// above the content and again in a footer that stays at the bottom while the person reads, so it is
// never far from what it approves (INVENTORY Part D §3, UX problem). When warnings block accepting,
// the buttons stay, inactive, with the warning beside them (R76).

import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { inboxQuery, stateQuery } from '../../api/queries.ts';
import type { BatchDetail, ProductRow } from '../../api/types.ts';
import { useAllows } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { ConfirmDialog, PromptDialog } from '../../components/Dialog.tsx';
import { PageBody, PageHeader, WithAside } from '../../components/Page.tsx';
import { EntityState, StatusBadge } from '../../components/status.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { WhoAvatar } from '../../components/Who.tsx';
import { stateWord, whoOf } from '../../words.ts';
import { useBatchCrumbs } from './Batch.tsx';
import { withInbox } from './ItemBatch.tsx';
import { acceptedRecord, obsoleteReason, proposalTitle } from './model.ts';
import { BlockedNotice, DecisionBar, Evidence, IdeaCheck, OutOfDate, RecordChip, RunLine } from './parts.tsx';
import { kindWord, type ProposalView as ProposalData, proposalIconType, whatItRecords } from './proposal.ts';
import { ProposalBody } from './ProposalView.tsx';
import { useReadingOf } from '../../i18n/reading.tsx';
import { useMessages } from '../../i18n/define.ts';
import { PACKAGE } from './words.i18n.ts';

/** True while the element is on screen (the top decision bar: the footer shows once it is not). */
function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setOn(e?.isIntersecting ?? true), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}

export function DemiurgoPackage({ projectId, batch }: { projectId: string; batch: BatchDetail }) {
  const t = useMessages(PACKAGE);
  const inbox = useQuery(inboxQuery(projectId)).data;
  const state = useQuery(stateQuery(projectId)).data;
  const rows: ProductRow[] = state ? [...state.decisions, ...state.designs] : [];
  const proposals = withInbox(batch, inbox?.batches.find((b) => b.id === batch.id)?.proposals ?? []);
  const n = proposals.length;
  const single = n === 1 ? proposals[0] : undefined;
  const title = single ? proposalTitle(single) : t.defaultTitle;
  const crumbs = useBatchCrumbs(projectId, t.packageFromDemiurgo);
  const top = useRef<HTMLDivElement>(null);
  const topOnScreen = useOnScreen(top);
  const decision = usePackageDecision(projectId, batch, proposals);

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        eyebrow={
          <>
            <span className="inline-flex items-center gap-1.5">
              <WhoAvatar kind={whoOf(batch.producer).kind} size={18} />
              {t.packageFromDemiurgo}
            </span>
            <span aria-hidden>·</span>
            <span>{t.proposalsCount(n)}</span>
            <EntityState entity="batch" state={batch.state} />
          </>
        }
        title={title}
        meta={
          <>
            <RelativeTime iso={batch.created_at} />
            <span>
              {batch.summary ? `${batch.summary} ` : ''}
              {t.decidedWhole}
            </span>
          </>
        }
      />
      <PageBody>
        <WithAside asideLabel={t.aboutThisPackage} aside={<PackageAside projectId={projectId} batch={batch} rows={rows} />}>
          <div className="flex flex-col gap-8">
            <div ref={top}>{decision.panel(false)}</div>
            {batch.run_id ? (
              <Evidence title={t.draftedByDemiurgo}>
                <RunLine projectId={projectId} runId={batch.run_id} />
              </Evidence>
            ) : null}
            {proposals.map((p) => (
              <ProposedRecord key={p.id} projectId={projectId} proposal={p} rows={rows} single={n === 1} />
            ))}
            {batch.state === 'pending' && !topOnScreen ? decision.panel(true) : null}
          </div>
        </WithAside>
      </PageBody>
      {decision.dialogs}
    </>
  );
}

/** A proposed record as it will be recorded: its kind and state, what it contains, the idea check. */
function ProposedRecord({
  projectId,
  proposal: p,
  rows,
  single,
}: {
  projectId: string;
  proposal: ProposalData;
  rows: readonly ProductRow[];
  single: boolean;
}) {
  const t = useMessages(PACKAGE);
  const id = useId();
  const obsolete = obsoleteReason(p);
  const reading = useReadingOf(projectId, 'proposal', p.id, p.payload);
  const shown = { ...p, payload: reading.value };
  return (
    <article aria-labelledby={id} data-proposal={p.id} data-state={p.state} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-fg-2">
            <TypeIcon type={proposalIconType(p)} size={15} className="text-fg-3" />
            {kindWord(p.type)}
          </span>
          {p.state === 'superseded' ? (
            <StatusBadge kind="stale" word={t.outOfDate} />
          ) : (
            <EntityState entity="proposal" state={p.state} />
          )}
        </div>
        <h2 id={id} className="text-lg font-semibold text-fg">
          {single ? t.whatItRecords : proposalTitle(shown)}
        </h2>
      </div>
      {p.state === 'superseded' ? <OutOfDate>{t.cannotAcceptAnymore(obsolete ?? t.obsoleteDefault)}</OutOfDate> : null}
      {reading.mark ? <div>{reading.mark}</div> : null}
      <ProposalBody projectId={projectId} proposal={shown} rows={rows} withGoal />
      <IdeaCheck projectId={projectId} assessment={p.assessment} rows={rows} />
    </article>
  );
}

function PackageAside({ projectId, batch, rows }: { projectId: string; batch: BatchDetail; rows: readonly ProductRow[] }) {
  const t = useMessages(PACKAGE);
  const deps = batch.dependencies.filter((d) => d.code);
  return (
    <>
      {deps.length > 0 ? (
        <section aria-label={t.startsFrom} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-fg">{t.startsFrom}</h2>
          <div className="flex flex-wrap gap-2">
            {deps.map((d) => (
              <RecordChip key={d.id} projectId={projectId} code={d.code ?? ''} version={d.version} rows={rows} />
            ))}
          </div>
          <p className="text-sm text-fg-2">{t.staleWarning}</p>
        </section>
      ) : null}
      <section aria-label={t.whoProposes} className="flex items-start gap-3 rounded-lg border border-edge px-3.5 py-3">
        <WhoAvatar kind={whoOf(batch.producer).kind} size={28} />
        <div className="flex flex-col gap-0.5 text-sm">
          <p className="font-medium text-fg">DEMIURGO</p>
          <p className="text-fg-2">{t.demiurgoOnlyProposes}</p>
        </div>
      </section>
    </>
  );
}

type Dialog = null | 'accept' | 'approve' | 'reject';

/** The package's decision: one set of dialogs, and a panel drawn at the top and in the footer. */
function usePackageDecision(projectId: string, batch: BatchDetail, proposals: ProposalData[]) {
  const t = useMessages(PACKAGE);
  const command = useCommand(projectId);
  const allows = useAllows('batch', batch.state);
  const [dialog, setDialog] = useState<Dialog>(null);
  const headingId = useId();
  const focusHeading = useRef(false);
  const warnings = [...new Set(proposals.flatMap((p) => (p.state === 'pending' ? (p.obsolescence ?? []) : [])))];
  const what = proposals.map(whatItRecords).join('; ');
  const open = (d: Dialog) => {
    command.reset();
    setDialog(d);
  };
  const run = (name: string, data: Record<string, unknown>, said: string) =>
    command.mutate(
      { command: name, entityId: batch.id, data },
      {
        onSuccess: () => {
          setDialog(null);
          announce(said);
          focusHeading.current = true;
        },
      },
    );

  useEffect(() => {
    if (!focusHeading.current || batch.state === 'pending') return;
    focusHeading.current = false;
    const timer = setTimeout(() => document.getElementById(headingId)?.focus(), 60);
    return () => clearTimeout(timer);
  });

  const canAccept = allows('batch.accept_package');
  const canReject = allows('batch.reject_package');
  const blocked = warnings.length > 0;

  const panel = (footer: boolean): ReactNode => {
    if (batch.state !== 'pending')
      return footer ? null : <Decided headingId={headingId} projectId={projectId} batch={batch} proposals={proposals} />;
    if (!canAccept && !canReject) return null;
    return (
      // The footer sticks along the whole column: the sticky element is this panel itself.
      <div
        className={footer ? 'sticky bottom-0 z-10 flex flex-col bg-panel' : 'flex flex-col gap-3'}
        data-package-decision={footer ? 'footer' : 'top'}
      >
        {!footer ? <BlockedNotice reasons={warnings} /> : null}
        <DecisionBar
          sticky={false}
          label={t.decidePackage}
          className={footer ? undefined : 'rounded-lg border border-edge px-4 pt-3 pb-3'}
          caption={
            footer ? null : blocked ? (
              <p>{t.blockedCaption}</p>
            ) : (
              <p>
                {t.acceptCaptionBefore(what)} <strong className="font-medium text-fg">{t.acceptAndApprove}</strong>{' '}
                {t.acceptCaptionAfter}
              </p>
            )
          }
        >
          {canAccept ? (
            <>
              <Button
                variant="primary"
                data-command="batch.accept_package"
                {...(blocked ? { 'aria-disabled': 'true' as const } : {})}
                onClick={() => !blocked && open('accept')}
              >
                {t.acceptPackage}
              </Button>
              <Button
                variant="secondary"
                data-command="batch.accept_package"
                {...(blocked ? { 'aria-disabled': 'true' as const } : {})}
                onClick={() => !blocked && open('approve')}
              >
                {t.acceptAndApprove}
              </Button>
            </>
          ) : null}
          {canReject ? (
            <Button variant="quiet-danger" data-command="batch.reject_package" onClick={() => open('reject')}>
              {t.rejectPackage}
            </Button>
          ) : null}
          {footer && blocked ? <span className="text-sm text-warning-text">{t.blockedFooter}</span> : null}
        </DecisionBar>
      </div>
    );
  };

  const dialogs = (
    <>
      <ConfirmDialog
        open={dialog === 'accept' || dialog === 'approve'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === 'approve' ? t.acceptDialogTitleApprove : t.acceptDialogTitleAccept}
        description={
          dialog === 'approve' ? (
            <div className="flex flex-col gap-1.5">
              <p>{t.twoThingsHappen}</p>
              <ol className="list-decimal space-y-0.5 pl-5">
                <li>{t.demiurgoRecords(what)}</li>
                <li>{t.youApproveBecomesCurrent}</li>
              </ol>
            </div>
          ) : (
            <p>{t.demiurgoRecordsDraft(what)}</p>
          )
        }
        confirm={dialog === 'approve' ? t.acceptAndApprove : t.acceptPackage}
        pendingLabel={t.acceptingEllipsis}
        pending={command.isPending}
        error={dialog === 'accept' || dialog === 'approve' ? command.error : null}
        onConfirm={() =>
          dialog === 'approve'
            ? run('batch.accept_package', { approve: true }, t.packageAcceptedApproved)
            : run('batch.accept_package', {}, t.packageAccepted)
        }
      />
      <PromptDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t.rejectDialogTitle}
        description={t.rejectDialogDescription}
        label={t.reasonLabel}
        submit={t.rejectPackage}
        pendingLabel={t.rejectingEllipsis}
        tone="danger"
        maxLength={2000}
        pending={command.isPending}
        error={dialog === 'reject' ? command.error : null}
        onSubmit={(text) => run('batch.reject_package', text ? { reason: text } : {}, t.packageRejected)}
      />
    </>
  );
  return { panel, dialogs };
}

/** The package once decided: its state and what it made (INV-BATCH-14). */
function Decided({
  headingId,
  projectId,
  batch,
  proposals,
}: {
  headingId: string;
  projectId: string;
  batch: BatchDetail;
  proposals: ProposalData[];
}) {
  const t = useMessages(PACKAGE);
  const rows = useQuery(stateQuery(projectId)).data;
  const all = rows ? [...rows.decisions, ...rows.designs] : [];
  const w = stateWord('batch', batch.state);
  const effects = proposals.map(acceptedRecord).filter((e) => e !== null);
  const reason = proposals.map((p) => p.resolution?.reason).find((r): r is string => typeof r === 'string' && r !== '');
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 rounded-lg border border-edge px-4 py-3" data-decided>
      <h2 id={headingId} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-fg outline-none">
        <StatusBadge kind={w.mark} word={w.word} size="md" />
        <span className="sr-only">: </span>
        {batch.state === 'superseded' ? t.cannotAcceptAnymoreHeading : t.decided}
      </h2>
      {batch.state === 'superseded' ? <p className="text-fg-2">{t.decidedSupersededBody}</p> : null}
      {effects.map((e) => (
        <p key={e.code} className="flex flex-wrap items-center gap-2 text-fg-2">
          <RecordChip projectId={projectId} code={e.code} version={e.version} rows={all} />
          {e.approved ? t.effectApproved : t.effectDraft}
        </p>
      ))}
      {batch.state === 'rejected' ? <p className="text-fg-2">{t.nothingRecorded}</p> : null}
      {batch.state === 'rejected' && reason ? <p className="text-sm text-fg-2">{t.reasonPrefix(reason)}</p> : null}
    </section>
  );
}
