import { describe, expect, it } from 'vitest';
import type { IssueView } from '../../src/api/types.ts';
import { codeOf, commentsPersonFirst, countByState, filterIssues, versionOf } from '../../src/screens/issues/logic.ts';
import { ISSUES } from '../../src/screens/issues/words.i18n.ts';
import { needsOf } from '../../src/screens/needs-you/order.ts';
import { needReason, needTitle } from '../../src/screens/needs-you/titles.ts';

const issue = (code: string, state: IssueView['state']): IssueView => ({
  id: code,
  code,
  kind: 'bug',
  title: code,
  body: '',
  state,
  task: null,
  feature: null,
  criterion_code: null,
  build_request_id: null,
  attempt: null,
  pr_number: null,
  pr_url: null,
  review: null,
  resolution: null,
  close_reason: null,
  opened_by: 'human:a',
  opened_at: '2026-10-01T00:00:00Z',
  resolved_by: null,
  resolved_at: null,
  closed_by: null,
  closed_at: null,
});

describe('issues list', () => {
  const all = [issue('ISS-003', 'open'), issue('ISS-002', 'resolved'), issue('ISS-001', 'closed'), issue('ISS-004', 'open')];
  it('filters by state and keeps the server order', () => {
    expect(filterIssues(all, 'open').map((i) => i.code)).toEqual(['ISS-003', 'ISS-004']);
    expect(filterIssues(all, 'resolved').map((i) => i.code)).toEqual(['ISS-002']);
    expect(filterIssues(all, 'all')).toHaveLength(4);
  });
  it('counts by state', () => {
    expect(countByState(all)).toEqual({ open: 2, resolved: 1, closed: 1, all: 4 });
  });
  it('has the kind words in both languages', () => {
    expect(ISSUES.en.kind_review_escalation).toBe('Review escalation');
    expect(ISSUES.es.kind_review_escalation).toBe('Escalada de revisión');
  });
});

describe('issue forms', () => {
  it('puts the comments only a person can resolve first', () => {
    const c = (path: string, needs?: boolean) => ({ path, line: null, severity: 'fix', body: '', ...(needs ? { needs_person: true } : {}) });
    expect(commentsPersonFirst([c('a'), c('b', true), c('c'), c('d', true)]).map((x) => x.path)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('normalises codes and versions', () => {
    expect(codeOf('  tsk-001 ')).toBe('TSK-001');
    expect(codeOf('  ')).toBeUndefined();
    expect(versionOf('')).toBeUndefined();
    expect(versionOf('2')).toBe(2);
    expect(versionOf('0')).toBeNull();
    expect(versionOf('1.5')).toBeNull();
  });
});

describe('Needs you', () => {
  it('lists open issues as needs', () => {
    const inbox = {
      total: 0,
      batches: [],
      questions_to_confirm: [],
      open_questions: [],
      versions_to_approve: [],
      links_under_review: [],
      classifications_to_review: [],
      rejected_updates: [],
      open_issues: [{ code: 'ISS-001', kind: 'review_escalation' as const, title: 'Scope', task_code: 'TSK-1', opened_at: '2026-10-01T00:00:00Z' }],
    };
    const [n] = needsOf(inbox, []);
    expect(n?.kind).toBe('issue');
    expect(n && needTitle(n, [])).toBe('Scope');
    expect(n && needReason(n, { rows: [], threads: [] })).toContain('TSK-1');
  });
});
