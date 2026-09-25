// How each thing of Needs you is named and why it is there, in words (DESIGN.md §3.1): its title,
// its kind, the reason line of the queue, and the header's count once packages are reconciled with
// the rows. Pure, so the queue, the detail and Catch up say the same thing.

import type { Exploration, ProductRow, Taxonomy } from '../../api/types.ts';
import { TYPE_WORDS, whoOf } from '../../words.ts';
import { proposalTitle, rowOf, rowOfVersion } from '../batch/model.ts';
import type { NeedItem } from './order.ts';

/** The word of each kind of thing, as the queue and the detail say it. */
export const KIND_WORDS: Record<NeedItem['kind'], string> = {
  conflict: 'Conflict',
  question: 'Question',
  package: 'Package',
  proposal: 'Proposal',
  version: 'Version to approve',
  link: 'Link to review',
  classification: 'Classification',
  update: 'Knowledge update',
};

/** The verdict of a knowledge review, in words (the title of a conflict). */
export const VERDICT_WORDS: Record<string, string> = {
  update: 'may need an update',
  invalidate: 'may no longer hold',
  add: 'may need something added',
  other: 'may be affected',
};

export function packageTitle(item: Extract<NeedItem, { kind: 'package' }>): string {
  if (item.batch.type === 'import') return 'Imported from design/';
  const first = item.batch.proposals[0];
  return (first ? proposalTitle(first) : '') || 'A package';
}

export function conflictTitle(item: Extract<NeedItem, { kind: 'conflict' }>, rows: readonly ProductRow[]): string {
  const r = item.proposal.payload.record as { code?: string } | undefined;
  const name = rowOf(rows, r?.code ?? '')?.title ?? r?.code ?? 'A record';
  return `${name} ${VERDICT_WORDS[String(item.proposal.payload.verdict)] ?? 'may be affected'}`;
}

/** The record a knowledge node ref (CODE@n) names, by its title when the product has it. */
export function nodeName(ref: string, rows: readonly ProductRow[]): string {
  const code = ref.split('@')[0] ?? ref;
  return rowOf(rows, code)?.title ?? code;
}

export function updateTitle(item: Extract<NeedItem, { kind: 'update' }>, rows: readonly ProductRow[]): string {
  const t = item.update.trigger as { type?: string; id?: string } | null;
  const row = t?.id ? rowOfVersion(rows, t.id) : undefined;
  if (row) return `Knowledge couldn't take in ${row.title}`;
  if (t?.type === 'proposal') return "Knowledge couldn't take in an accepted proposal";
  return "Knowledge couldn't take in a change";
}

/** A thing's title, as the queue, the detail and Catch up name it. */
export function needTitle(item: NeedItem, rows: readonly ProductRow[]): string {
  switch (item.kind) {
    case 'conflict':
      return conflictTitle(item, rows);
    case 'question':
      return item.question.question;
    case 'package':
      return packageTitle(item);
    case 'proposal':
      return proposalTitle(item.proposal) || 'A proposal';
    case 'version':
      return item.version.title;
    case 'link':
      return `${item.link.from_title} is based on ${item.link.to_title}`;
    case 'classification':
      return nodeName(item.classification.node_ref, rows);
    case 'update':
      return updateTitle(item, rows);
  }
}

export type ReasonContext = { rows: readonly ProductRow[]; threads: readonly Pick<Exploration, 'id' | 'purpose'>[] };

/** The name of who produced a batch, in a few words. */
export function producerWords(producer: string): string {
  const who = whoOf(producer);
  if (who.kind === 'agent') return `Agent · ${who.name}`;
  if (who.kind === 'automatic') return "DEMIURGO's knowledge";
  return who.name;
}

