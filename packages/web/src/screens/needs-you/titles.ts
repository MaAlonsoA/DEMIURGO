// How each thing of Needs you is named and why it is there, in words (DESIGN.md §3.1): its title,
// its kind, the reason line of the queue, and the header's count once packages are reconciled with
// the rows. Pure, so the queue, the detail and Catch up say the same thing.

import type { Exploration, ProductRow, Taxonomy } from '../../api/types.ts';
import { type Aspect, aspectOfProposal, aspectOfType } from '../../aspects.ts';
import { taskDraftsFeature } from '../../lib/attention.ts';
import { proposalTitle, rowOf, rowOfVersion } from '../batch/model.ts';
import type { NeedItem } from './order.ts';
import { TITLES } from './words.i18n.ts';

type Words = typeof TITLES.en;

export function packageTitle(
  item: Extract<NeedItem, { kind: 'package' }>,
  words: Words = TITLES.en,
  rows: readonly ProductRow[] = [],
): string {
  // The tasks planned for one feature are one thing: "9 draft tasks for FDR-X title".
  const feature = taskDraftsFeature(item.batch);
  if (feature) return words.taskDraftsTitle(item.batch.proposals.length, feature, rowOf(rows, feature)?.title ?? '');
  if (item.batch.type === 'import') return words.packageImported;
  const first = item.batch.proposals[0];
  return (first ? proposalTitle(first) : '') || words.packageFallback;
}

export function conflictTitle(
  item: Extract<NeedItem, { kind: 'conflict' }>,
  rows: readonly ProductRow[],
  words: Words = TITLES.en,
): string {
  const r = item.proposal.payload.record as { code?: string } | undefined;
  const name = rowOf(rows, r?.code ?? '')?.title ?? r?.code ?? words.recordFallback;
  return `${name} ${words.verdictWord(String(item.proposal.payload.verdict))}`;
}

/** The record a knowledge node ref (CODE@n) names, by its title when the product has it. */
export function nodeName(ref: string, rows: readonly ProductRow[]): string {
  const code = ref.split('@')[0] ?? ref;
  return rowOf(rows, code)?.title ?? code;
}

export function updateTitle(
  item: Extract<NeedItem, { kind: 'update' }>,
  rows: readonly ProductRow[],
  words: Words = TITLES.en,
): string {
  const t = item.update.trigger as { type?: string; id?: string } | null;
  const row = t?.id ? rowOfVersion(rows, t.id) : undefined;
  if (row) return words.updateWithTitle(row.title);
  if (t?.type === 'proposal') return words.updateAcceptedProposal;
  return words.updateChange;
}

/** A thing's title, as the queue, the detail and Catch up name it. */
export function needTitle(item: NeedItem, rows: readonly ProductRow[], words: Words = TITLES.en): string {
  switch (item.kind) {
    case 'conflict':
      return conflictTitle(item, rows, words);
    case 'question':
      return item.question.question;
    case 'package':
      return packageTitle(item, words, rows);
    case 'proposal':
      return proposalTitle(item.proposal) || words.proposalFallback;
    case 'version':
      return item.version.title;
    case 'link':
      return words.linkTitle(item.link.from_title, item.link.to_title);
    case 'classification':
      return nodeName(item.classification.node_ref, rows);
    case 'update':
      return updateTitle(item, rows, words);
  }
}

export type ReasonContext = { rows: readonly ProductRow[]; threads: readonly Pick<Exploration, 'id' | 'purpose'>[] };

/** Why a thing is in Needs you, in one line of the queue ("Asked by DEMIURGO in Global quality"). */
export function needReason(item: NeedItem, ctx: ReasonContext, words: Words = TITLES.en): string {
  switch (item.kind) {
    case 'conflict':
      // A coherence finding (FDR-KNO-056) was found reading the whole epic, not after one change.
      if (item.proposal.payload.quotes) return words.foundByCoherence(String(item.proposal.payload.epic ?? ''));
      return item.approved ? words.foundApproved : words.foundEarlier;
    case 'question': {
      const q = item.question;
      const thread = ctx.threads.find((t) => t.id === q.exploration_id)?.purpose ?? words.itsThread;
      return words.askedByIn(q.raised_by.startsWith('human:'), thread);
    }
    case 'package': {
      const n = item.batch.proposals.length;
      return taskDraftsFeature(item.batch) ? words.taskDraftsReason : words.packageReason(n);
    }
    case 'proposal': {
      const aspect = aspectOfProposal(item.proposal);
      return words.proposalReason(aspect ? words.aspectWord(aspect) : null, item.position, item.batch.proposals.length);
    }
    case 'version': {
      const aspect = aspectOfType(item.version.type);
      return words.versionReason(aspect ? words.aspectWord(aspect) : null, item.version.code, item.version.n);
    }
    case 'link': {
      const to = rowOf(ctx.rows, item.link.to_code);
      const newer = to?.current && to.current > item.link.to_n ? to.current : null;
      return newer ? words.linkNewer(item.link.to_code, newer) : words.linkChanged;
    }
    case 'classification': {
      const c = item.classification;
      return words.classificationReason(Math.round(c.confidence * 100));
    }
    case 'update':
      return words.updateReason;
  }
}

