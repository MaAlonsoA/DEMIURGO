// What waits for the person, in the order "Catch up" walks it (FDR-INT-001, behavior 10):
// conflicts, questions (those that block a readiness first), proposals, versions to approve,
// links and classifications, and the rest. Right after ratifying, the versions go first.

import type { Epistemic, Inbox, ProductState } from '../../api/types.ts';
import { TYPE_WORDS, type MarkKind, EPISTEMIC_MARK, whoOf } from '../../words.ts';

export type NeedsKind =
  | 'conflict'
  | 'question'
  | 'assumed'
  | 'proposal'
  | 'package'
  | 'version'
  | 'link'
  | 'classification'
  | 'update';

export type NeedsTarget =
  | { to: '/p/$projectId/batches/$batchId'; params: { batchId: string } }
  | { to: '/p/$projectId/threads/$explorationId'; params: { explorationId: string } }
  | { to: '/p/$projectId/records/$code'; params: { code: string }; search?: { v: number } }
  | { to: '/p/$projectId/needs-you'; params: Record<string, never> }
  | { to: '/p/$projectId/knowledge'; params: Record<string, never> };

export type NeedsItem = {
  id: string;
  kind: NeedsKind;
  /** What it is, in a word or two. */
  label: string;
  title: string;
  /** Where it comes from. */
  from: string;
  mark: MarkKind;
  target: NeedsTarget;
};

export const NEEDS_LABELS: Record<NeedsKind, string> = {
  conflict: 'Conflict',
  question: 'Question',
  assumed: 'Assumed answer',
  proposal: 'Proposal',
  package: 'Package',
  version: 'Version to approve',
  link: 'Link to review',
  classification: 'Classification',
  update: 'Knowledge update',
};

const mark = (e: Epistemic): MarkKind => EPISTEMIC_MARK[e] ?? 'unknown';

function payloadTitle(payload: Record<string, unknown>): string | null {
  for (const k of ['title', 'purpose']) if (typeof payload[k] === 'string') return payload[k];
  const doc = payload.document as { title?: unknown } | undefined;
  return typeof doc?.title === 'string' ? doc.title : null;
}

function producerWords(producer: string): string {
  const who = whoOf(producer);
  if (who.kind === 'agent') return `From an agent · ${who.name}`;
  if (who.kind === 'demiurgo') return 'From DEMIURGO';
  if (who.kind === 'automatic') return 'Automatic';
  return 'From you';
}

