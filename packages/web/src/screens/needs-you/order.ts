// What waits for the person (the inbox) as a list of things, in the groups of Needs you and in
// the order of Catch up (FDR-INT-001, behavior 10). "What it unblocks" is read from the readiness
// reasons the server gives (packages/domain/src/records.ts, readiness()): nothing is invented.

import { questionReason } from '../../../../domain/src/records.ts';
import type { Inbox, InboxBatch, InboxLink, InboxProposal, InboxQuestion, InboxVersion, ProductRow } from '../../api/types.ts';

export type Classification = Inbox['classifications_to_review'][number];
export type FailedUpdate = Inbox['rejected_updates'][number];

export type Need =
  /** A review knowledge proposes: something may contradict a record. */
  | { kind: 'conflict'; key: string; batch: InboxBatch; proposal: InboxProposal; approved: boolean }
  | { kind: 'question'; key: string; question: InboxQuestion }
  /** A package (an import or DEMIURGO's): it is resolved whole, on its page. */
  | { kind: 'package'; key: string; batch: InboxBatch }
  /** One proposal of a batch resolved item by item. */
  | { kind: 'proposal'; key: string; batch: InboxBatch; proposal: InboxProposal; position: number }
  | { kind: 'version'; key: string; version: InboxVersion }
  | { kind: 'link'; key: string; link: InboxLink }
  | { kind: 'classification'; key: string; classification: Classification }
  | { kind: 'update'; key: string; update: FailedUpdate };

export type NeedItem = Need & { unblocks: string[]; minutes: number };

export type GroupKey = 'conflicts' | 'questions' | 'proposals' | 'versions' | 'links' | 'classifications' | 'updates';

export const GROUPS: { key: GroupKey; title: string; kinds: Need['kind'][] }[] = [
  { key: 'conflicts', title: 'Conflicts', kinds: ['conflict'] },
  { key: 'questions', title: 'Questions', kinds: ['question'] },
  { key: 'proposals', title: 'Proposals', kinds: ['proposal', 'package'] },
  { key: 'versions', title: 'Versions to approve', kinds: ['version'] },
  { key: 'links', title: 'Links to review', kinds: ['link'] },
  { key: 'classifications', title: 'Classifications to review', kinds: ['classification'] },
  { key: 'updates', title: 'Knowledge updates that failed', kinds: ['update'] },
];

/** About how long each thing takes, as the canvas estimates it (a question, a minute). */
const MINUTES: Record<Need['kind'], number> = {
  conflict: 2,
  question: 1,
  package: 3,
  proposal: 1,
  version: 2,
  link: 1,
  classification: 1,
  update: 1,
};

const reasonsOf = (r: ProductRow): string[] => r.readiness?.reasons ?? [];

/** Codes of the records whose readiness has a reason that matches. */
function blockedBy(rows: readonly ProductRow[], match: (reason: string, row: ProductRow) => boolean): string[] {
  return rows.filter((r) => reasonsOf(r).some((reason) => match(reason, r))).map((r) => r.code);
}

const PENDING_PROPOSALS = /^There are \d+ pending proposal\(s\) affecting it\.$/;

/** What resolving the thing lets through: the records whose readiness reasons cite it. */
export function unblocksOf(need: Need, rows: readonly ProductRow[]): string[] {
  switch (need.kind) {
    case 'question': {
      const q = need.question;
      if (!['pending', 'postponed', 'inferred'].includes(q.state)) return [];
      const reason = questionReason(q.state, q.question);
      return blockedBy(rows, (text, r) => r.origin_exploration === q.exploration_id && text === reason);
    }
    case 'version': {
      const v = need.version;
      return blockedBy(
        rows,
        (text, r) =>
          (r.code === v.code && text === `Version ${v.n} is not approved.`) ||
          text === `The decision it is based on, ${v.code}, is not approved.`,
      );
    }
    case 'link': {
      const l = need.link;
      const reasons = [
        `The link with ${l.to_code} is pending review.`,
        `The link with ${l.to_code} v${l.to_n} is pending review.`,
      ];
      return blockedBy(rows, (text, r) => r.code === l.from_code && reasons.includes(text));
    }
    case 'proposal':
    case 'conflict':
    case 'package': {
      const proposals = need.kind === 'package' ? need.batch.proposals : [need.proposal];
      const codes = new Set(
        [...need.batch.dependencies, ...proposals.flatMap((p) => p.dependencies)].flatMap((d) => (d.code ? [d.code] : [])),
      );
      return blockedBy(rows, (text, r) => codes.has(r.code) && PENDING_PROPOSALS.test(text));
    }
    default:
      return [];
  }
}

