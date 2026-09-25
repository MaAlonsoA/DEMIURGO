// What waits for the person, as the overview and the record page list it (DESIGN.md §3.5): the
// inbox as things in the one order Catch up walks them (needs-you/order.ts, catchUpOrder), each with
// its kind in words, where it comes from and where it opens. One order everywhere replaces the
// overview's own ranking, which disagreed with Catch up (INVENTORY §2 #7). Pure.

import type { Inbox, ProductState } from '../../api/types.ts';
import { EPISTEMIC_MARK, type MarkKind, TYPE_WORDS, whoOf } from '../../words.ts';
import { type NeedItem, catchUpOrder, needsOf } from '../needs-you/order.ts';

export type NeedsKind = NeedItem['kind'];

export type NeedsTarget =
  | { to: '/p/$projectId/batches/$batchId'; params: { batchId: string } }
  | { to: '/p/$projectId/threads/$explorationId'; params: { explorationId: string } }
  | { to: '/p/$projectId/records/$code'; params: { code: string }; search?: { v: number } }
  | { to: '/p/$projectId/needs-you'; params: Record<string, never> }
  | { to: '/p/$projectId/knowledge'; params: Record<string, never> };

export type NeedsItem = {
  /** Unique within the list (the kind and the id of what it is). */
  key: string;
  kind: NeedsKind;
  /** What it is, in a word or two ("Assumed answer", "Version to approve"). */
  label: string;
  title: string;
  /** Where it comes from, in words. */
  from: string;
  mark: MarkKind;
  target: NeedsTarget;
  /** Record codes whose readiness waits on it. */
  unblocks: string[];
  /** The record it is about, when it is one (to skip it on that record's own page). */
  code: string | null;
};

const epistemic = (e: string): MarkKind => EPISTEMIC_MARK[e] ?? 'unknown';

function payloadTitle(payload: Record<string, unknown>): string | null {
  for (const k of ['title', 'purpose']) if (typeof payload[k] === 'string') return payload[k];
  const doc = payload.document as { title?: unknown } | undefined;
  return typeof doc?.title === 'string' ? doc.title : null;
}