/** Why a thing is in Needs you, in one line of the queue ("Asked by DEMIURGO in Global quality"). */
export function needReason(item: NeedItem, ctx: ReasonContext): string {
  switch (item.kind) {
    case 'conflict':
      return item.approved ? 'Found by knowledge · with something you approved' : 'Found by knowledge · with an earlier version';
    case 'question': {
      const q = item.question;
      const thread = ctx.threads.find((t) => t.id === q.exploration_id)?.purpose ?? 'its thread';
      return `${q.raised_by.startsWith('human:') ? 'Asked by you' : 'Asked by DEMIURGO'} in ${thread}`;
    }
    case 'package': {
      const n = item.batch.proposals.length;
      return `From ${producerWords(item.batch.producer)} · ${n} ${n === 1 ? 'proposal' : 'proposals'}, decided whole`;
    }
    case 'proposal':
      return `From ${producerWords(item.batch.producer)} · ${item.position} of ${item.batch.proposals.length} in its batch`;
    case 'version':
      return `${TYPE_WORDS[item.version.type] ?? 'Record'} · ${item.version.code} v${item.version.n}`;
    case 'link': {
      const to = rowOf(ctx.rows, item.link.to_code);
      const newer = to?.current && to.current > item.link.to_n ? to.current : null;
      return newer ? `${item.link.to_code} now has v${newer}` : 'The version it points to changed';
    }
    case 'classification': {
      const c = item.classification;
      return `DEMIURGO is ${Math.round(c.confidence * 100)}% sure of where it goes`;
    }
    case 'update':
      return 'Until it is taken in, the knowledge is behind';
  }
}

/** When a thing started waiting, when the inbox says it. */
export function needSince(item: NeedItem): string | null {
  if (item.kind === 'conflict' || item.kind === 'proposal' || item.kind === 'package') return item.batch.created;
  if (item.kind === 'update') return item.update.created_at;
  return null;
}

const things = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'}`;

/**
 * The header's count, reconciled with the rows (INVENTORY Part D §1, UX problem): the server counts
 * every proposal of a package, the queue shows a package once. With packages, it says so:
 * "7 things: 1 package of 4 proposals and 3 other things".
 */
export function countSummary(items: readonly NeedItem[], total: number): string {
  const packages = items.filter((i): i is Extract<NeedItem, { kind: 'package' }> => i.kind === 'package');
  const inside = packages.reduce((n, p) => n + p.batch.proposals.length, 0);
  if (packages.length === 0 || total === items.length) return things(total);
  const rest = items.length - packages.length;
  const pkg =
    packages.length === 1
      ? `1 package of ${inside} ${inside === 1 ? 'proposal' : 'proposals'}`
      : `${packages.length} packages with ${inside} proposals`;
  return rest > 0 ? `${things(total)}: ${pkg} and ${rest} other ${rest === 1 ? 'thing' : 'things'}` : `${things(total)}: ${pkg}`;
}

type Axis = { code: string; name: string; categories: { code: string; name: string; description?: string }[] };

/** Categories of the approved taxonomy's axis (a classification is resolved among them). */
export function axisOf(taxonomies: readonly Taxonomy[], axis: string): Axis | null {
  const approved = taxonomies.find((t) => t.state === 'approved');
  const axes = Array.isArray(approved?.axes) ? (approved.axes as Axis[]) : [];
  return axes.find((a) => a.code === axis) ?? null;
}

/** What a command did, in a few words, for the announcement after it ("Answered. 3 left…"). */
export function saidOf(call: { command: string; data?: Record<string, unknown> | undefined }, kind?: NeedItem['kind']): string {
  const data = call.data ?? {};
  switch (call.command) {
    case 'proposal.accept':
      if (kind === 'conflict') return 'A thread to review it is open.';
      return data.approve ? 'Accepted and approved.' : 'Accepted.';
    case 'proposal.accept_edited':
      return 'Your version is accepted.';
    case 'proposal.reject':
      return kind === 'conflict' ? 'Kept as it is.' : 'Rejected.';
    case 'question.confirm':
      return typeof data.conclusion === 'string' ? 'Answered.' : 'Answer confirmed.';
    case 'question.postpone':
      return 'Question parked.';
    case 'question.discard':
      return 'Question dropped.';
    case 'question.reopen':
      return 'Question reopened.';
    case 'record_version.approve':
      return 'Approved.';
    case 'record_version.discard':
      return 'Draft discarded.';
    case 'link.keep':
      return 'Link kept.';
    case 'link.change':
      return 'Link marked as changed.';
    case 'link.obsolete':
      return 'Link marked out of date.';
    case 'classification.resolve':
      return 'Classified.';
    case 'knowledge_update.retry':
      return 'Retrying the update.';
    default:
      return 'Done.';
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
