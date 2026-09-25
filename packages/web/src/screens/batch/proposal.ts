// What a proposal says about itself, in words (DESIGN.md §3.1.1): its kind label, the one line under
// its title, the "why" in the author's words, what accepting it does, and what happened once it was
// decided. Pure, so Needs you, Catch up and the batch pages say the same thing. The `design_record`
// type gets its own label and body here: the old view showed its raw type name (INVENTORY Part D §3).

import type { BatchDetail, Dependency, IdeaAssessmentSummary } from '../../api/types.ts';
import { whoOf } from '../../words.ts';
import { batchView, proposalTitle } from './model.ts';

/** A proposal as the views show it: the batch's fields plus what the inbox adds to pending ones. */
export type ProposalView = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  state: string;
  dependencies: Dependency[];
  resolution?: Record<string, unknown> | null;
  resolved_at?: string | null;
  /** The server's reasons why accepting would fail now (its dependencies changed). */
  obsolescence?: string[];
  assessment?: IdeaAssessmentSummary | null;
};

/** What kind of change a proposal is, as its header says it. */
export const PROPOSAL_KIND_WORDS: Record<string, string> = {
  decision: 'New decision',
  fdr: 'New feature',
  design_record: 'Design record',
  exploration: 'New thread',
  review: 'Review',
  imported_record: 'Imported document',
  imported_taxonomy: 'Imported taxonomy',
};

export function kindWord(type: string): string {
  return PROPOSAL_KIND_WORDS[type] ?? 'Proposal';
}