/** When a thing started waiting, when the inbox says it. */
export function needSince(item: NeedItem): string | null {
  if (item.kind === 'conflict' || item.kind === 'proposal' || item.kind === 'package') return item.batch.created;
  if (item.kind === 'update') return item.update.created_at;
  return null;
}

/**
 * The header's count, reconciled with the rows (INVENTORY Part D §1, UX problem): the server counts
 * every proposal of a package, the queue shows a package once. With packages, it says so:
 * "7 things: 1 package of 4 proposals and 3 other things".
 */
export function countSummary(items: readonly NeedItem[], total: number, words: Words = TITLES.en): string {
  const packages = items.filter((i): i is Extract<NeedItem, { kind: 'package' }> => i.kind === 'package');
  const inside = packages.reduce((n, p) => n + p.batch.proposals.length, 0);
  if (packages.length === 0 || total === items.length) return words.thing(total);
  const rest = items.length - packages.length;
  const pkg = packages.length === 1 ? words.packageOne(inside) : words.packageMany(packages.length, inside);
  return rest > 0 ? words.countWithPackage(total, pkg, rest) : words.countPackageOnly(total, pkg);
}

type Axis = { code: string; name: string; categories: { code: string; name: string; description?: string }[] };

/** Categories of the approved taxonomy's axis (a classification is resolved among them). */
export function axisOf(taxonomies: readonly Taxonomy[], axis: string): Axis | null {
  const approved = taxonomies.find((t) => t.state === 'approved');
  const axes = Array.isArray(approved?.axes) ? (approved.axes as Axis[]) : [];
  return axes.find((a) => a.code === axis) ?? null;
}

/** What a command did, in a few words, for the announcement after it ("Answered. 3 left…"). */
export function saidOf(
  call: { command: string; data?: Record<string, unknown> | undefined },
  kind?: NeedItem['kind'],
  words: Words = TITLES.en,
): string {
  const data = call.data ?? {};
  switch (call.command) {
    case 'proposal.accept':
      if (kind === 'conflict') return words.saidThreadOpen;
      return data.approve ? words.saidAcceptedApproved : words.saidAccepted;
    case 'proposal.accept_edited':
      return words.saidYourVersionAccepted;
    case 'proposal.reject':
      return kind === 'conflict' ? words.saidKept : words.saidRejected;
    case 'question.confirm':
      return typeof data.conclusion === 'string' ? words.saidAnswered : words.saidAnswerConfirmed;
    case 'question.postpone':
      return words.saidQuestionParked;
    case 'question.discard':
      return words.saidQuestionDropped;
    case 'question.reopen':
      return words.saidQuestionReopened;
    case 'record_version.approve':
      return words.saidApproved;
    case 'record_version.discard':
      return words.saidDraftDiscarded;
    case 'link.keep':
      return words.saidLinkKept;
    case 'link.change':
      return words.saidLinkChanged;
    case 'link.obsolete':
      return words.saidLinkObsolete;
    case 'classification.resolve':
      return words.saidClassified;
    case 'knowledge_update.retry':
      return words.saidRetrying;
    default:
      return words.saidDone;
  }
}

/** The id of the entity a thing's commands act on. */
export function entityOf(item: NeedItem): string {
  switch (item.kind) {
    case 'conflict':
    case 'proposal':
      return item.proposal.id;
    case 'question':
      return item.question.id;
    case 'package':
      return item.batch.id;
    case 'version':
      return item.version.id;
    case 'link':
      return item.link.id;
    case 'classification':
      return item.classification.id;
    case 'update':
      return item.update.id;
  }
}

/** The aspect of a thing in Needs you, for its tag: a proposal's or an accepted proposal's. */
export function aspectOfNeed(item: NeedItem): Aspect | null {
  if (item.kind === 'proposal' || item.kind === 'conflict') return aspectOfProposal(item.proposal);
  if (item.kind === 'version') return aspectOfType(item.version.type);
  return null;
}