/** Is the record a review touches approved (its current version is the one reviewed, or any)? */
function isApproved(rows: readonly ProductRow[], record: { code?: string; version?: number } | undefined): boolean {
  const row = rows.find((r) => r.code === record?.code);
  return !!row && row.current !== null && (record?.version === undefined || row.current === record.version);
}

/** The inbox as things, in the groups and order of the list. */
export function needsOf(inbox: Inbox, rows: readonly ProductRow[]): NeedItem[] {
  const needs: Need[] = [];
  for (const b of inbox.batches.filter((x) => x.type === 'knowledge')) {
    for (const p of b.proposals) {
      const record = p.payload.record as { code?: string; version?: number } | undefined;
      needs.push({ kind: 'conflict', key: `conflict:${p.id}`, batch: b, proposal: p, approved: isApproved(rows, record) });
    }
  }
  const questions = [...inbox.questions_to_confirm, ...inbox.open_questions].map(
    (question): Need => ({ kind: 'question', key: `question:${question.id}`, question }),
  );
  const blocking = new Set(questions.filter((q) => unblocksOf(q, rows).length > 0).map((q) => q.key));
  needs.push(...questions.filter((q) => blocking.has(q.key)), ...questions.filter((q) => !blocking.has(q.key)));
  for (const b of inbox.batches.filter((x) => x.type !== 'knowledge' && x.proposals.length > 0)) {
    if (b.resolution === 'package') needs.push({ kind: 'package', key: `package:${b.id}`, batch: b });
    else
      b.proposals.forEach((proposal, i) =>
        needs.push({ kind: 'proposal', key: `proposal:${proposal.id}`, batch: b, proposal, position: i + 1 }),
      );
  }
  needs.push(...inbox.versions_to_approve.map((version): Need => ({ kind: 'version', key: `version:${version.id}`, version })));
  needs.push(...inbox.links_under_review.map((link): Need => ({ kind: 'link', key: `link:${link.id}`, link })));
  needs.push(
    ...inbox.classifications_to_review.map(
      (classification): Need => ({ kind: 'classification', key: `classification:${classification.id}`, classification }),
    ),
  );
  needs.push(...inbox.rejected_updates.map((update): Need => ({ kind: 'update', key: `update:${update.id}`, update })));
  return needs.map((n) => ({ ...n, unblocks: unblocksOf(n, rows), minutes: MINUTES[n.kind] }));
}

/**
 * Rank in Catch up (FDR-INT-001, behavior 10): 1 conflicts with something approved, 2 questions that
 * block a readiness, 3 proposals, 4 versions to approve, 5 links and classifications, 6 the rest.
 */
export function catchUpRank(n: NeedItem): number {
  switch (n.kind) {
    case 'conflict':
      return n.approved ? 1 : 3;
    case 'question':
      return n.unblocks.length > 0 ? 2 : 6;
    case 'proposal':
    case 'package':
      return 3;
    case 'version':
      return 4;
    case 'link':
    case 'classification':
      return 5;
    default:
      return 6;
  }
}

/** The list in Catch up order; within a rank, the list's own order. */
export function catchUpOrder(items: readonly NeedItem[]): NeedItem[] {
  return items
    .map((item, i) => ({ item, i, rank: catchUpRank(item) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.item);
}

export type Group = { key: GroupKey; title: string; items: NeedItem[] };

/** The non-empty groups of the list, in their order. */
export function groupsOf(items: readonly NeedItem[]): Group[] {
  return GROUPS.map((g) => ({ key: g.key, title: g.title, items: items.filter((i) => g.kinds.includes(i.kind)) })).filter(
    (g) => g.items.length > 0,
  );
}

export function minutesOf(items: readonly NeedItem[]): number {
  return items.reduce((n, i) => n + i.minutes, 0);
}