export function needsItems(inbox: Inbox, state: ProductState | undefined): NeedsItem[] {
  const threads = new Map((state?.explorations ?? []).map((e) => [e.id, e.purpose]));
  const records = new Map([...(state?.designs ?? []), ...(state?.decisions ?? [])].map((r) => [r.code, r]));
  const blocking = new Set(
    [...(state?.designs ?? [])].filter((r) => r.origin_exploration && !r.readiness?.ready).map((r) => r.origin_exploration),
  );
  const conflicts: NeedsItem[] = [];
  const proposals: NeedsItem[] = [];
  for (const b of inbox.batches) {
    if (b.type === 'knowledge') {
      for (const p of b.proposals) {
        const cited = (p.payload.record as { code?: string } | undefined)?.code ?? '';
        conflicts.push({
          id: p.id,
          kind: 'conflict',
          label: NEEDS_LABELS.conflict,
          title: records.get(cited)?.title ?? (cited || 'A record to review'),
          from: typeof p.payload.reason === 'string' ? p.payload.reason : 'Knowledge found it.',
          mark: 'conflict',
          target: { to: '/p/$projectId/batches/$batchId', params: { batchId: b.id } },
        });
      }
    } else if (b.resolution === 'package') {
      const first = b.proposals[0];
      proposals.push({
        id: b.id,
        kind: 'package',
        label: NEEDS_LABELS.package,
        title:
          b.type === 'import' ? 'Imported from design/' : ((first && payloadTitle(first.payload)) ?? b.summary ?? 'A package'),
        from: `${producerWords(b.producer)} · ${b.proposals.length} ${b.proposals.length === 1 ? 'proposal' : 'proposals'}`,
        mark: 'proposed',
        target: { to: '/p/$projectId/batches/$batchId', params: { batchId: b.id } },
      });
    } else {
      for (const p of b.proposals) {
        proposals.push({
          id: p.id,
          kind: 'proposal',
          label: NEEDS_LABELS.proposal,
          title: payloadTitle(p.payload) ?? b.summary ?? 'A proposal',
          from: producerWords(b.producer),
          mark: p.obsolescence.length ? 'stale' : mark(p.epistemic_status),
          target: { to: '/p/$projectId/batches/$batchId', params: { batchId: b.id } },
        });
      }
    }
  }
  const questions = [...inbox.open_questions, ...inbox.questions_to_confirm].map(
    (q): NeedsItem => ({
      id: q.id,
      kind: q.state === 'inferred' ? 'assumed' : 'question',
      label: q.state === 'inferred' ? NEEDS_LABELS.assumed : q.state === 'postponed' ? 'Parked question' : NEEDS_LABELS.question,
      title: q.question,
      from: threads.get(q.exploration_id) ?? 'A thread',
      mark: q.state === 'inferred' ? 'assumed' : q.state === 'postponed' ? 'parked' : mark(q.epistemic_status),
      target: { to: '/p/$projectId/threads/$explorationId', params: { explorationId: q.exploration_id } },
    }),
  );
  // Questions that block a readiness go first (a pending or parked one in the thread of a feature that isn't ready).
  const blocks = (q: NeedsItem) =>
    q.kind === 'question' &&
    q.target.to === '/p/$projectId/threads/$explorationId' &&
    blocking.has(q.target.params.explorationId);
  const orderedQuestions = [...questions.filter(blocks), ...questions.filter((q) => !blocks(q))];
  const versions = inbox.versions_to_approve.map(
    (v): NeedsItem => ({
      id: v.id,
      kind: 'version',
      label: v.approvable ? NEEDS_LABELS.version : 'Old draft to discard',
      title: v.title,
      from: `${TYPE_WORDS[v.type] ?? v.type} · ${v.code} v${v.n}`,
      mark: mark(v.epistemic_status),
      target: { to: '/p/$projectId/records/$code', params: { code: v.code }, search: { v: v.n } },
    }),
  );
  const links = inbox.links_under_review.map(
    (l): NeedsItem => ({
      id: l.id,
      kind: 'link',
      label: NEEDS_LABELS.link,
      title: `${l.from_title} → ${l.to_title}`,
      from: `${l.from_code} v${l.from_n} → ${l.to_code} v${l.to_n}`,
      mark: 'problem',
      target: { to: '/p/$projectId/records/$code', params: { code: l.from_code } },
    }),
  );
  const classifications = inbox.classifications_to_review.map(
    (c): NeedsItem => ({
      id: c.id,
      kind: 'classification',
      label: NEEDS_LABELS.classification,
      title: `${c.category} · ${c.axis}`,
      from: c.node_ref,
      mark: 'proposed',
      target: { to: '/p/$projectId/needs-you', params: {} },
    }),
  );
  const updates = inbox.rejected_updates.map(
    (u): NeedsItem => ({
      id: u.id,
      kind: 'update',
      label: NEEDS_LABELS.update,
      title: 'A knowledge update failed',
      from: u.failure ?? 'It can be retried.',
      mark: 'problem',
      target: { to: '/p/$projectId/knowledge', params: {} },
    }),
  );
  if (justRatified(state, inbox)) {
    return [...versions, ...conflicts, ...orderedQuestions, ...proposals, ...links, ...classifications, ...updates];
  }
  return [...conflicts, ...orderedQuestions, ...proposals, ...versions, ...links, ...classifications, ...updates];
}

/** Right after ratifying: records exist, none is approved, and their versions wait for the person. */
export function justRatified(state: ProductState | undefined, inbox: Inbox | undefined): boolean {
  const rows = [...(state?.designs ?? []), ...(state?.decisions ?? [])];
  return rows.length > 0 && rows.every((r) => r.current === null) && (inbox?.versions_to_approve.length ?? 0) > 0;
}