/** Who proposes, as the reason line says it. */
export function producerWords(producer: string): string {
  const who = whoOf(producer);
  if (who.kind === 'agent') return `From an agent · ${who.name}`;
  if (who.kind === 'demiurgo') return 'From DEMIURGO';
  if (who.kind === 'automatic') return 'Automatic';
  return 'From you';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function describe(n: NeedItem, state: ProductState | undefined): NeedsItem {
  const threads = new Map((state?.explorations ?? []).map((e) => [e.id, e.purpose]));
  const records = new Map([...(state?.designs ?? []), ...(state?.decisions ?? [])].map((r) => [r.code, r]));
  const base = { key: n.key, kind: n.kind, unblocks: n.unblocks };
  switch (n.kind) {
    case 'conflict': {
      const cited = (n.proposal.payload.record as { code?: string } | undefined)?.code ?? '';
      return {
        ...base,
        label: 'Conflict',
        title: records.get(cited)?.title ?? (cited || 'A record to review'),
        from: typeof n.proposal.payload.reason === 'string' ? n.proposal.payload.reason : 'Knowledge found it.',
        mark: 'conflict',
        target: { to: '/p/$projectId/batches/$batchId', params: { batchId: n.batch.id } },
        code: cited || null,
      };
    }
    case 'question': {
      const q = n.question;
      const assumed = q.state === 'inferred';
      const parked = q.state === 'postponed';
      return {
        ...base,
        label: assumed ? 'Assumed answer' : parked ? 'Parked question' : 'Question',
        title: q.question,
        from: threads.get(q.exploration_id) ?? 'A thread',
        mark: assumed ? 'assumed' : parked ? 'parked' : epistemic(q.epistemic_status),
        target: { to: '/p/$projectId/threads/$explorationId', params: { explorationId: q.exploration_id } },
        code: null,
      };
    }
    case 'package': {
      const b = n.batch;
      const first = b.proposals[0];
      return {
        ...base,
        label: 'Package',
        title:
          b.type === 'import' ? 'Imported from design/' : ((first && payloadTitle(first.payload)) ?? b.summary ?? 'A package'),
        from: `${producerWords(b.producer)} · ${plural(b.proposals.length, 'proposal')}`,
        mark: 'proposed',
        target: { to: '/p/$projectId/batches/$batchId', params: { batchId: b.id } },
        code: null,
      };
    }
    case 'proposal': {
      const p = n.proposal;
      return {
        ...base,
        label: 'Proposal',
        title: payloadTitle(p.payload) ?? n.batch.summary ?? 'A proposal',
        from: `${producerWords(n.batch.producer)} · ${n.position} of ${n.batch.proposals.length} in its batch`,
        mark: p.obsolescence.length > 0 ? 'stale' : epistemic(p.epistemic_status),
        target: { to: '/p/$projectId/batches/$batchId', params: { batchId: n.batch.id } },
        code: null,
      };
    }
    case 'version': {
      const v = n.version;
      return {
        ...base,
        label: v.approvable ? 'Version to approve' : 'Old draft to discard',
        title: v.title,
        from: `${TYPE_WORDS[v.type] ?? v.type} · ${v.code} v${v.n}`,
        mark: epistemic(v.epistemic_status),
        target: { to: '/p/$projectId/records/$code', params: { code: v.code }, search: { v: v.n } },
        code: v.code,
      };
    }
    case 'link': {
      const l = n.link;
      return {
        ...base,
        label: 'Link to review',
        title: `${l.from_title} → ${l.to_title}`,
        from: `${l.from_code} v${l.from_n} → ${l.to_code} v${l.to_n}`,
        mark: 'problem',
        // The version that holds the link, not only the record (INVENTORY: vague destinations).
        target: { to: '/p/$projectId/records/$code', params: { code: l.from_code }, search: { v: l.from_n } },
        code: l.from_code,
      };
    }
    case 'classification': {
      const c = n.classification;
      return {
        ...base,
        label: 'Classification',
        title: `${c.category} · ${c.axis}`,
        from: c.node_ref,
        mark: 'proposed',
        target: { to: '/p/$projectId/needs-you', params: {} },
        code: null,
      };
    }
    default: {
      const u = n.update;
      return {
        ...base,
        label: 'Knowledge update',
        title: 'A knowledge update failed',
        from: u.failure ?? 'It can be retried.',
        mark: 'problem',
        target: { to: '/p/$projectId/knowledge', params: {} },
        code: null,
      };
    }
  }
}

/** What waits for the person, in the order of Catch up. */
export function needsItems(inbox: Inbox, state: ProductState | undefined): NeedsItem[] {
  const rows = [...(state?.designs ?? []), ...(state?.decisions ?? [])];
  return catchUpOrder(needsOf(inbox, rows)).map((n) => describe(n, state));
}

/** Right after ratifying: records exist, none is approved, and their versions wait for the person. */
export function justRatified(state: ProductState | undefined, inbox: Inbox | undefined): boolean {
  const rows = [...(state?.designs ?? []), ...(state?.decisions ?? [])];
  return rows.length > 0 && rows.every((r) => r.current === null) && (inbox?.versions_to_approve.length ?? 0) > 0;
}

/** "7 things · 1 package of 4 proposals": the count reconciled with the rows (a package is one row). */
export function packagesNote(inbox: Inbox): string | null {
  const packages = inbox.batches.filter((b) => b.type !== 'knowledge' && b.resolution === 'package' && b.proposals.length > 0);
  if (packages.length === 0) return null;
  const proposals = packages.reduce((n, b) => n + b.proposals.length, 0);
  return packages.length === 1
    ? `1 package of ${plural(proposals, 'proposal')}`
    : `${packages.length} packages of ${plural(proposals, 'proposal')}`;
}
