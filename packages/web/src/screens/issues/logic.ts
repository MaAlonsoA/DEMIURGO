// Pure logic of the issues screens: the filters of the list and what an escalation shows first.

import type { IssueReviewComment, IssueState, IssueView } from '../../api/types.ts';

export type IssueFilter = IssueState | 'all';
export const FILTERS: IssueFilter[] = ['open', 'resolved', 'closed', 'all'];

export function filterIssues(issues: readonly IssueView[], filter: IssueFilter): IssueView[] {
  return filter === 'all' ? [...issues] : issues.filter((i) => i.state === filter);
}

export function countByState(issues: readonly IssueView[]): Record<IssueFilter, number> {
  return {
    open: issues.filter((i) => i.state === 'open').length,
    resolved: issues.filter((i) => i.state === 'resolved').length,
    closed: issues.filter((i) => i.state === 'closed').length,
    all: issues.length,
  };
}

/** The review comments of an escalation, the ones only the person can resolve first (stable otherwise). */
export function commentsPersonFirst(comments: readonly IssueReviewComment[]): IssueReviewComment[] {
  return [...comments].sort((a, b) => Number(!!b.needs_person) - Number(!!a.needs_person));
}

/** A task code typed in a form: trimmed and upper-cased, or undefined when empty. */
export function codeOf(text: string): string | undefined {
  const t = text.trim().toUpperCase();
  return t === '' ? undefined : t;
}

/** The version typed in the resolve form: a positive integer, undefined when empty, null when invalid. */
export function versionOf(text: string): number | undefined | null {
  const t = text.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : null;
}
