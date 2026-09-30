// The pending AI proposals that target a record (or a planned feature), shown on its own page and
// decided there with the same view Needs you uses. Read from the inbox the page already loads.

import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import type { Inbox, InboxProposal, ProductRow, Proposal } from '../../api/types.ts';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { linkClass } from '../batch/parts.tsx';
import { ProposalView } from '../batch/ProposalView.tsx';
import { PENDING_PROPOSALS } from './words.i18n.ts';

/** The code of the record a proposal is about, when it has one (definition, thread and plan proposals do not). */
export function proposalTargetCode(p: Pick<InboxProposal, 'type' | 'payload'>): string | null {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  if (p.type === 'design_record') return str(p.payload.code);
  if (p.type === 'record_change') return str((p.payload.record as { code?: unknown } | undefined)?.code);
  return null;
}

/** The one record a batch's proposals are about, when there is exactly one (else its page is the way in). */
export function singleTargetCode(proposals: readonly Pick<Proposal, 'type' | 'payload'>[]): string | null {
  const codes = new Set(proposals.map((p) => proposalTargetCode(p)));
  const [only] = codes;
  return codes.size === 1 && only ? only : null;
}

export function PendingProposals({
  projectId,
  code,
  inbox,
  rows,
}: {
  projectId: string;
  code: string;
  inbox: Inbox | undefined;
  rows: readonly ProductRow[];
}) {
  const t = useMessages(PENDING_PROPOSALS);
  const id = useId();
  const found = (inbox?.batches ?? [])
    .filter((b) => b.type !== 'knowledge' && b.resolution !== 'package')
    .flatMap((b) =>
      b.proposals
        .map((proposal, i) => ({ batch: b, proposal, position: i + 1 }))
        .filter((x) => x.proposal.state === 'pending' && proposalTargetCode(x.proposal) === code),
    );
  if (found.length === 0) return null;
  return (
    <section aria-label={t.title} data-pending-proposals className="flex flex-col gap-4">
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
