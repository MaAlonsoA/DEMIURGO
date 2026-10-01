import { describe, expect, it } from 'vitest';
import type { Inbox, SuspectRecord } from '../../src/api/types.ts';
import { groupsOf, needsOf } from '../../src/screens/needs-you/order.ts';
import { needReason, needTitle, saidOf } from '../../src/screens/needs-you/titles.ts';

const suspect: SuspectRecord = {
  link_id: 'l1',
  link_type: 'based_on',
  from_code: 'SCR-PRO-012',
  from_type: 'screen_design',
  from_n: 1,
  from_title: 'Weekly screens',
  from_version_id: 'v1',
  upstream_title: 'Weekly plan',
  suspect: { upstream: 'FDR-PRO-011', from: 1, to: 2 },
};

const inbox = {
  total: 1,
  batches: [],
  questions_to_confirm: [],
  open_questions: [],
  versions_to_approve: [],
  links_under_review: [],
  suspect_records: [suspect],
  classifications_to_review: [],
  rejected_updates: [],
} as unknown as Inbox;

describe('records to review after a change (suspect links)', () => {
  it('are their own group of Needs you, one thing per suspect link', () => {
    const items = needsOf(inbox, []);
    expect(items).toMatchObject([{ kind: 'suspect', key: 'suspect:l1' }]);
    expect(groupsOf(items).map((g) => [g.key, g.title])).toEqual([['suspects', 'To review after a change']]);
  });
  it('say what changed and what a click did', () => {
    const [item] = needsOf(inbox, []);
    expect(needTitle(item!, [])).toBe('Weekly screens may be out of date');
    expect(needReason(item!, { rows: [], threads: [] })).toBe('FDR-PRO-011 changed: v1 to v2');
    expect(saidOf({ command: 'link.revalidate' }, 'suspect')).toBe('Marked as still valid.');
  });
});
