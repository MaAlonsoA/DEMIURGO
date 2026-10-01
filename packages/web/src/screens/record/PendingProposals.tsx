// The pending AI proposals that target a record (or a planned feature), shown on its own page and
// decided there with the same view Needs you uses. Read from the inbox the page already loads.

import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import type { Inbox, InboxProposal, ProductRow, Proposal } from '../../api/types.ts';
import { useMessages } from '../../i18n/define.ts';
import { pendingProposalBatches, proposalTargetCode } from '../../lib/attention.ts';
import { cn } from '../../lib/cn.ts';
import { linkClass } from '../batch/parts.tsx';
import { ProposalView } from '../batch/ProposalView.tsx';
import { PENDING_PROPOSALS } from './words.i18n.ts';

/** The one record a batch's proposals are about, when there is exactly one (else its page is the way in). */
export { proposalTargetCode };

export function singleTargetCode(proposals: readonly Pick<Proposal, 'type' | 'payload'>[]): string | null {
  const codes = new Set(proposals.map((p) => proposalTargetCode(p)));
  const [only] = codes;
  return codes.size === 1 && only ? only : null;
}

/** A screens proposal (`screen_design`) is about the feature its spec names. */
export function isScreensOf(featureCode: string) {
  return (p: Pick<InboxProposal, 'type' | 'payload'>) =>
    p.type === 'screen_design' && (p.payload.spec as { feature?: { code?: unknown } } | undefined)?.feature?.code === featureCode;
}

export function PendingProposals({
  projectId,
  code,
  inbox,
  rows,
  matches,
}: {
  projectId: string;
  code: string;
  inbox: Inbox | undefined;
  rows: readonly ProductRow[];
  /** Another way to match the proposals of this page than by their target code (a screens proposal has no record yet). */
  matches?: (p: Pick<InboxProposal, 'type' | 'payload'>) => boolean;
}) {
  const t = useMessages(PENDING_PROPOSALS);
  const id = useId();
  const found = pendingProposalBatches(inbox)
    .flatMap((b) =>
      b.proposals
        .map((proposal, i) => ({ batch: b, proposal, position: i + 1 }))
        .filter((x) => x.proposal.state === 'pending' && (matches ? matches(x.proposal) : proposalTargetCode(x.proposal) === code)),
    );
  if (found.length === 0) return null;
  return (
    <section id={matches ? undefined : 'proposal'} aria-label={t.title} data-pending-proposals className="flex scroll-mt-16 flex-col gap-4">
      <h2 className="text-lg font-semibold text-fg">{t.title}</h2>
      {found.map(({ batch: b, proposal, position }) => (
        <ProposalView
          key={proposal.id}
          projectId={projectId}
          proposal={proposal}
          position={position}
          count={b.proposals.length}
          producer={b.producer}
          createdAt={b.created}
          runId={b.run_id}
          rows={rows}
          titleId={`${id}-${proposal.id}`}
          onDone={() => {}}
          meta={
            <>
              <span aria-hidden>·</span>
              <Link
                to="/p/$projectId/batches/$batchId"
                params={{ projectId, batchId: b.id }}
                className={cn(linkClass, 'inline-flex min-h-6 items-center')}
              >
                {t.openBatch}
              </Link>
            </>
          }
        />
      ))}
    </section>
  );
}
