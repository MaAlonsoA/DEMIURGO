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
  const inbox = useQuery(inboxQuery(projectId)).data;
  const state = useQuery(stateQuery(projectId)).data;
  const rows: ProductRow[] = state ? [...state.decisions, ...state.designs] : [];
  const proposals = withInbox(batch, inbox?.batches.find((b) => b.id === batch.id)?.proposals ?? []);
  const n = proposals.length;
  const single = n === 1 ? proposals[0] : undefined;
  const title = single ? proposalTitle(single) : 'A package from DEMIURGO';
  const crumbs = useBatchCrumbs(projectId, 'Package from DEMIURGO');
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
              Package from DEMIURGO
            </span>
            <span aria-hidden>·</span>
            <span>
              {n} {n === 1 ? 'proposal' : 'proposals'}
            </span>
            <EntityState entity="batch" state={batch.state} />
          </>
        }
        title={title}
        meta={
          <>
            <RelativeTime iso={batch.created_at} />
            <span>{batch.summary ? `${batch.summary} ` : ''}It is accepted or rejected whole.</span>
          </>
        }
      />
      <PageBody>
        <WithAside asideLabel="About this package" aside={<PackageAside projectId={projectId} batch={batch} rows={rows} />}>
          <div className="flex max-w-3xl flex-col gap-8">
            <div ref={top}>{decision.panel(false)}</div>
            {batch.run_id ? (
              <Evidence title="Drafted by DEMIURGO">
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
  const id = useId();
  const obsolete = obsoleteReason(p);
  return (
    <article aria-labelledby={id} data-proposal={p.id} data-state={p.state} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-fg-2">
            <TypeIcon type={proposalIconType(p)} size={15} className="text-fg-3" />
            {kindWord(p.type)}
          </span>
          {p.state === 'superseded' ? (
            <StatusBadge kind="stale" word="Out of date" />
          ) : (
            <EntityState entity="proposal" state={p.state} />
          )}
        </div>
        <h2 id={id} className="text-lg font-semibold text-fg">
          {single ? 'What it records' : proposalTitle(p)}
        </h2>
      </div>
      {p.state === 'superseded' ? (
        <OutOfDate>{`${obsolete ?? 'What it was based on changed.'} It can't be accepted any more.`}</OutOfDate>
      ) : null}
      <ProposalBody projectId={projectId} proposal={p} rows={rows} withGoal />
      <IdeaCheck projectId={projectId} assessment={p.assessment} rows={rows} />
    </article>
  );
}

function PackageAside({ projectId, batch, rows }: { projectId: string; batch: BatchDetail; rows: readonly ProductRow[] }) {
  const deps = batch.dependencies.filter((d) => d.code);
  return (
    <>
      {deps.length > 0 ? (
        <section aria-label="Starts from" className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-fg">Starts from</h2>
          <div className="flex flex-wrap gap-2">
            {deps.map((d) => (
              <RecordChip key={d.id} projectId={projectId} code={d.code ?? ''} version={d.version} rows={rows} />
            ))}
          </div>
          <p className="text-sm text-fg-2">If it gets a newer version before you decide, the package goes out of date.</p>
        </section>
      ) : null}
      <section aria-label="Who proposes" className="flex items-start gap-3 rounded-lg border border-edge px-3.5 py-3">
        <WhoAvatar kind={whoOf(batch.producer).kind} size={28} />
        <div className="flex flex-col gap-0.5 text-sm">
          <p className="font-medium text-fg">DEMIURGO</p>
          <p className="text-fg-2">It only proposes: nothing changes until you accept.</p>
        </div>
      </section>
    </>
  );
}

type Dialog = null | 'accept' | 'approve' | 'reject';

/** The package's decision: one set of dialogs, and a panel drawn at the top and in the footer. */
function usePackageDecision(projectId: string, batch: BatchDetail, proposals: ProposalData[]) {
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
    const t = setTimeout(() => document.getElementById(headingId)?.focus(), 60);
    return () => clearTimeout(t);
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
          label="Decide the package"
          className={footer ? undefined : 'rounded-lg border border-edge px-4 pt-3 pb-3'}
          caption={
            footer ? null : blocked ? (
              <p>It can&apos;t be accepted until the warning above is resolved. You can still reject it.</p>
            ) : (
              <p>
                Accepting records {what} as a draft. <strong className="font-medium text-fg">Accept and approve</strong> also
                approves it: it becomes the current version. Nothing changes until you decide.
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
                Accept package
              </Button>
              <Button
                variant="secondary"
                data-command="batch.accept_package"
                {...(blocked ? { 'aria-disabled': 'true' as const } : {})}
                onClick={() => !blocked && open('approve')}
              >
                Accept and approve
              </Button>
            </>
          ) : null}
          {canReject ? (
            <Button variant="quiet-danger" data-command="batch.reject_package" onClick={() => open('reject')}>
              Reject package
            </Button>
          ) : null}
          {footer && blocked ? <span className="text-sm text-warning-text">Blocked: see the warning at the top.</span> : null}
        </DecisionBar>
      </div>
    );
  };

  const dialogs = (
    <>
      <ConfirmDialog
        open={dialog === 'accept' || dialog === 'approve'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === 'approve' ? 'Accept and approve this package?' : 'Accept this package?'}
        description={
          dialog === 'approve' ? (
            <div className="flex flex-col gap-1.5">
              <p>Two things happen:</p>
              <ol className="list-decimal space-y-0.5 pl-5">
                <li>DEMIURGO records {what}.</li>
                <li>You approve it: it becomes the current version.</li>
              </ol>
            </div>
          ) : (
            <p>DEMIURGO records {what} as a draft. You approve it later, on its page.</p>
          )
        }
        confirm={dialog === 'approve' ? 'Accept and approve' : 'Accept package'}
        pendingLabel="Accepting…"
        pending={command.isPending}
        error={dialog === 'accept' || dialog === 'approve' ? command.error : null}
        onConfirm={() =>
          dialog === 'approve'
            ? run('batch.accept_package', { approve: true }, 'Package accepted and approved.')
            : run('batch.accept_package', {}, 'Package accepted.')
        }
      />
      <PromptDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reject this package?"
        description="Nothing is recorded. Say why, if you want: the reason is kept with the package."
        label="Reason"
        submit="Reject package"
        pendingLabel="Rejecting…"
        tone="danger"
        maxLength={2000}
        pending={command.isPending}
        error={dialog === 'reject' ? command.error : null}
        onSubmit={(text) => run('batch.reject_package', text ? { reason: text } : {}, 'Package rejected.')}
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
        {batch.state === 'superseded' ? 'It can’t be accepted any more' : 'Decided'}
      </h2>
      {batch.state === 'superseded' ? (
        <p className="text-fg-2">What it was based on changed. It can&apos;t be accepted any more.</p>
      ) : null}
      {effects.map((e) => (
        <p key={e.code} className="flex flex-wrap items-center gap-2 text-fg-2">
          <RecordChip projectId={projectId} code={e.code} version={e.version} rows={all} />
          {e.approved ? 'is approved and current.' : 'is a draft: approve it on its page.'}
        </p>
      ))}
      {batch.state === 'rejected' ? <p className="text-fg-2">Nothing was recorded.</p> : null}
      {batch.state === 'rejected' && reason ? <p className="text-sm text-fg-2">Reason: {reason}</p> : null}
    </section>
  );
}