/** The record type an accepted proposal makes (or a review is about), for its icon. */
export function proposalIconType(p: Pick<ProposalView, 'type' | 'payload'>): string {
  if (p.type === 'decision' || p.type === 'fdr') return p.type;
  if (p.type === 'exploration') return 'thread';
  if (p.type === 'design_record') return typeof p.payload.record_type === 'string' ? p.payload.record_type : 'decision';
  if (p.type === 'review') return 'knowledge';
  if (p.type === 'imported_record') {
    const doc = p.payload.document as { type?: unknown } | undefined;
    return typeof doc?.type === 'string' ? doc.type : 'package';
  }
  if (p.type === 'imported_taxonomy') return 'taxonomy';
  return 'idea';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export type PayloadSection = { title: string; content: string };

/** The sections a design record carries in its payload. */
export function payloadSections(payload: Record<string, unknown>): PayloadSection[] {
  if (!Array.isArray(payload.sections)) return [];
  return (payload.sections as { title?: unknown; content?: unknown }[])
    .map((s) => ({ title: str(s.title), content: str(s.content) }))
    .filter((s) => s.title || s.content);
}

export type PayloadCheck = { code?: string; title: string; statement: string; verification: string; check: string };

/** The checks (acceptance criteria) a proposal carries, as they came. */
export function payloadChecks(payload: Record<string, unknown>): PayloadCheck[] {
  return Array.isArray(payload.criteria) ? (payload.criteria as PayloadCheck[]) : [];
}

/** The one line under a title in a list: the proposal's main text. */
export function proposalLine(p: Pick<ProposalView, 'type' | 'payload'>): string {
  if (p.type === 'decision') return str(p.payload.decision);
  if (p.type === 'fdr') return str(p.payload.goal);
  if (p.type === 'review') return str(p.payload.reason);
  if (p.type === 'exploration') return str(p.payload.purpose);
  if (p.type === 'design_record') return payloadSections(p.payload)[0]?.content ?? '';
  return '';
}

/** Why, in the author's own words: the context of a decision, the goal of a feature, the reason of a review. */
export function proposalWhy(p: Pick<ProposalView, 'type' | 'payload'>): string {
  if (p.type === 'decision') return str(p.payload.context);
  if (p.type === 'fdr') return str(p.payload.goal);
  if (p.type === 'review') return str(p.payload.reason);
  return '';
}

const NOUN: Record<string, string> = {
  decision: 'the decision',
  fdr: 'the feature',
  design_record: 'the record',
  exploration: 'the thread',
};

/** "the feature “Sign up”, with its 3 checks": what accepting records. */
export function whatItRecords(p: Pick<ProposalView, 'type' | 'payload'>): string {
  const checks = payloadChecks(p.payload).length;
  return `${NOUN[p.type] ?? 'it'} “${proposalTitle(p)}”${checks ? `, with its ${checks} ${checks === 1 ? 'check' : 'checks'}` : ''}`;
}

/**
 * What accepting does, before it happens (INV-PROP-15, 16): a list of sentences. With `approve`,
 * the two things that happen, in order.
 */
export function acceptEffects(p: Pick<ProposalView, 'type' | 'payload'>, approve: boolean): string[] {
  if (p.type === 'review') {
    const r = p.payload.record as { code?: string; version?: number } | undefined;
    return [
      `DEMIURGO opens a thread to review ${r?.code ?? 'the record'} v${r?.version ?? ''}. The record itself doesn't change.`,
    ];
  }
  if (p.type === 'exploration') return [`DEMIURGO opens the thread “${proposalTitle(p)}”.`];
  const what = whatItRecords(p);
  if (!approve) return [`DEMIURGO records ${what} as a draft. You approve it later, on its page.`];
  return [`DEMIURGO records ${what}.`, 'You approve it: it becomes the current version.'];
}

/** What happened to a decided proposal, in one sentence (the state badge says the state). */
export function resolvedText(state: string, effect: { code: string; approved: boolean } | null): string {
  const made = effect ? (effect.approved ? ` ${effect.code} is approved and current.` : ` ${effect.code} is a draft.`) : '';
  if (state === 'accepted') return `You accepted it.${made}`;
  if (state === 'accepted_edited') return `You accepted your version.${made}`;
  if (state === 'rejected') return 'You rejected it.';
  return '';
}

/** The out-of-date sentence of a superseded proposal: the server's reason, then what it means. */
export function outOfDateText(reason: string | null): string {
  return `${reason ?? 'What it was based on changed.'} It can't be accepted any more. Nothing is lost: it stays here as it came.`;
}

/** The heading of a batch by who produced it (INV-BATCH-03). */
export function batchHeading(producer: string, n: number): { eyebrow: string; title: string } {
  const who = whoOf(producer);
  const changes = n === 1 ? 'change' : 'changes';
  if (who.kind === 'agent')
    return { eyebrow: `${n} ${n === 1 ? 'proposal' : 'proposals'} from an agent`, title: `${who.name} proposes ${n} ${changes}` };
  if (who.kind === 'demiurgo')
    return { eyebrow: `${n} ${n === 1 ? 'proposal' : 'proposals'} from DEMIURGO`, title: `DEMIURGO proposes ${n} ${changes}` };
  if (who.kind === 'automatic')
    return {
      eyebrow: `${n} ${n === 1 ? 'review' : 'reviews'} from knowledge`,
      title: `DEMIURGO's knowledge asks you to review ${n === 1 ? 'a record' : `${n} records`}`,
    };
  return { eyebrow: `${n} ${n === 1 ? 'proposal' : 'proposals'}`, title: `${n} ${n === 1 ? 'proposal' : 'proposals'} to decide` };
}

/** The name of a batch page, as its h1 and the browser tab say it. */
export function batchTitle(batch: Pick<BatchDetail, 'kind' | 'resolution_mode' | 'producer' | 'proposals'>): string {
  const view = batchView(batch);
  if (view === 'import') return 'Imported from design/';
  if (view === 'package') {
    const single = batch.proposals.length === 1 ? batch.proposals[0] : undefined;
    return (single ? proposalTitle(single) : '') || 'A package from DEMIURGO';
  }
  return batchHeading(batch.producer, batch.proposals.length).title;
}
