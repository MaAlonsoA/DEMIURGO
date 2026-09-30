// What of a record needs the person, counted once for every list that shows records (the epic
// board, the epics, the records navigator) so all of them agree: the pending proposals that target
// its code and the drafts waiting for approval.

import type { Inbox, InboxProposal } from '../api/types.ts';

/** The code of the record a proposal is about, when it has one (definition, thread and plan proposals do not). */
export function proposalTargetCode(p: Pick<InboxProposal, 'type' | 'payload'>): string | null {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  if (p.type === 'design_record') return str(p.payload.code);
  if (p.type === 'record_change') return str((p.payload.record as { code?: unknown } | undefined)?.code);
  return null;
}

/** The batches whose proposals are decided one by one on a record's page (not knowledge nor package resolutions). */
export function pendingProposalBatches(inbox: Inbox | undefined): Inbox['batches'] {
  return (inbox?.batches ?? []).filter((b) => b.type !== 'knowledge' && b.resolution !== 'package');
}

/** The pending proposals that target a record's code: the one rule every count of proposals uses. */
export function pendingProposalsOf(inbox: Inbox | undefined, code: string): number {
  return pendingProposalBatches(inbox).reduce(
    (n, b) => n + b.proposals.filter((p) => p.state === 'pending' && proposalTargetCode(p) === code).length,
    0,
  );
}

export type Attention = { proposals: number; drafts: number };

/** Per record code: its pending proposals and its drafts to approve. Codes with nothing are absent. */
export function attentionByCode(inbox: Inbox | undefined): Map<string, Attention> {
  const out = new Map<string, Attention>();
  const at = (code: string) => {
    let a = out.get(code);
    if (!a) out.set(code, (a = { proposals: 0, drafts: 0 }));
    return a;
  };
  for (const b of pendingProposalBatches(inbox)) {
    for (const p of b.proposals) {
      const code = p.state === 'pending' ? proposalTargetCode(p) : null;
      if (code) at(code).proposals += 1;
    }
  }
  for (const v of inbox?.versions_to_approve ?? []) at(v.code).drafts += 1;
  return out;
}

/** The attention of several codes together (an epic and its features). */
export function attentionOf(map: Map<string, Attention>, codes: readonly string[]): number {
  return codes.reduce((n, c) => {
    const a = map.get(c);
    return n + (a ? a.proposals + a.drafts : 0);
  }, 0);
}
