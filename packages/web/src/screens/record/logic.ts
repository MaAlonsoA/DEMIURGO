// Pure helpers of records shared by the overview and the record page: the stage of the first
// bar, which version is shown, what waits for the person, and the records a link points to.

import type { Inbox, ProductRow, ProductState, Readiness, RecordDetail, RecordVersion } from '../../api/types.ts';
import type { Stage } from '../../ui/signals.tsx';

/** First bar: full when ready, rust when an approved current version stopped being ready, else empty. */
export function stageOf(readiness: Readiness | null | undefined, approvedCurrent: boolean): Stage {
  if (readiness?.ready) return 'ready';
  return approvedCurrent ? 'doubt' : 'not-ready';
}

export function rowStage(row: Pick<ProductRow, 'readiness' | 'current'>): Stage {
  return stageOf(row.readiness, row.current !== null);
}

export function versionStage(version: RecordVersion, readiness: Readiness | null | undefined): Stage {
  return stageOf(readiness, version.state === 'approved' && version.current);
}

/** The version shown without ?v: the current one, or the latest when nothing is approved. */
export function defaultVersion(record: RecordDetail): RecordVersion | undefined {
  return record.versions.find((v) => v.current) ?? record.versions.at(-1);
}

export function selectVersion(record: RecordDetail, n: number | undefined): RecordVersion | undefined {
  return (n === undefined ? undefined : record.versions.find((v) => v.n === n)) ?? defaultVersion(record);
}

/** A draft older than the current version can only be discarded (FDR-INT-001, behavior 6). */
export function isEarlierDraft(record: Pick<RecordDetail, 'current'>, version: Pick<RecordVersion, 'state' | 'n'>): boolean {
  return version.state === 'draft' && record.current !== null && record.current > version.n;
}

/** The base of a new version, as the server takes it: the last version that was not discarded. */
export function baseVersion(record: RecordDetail): RecordVersion | undefined {
  return record.versions.filter((v) => v.state !== 'discarded').at(-1);
}

/** A newer draft than the version on screen, to point the person at it. */
export function newerDraft(record: RecordDetail, shown: RecordVersion): RecordVersion | undefined {
  return record.versions.filter((v) => v.state === 'draft' && v.n > shown.n && !isEarlierDraft(record, v)).at(-1);
}

export type VersionRef = { code: string; n: number; title: string; type: string };

/**
 * Which record and version a version id is, from what the API gives: the latest and current
 * versions of the product state and the links under review of the inbox. A link to an older
 * version outside those stays unresolved.
 */
export function versionIndex(state: ProductState | undefined, inbox?: Inbox): Map<string, VersionRef> {
  const index = new Map<string, VersionRef>();
  for (const row of [...(state?.designs ?? []), ...(state?.decisions ?? [])]) {
    index.set(row.latest_id, { code: row.code, n: row.latest.n, title: row.title, type: row.type });
    if (row.current_id && row.current !== null && !index.has(row.current_id)) {
      index.set(row.current_id, { code: row.code, n: row.current, title: row.title, type: row.type });
    }
  }
  for (const l of inbox?.links_under_review ?? []) {
    if (!index.has(l.to_id)) index.set(l.to_id, { code: l.to_code, n: l.to_n, title: l.to_title, type: '' });
  }
  return index;
}

export type Waiting = { versions: number; proposals: number; links: number; questions: number };

/** What of this record waits for the person: its drafts, proposals that depend on it, its links to review, its thread's questions. */
export function waitingFor(code: string, inbox: Inbox | undefined, originThread: string | null): Waiting {
  if (!inbox) return { versions: 0, proposals: 0, links: 0, questions: 0 };
  const proposals = inbox.batches.reduce((n, b) => {
    const onBatch = b.dependencies.some((d) => d.code === code);
    return n + b.proposals.filter((p) => onBatch || p.dependencies.some((d) => d.code === code)).length;
  }, 0);
  const questions = originThread
    ? [...inbox.questions_to_confirm, ...inbox.open_questions].filter((q) => q.exploration_id === originThread).length
    : 0;
  return {
    versions: inbox.versions_to_approve.filter((v) => v.code === code).length,
    proposals,
    links: inbox.links_under_review.filter((l) => l.from_code === code).length,
    questions,
  };
}

export function waitingCount(w: Waiting): number {
  return w.versions + w.proposals + w.links + w.questions;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The phrase of the blue count: what exactly waits. */
export function waitingPhrase(w: Waiting): string {
  const parts = [
    w.versions ? plural(w.versions, 'version to approve', 'versions to approve') : '',
    w.proposals ? plural(w.proposals, 'proposal', 'proposals') : '',
    w.links ? plural(w.links, 'link to review', 'links to review') : '',
    w.questions ? plural(w.questions, 'question in its thread', 'questions in its thread') : '',
  ].filter(Boolean);
  return parts.length ? `Needs you: ${parts.join(', ')}.` : '';
}

/** Warnings of the readiness that cite a criterion (its verifiability), without the code prefix. */
export function warningsOf(code: string, readiness: Readiness | null | undefined): string[] {
  return (readiness?.warnings ?? []).filter((w) => w.startsWith(`${code}:`)).map((w) => w.slice(code.length + 1).trim());
}

export const LINK_WORDS: Record<string, string> = {
  based_on: 'Based on',
  design_of: 'Design of',
  covers: 'Covers',
  origin: 'Comes from',
  conflicts_with: 'Conflicts with',
  derived_from: 'Derived from',
};
