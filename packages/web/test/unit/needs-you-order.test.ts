import { describe, expect, it } from 'vitest';
import type { Inbox, InboxBatch, InboxProposal, ProductRow, Readiness } from '../../src/api/types.ts';
import { catchUpOrder, groupsOf, minutesOf, needsOf } from '../../src/screens/needs-you/order.ts';

const THREAD = 'thread-1';

function row(code: string, reasons: string[], extra: Partial<ProductRow> = {}): ProductRow {
  const readiness: Readiness = { ready: reasons.length === 0, reasons, warnings: [] };
  return {
    code,
    type: code.startsWith('DEC') ? 'decision' : 'fdr',
    domain: 'producto',
    title: `Title of ${code}`,
    current: null,
    latest: { n: 1, state: 'draft' },
    epistemic_status: 'proposed',
    readiness: code.startsWith('DEC') ? null : readiness,
    implementation: 'not implemented',
    summary: '',
    checks: 0,
    latest_id: `${code}-v1`,
    current_id: null,
    updated_at: '2026-09-24T10:00:00Z',
    updated_by: 'human:ana',
    origin_exploration: null,
    ...extra,
  };
}

function proposal(
  id: string,
  type: string,
  payload: Record<string, unknown>,
  dependencies: InboxProposal['dependencies'] = [],
): InboxProposal {
  return { id, type, payload, state: 'pending', epistemic_status: 'proposed', obsolescence: [], assessment: null, dependencies };
}

function batch(
  id: string,
  type: string,
  resolution: string,
  proposals: InboxProposal[],
  producer = 'agent:claude-code:s1',
): InboxBatch {
  return {
    id,
    type,
    producer,
    resolution,
    summary: null,
    run_id: null,
    created: '2026-09-24T10:00:00Z',
    dependencies: [],
    proposals,
  };
}

const dep = (code: string, version = 1) => ({ type: 'record', id: `${code}-id`, code, version });

function inbox(): Inbox {
  return {
    total: 11,
    batches: [
      batch('agent', 'agent', 'item', [proposal('p1', 'decision', { title: 'Guests see the catalog' }, [dep('FDR-PRO-003')])]),
      batch('pkg', 'system_package', 'package', [proposal('p2', 'fdr', { title: 'Design: sign up' })], 'agent:run:r1'),
      batch(
        'kn',
        'knowledge',
        'item',
        [
          proposal('r-old', 'review', { record: { code: 'DEC-PRO-002', version: 1 }, verdict: 'update', reason: 'Same topic.' }),
          proposal('r-approved', 'review', {
            record: { code: 'DEC-PRO-001', version: 1 },
            verdict: 'update',
            reason: 'Same topic.',
          }),
        ],
        'system:knowledge@1',
      ),
    ],
    questions_to_confirm: [
      {
        id: 'q-assumed',
        exploration_id: THREAD,
        question: 'Who signs up?',
        state: 'inferred',
        conclusion: 'Members.',
        raised_by: 'system:exploration@1',
        epistemic_status: 'proposed',
      },
    ],
    open_questions: [
      {
        id: 'q-elsewhere',
        exploration_id: 'thread-2',
        question: 'Colors?',
        state: 'pending',
        raised_by: 'human:ana',
        epistemic_status: 'pending',
      },
      {
        id: 'q-open',
        exploration_id: THREAD,
        question: 'Can guests sign up?',
        state: 'pending',
        raised_by: 'human:ana',
        epistemic_status: 'pending',
      },
    ],
    versions_to_approve: [
      { id: 'v1', code: 'FDR-PRO-003', type: 'fdr', n: 1, title: 'Sign up', approvable: true, epistemic_status: 'proposed' },
      { id: 'v2', code: 'DEC-PRO-004', type: 'decision', n: 1, title: 'Places', approvable: true, epistemic_status: 'proposed' },
    ],
    links_under_review: [
      {
        id: 'l1',
        type: 'based_on',
        from_type: 'record_version',
        from_id: 'x',
        from_version: 1,
        to_type: 'record_version',
        to_id: 'y',
        to_version: 1,
        state: 'needs_review',
        created_by: 'human:ana',
        epistemic_status: 'pending',
        from_code: 'FDR-PRO-005',
        from_n: 1,
        from_title: 'Waiting list',
        to_code: 'DEC-PRO-001',
        to_n: 1,
        to_title: 'Members sign up',
      },
    ],
    classifications_to_review: [
      {
        id: 'c1',
        node_ref: 'DEC-PRO-001@1',
        axis: 'area',
        category: 'other',
        confidence: 0.5,
        justification: 'No category fits.',
        classifier: 'simulated@1',
        epistemic_status: 'pending',
      },
    ],
    rejected_updates: [
      {
        id: 'u1',
        trigger: { type: 'record_version', id: 'x', version: 1 },
        failure: 'Could not classify.',
        created_at: '2026-09-24T10:00:00Z',
        epistemic_status: 'pending',
      },
    ],
  };
}

const rows: ProductRow[] = [
  row('DEC-PRO-001', [], { current: 1 }),
  row('DEC-PRO-002', [], { current: 2 }),
  row('DEC-PRO-004', []),
  row(
    'FDR-PRO-003',
    [
      'Version 1 is not approved.',
      'The decision it is based on, DEC-PRO-004, is not approved.',
      'There are 1 pending question(s) in the origin exploration.',
      'There are 1 pending proposal(s) affecting it.',
    ],
    { origin_exploration: THREAD },
  ),
  row('FDR-PRO-005', [
    'It is based on DEC-PRO-001 v1, but the current one is v2.',
    'The link with DEC-PRO-001 is pending review.',
  ]),
];

describe('Needs you and Catch up', () => {
  it('AC-INT-001-16 Catch up goes in the defined order: conflicts with something approved, blocking questions, proposals, versions, links and classifications, the rest', () => {
    const order = catchUpOrder(needsOf(inbox(), rows)).map((n) => n.key);
    expect(order).toEqual([
      'conflict:r-approved',
      'question:q-open',
      'conflict:r-old',
      'proposal:p1',
      'package:pkg',
      'version:v1',
      'version:v2',
      'link:l1',
      'classification:c1',
      'question:q-assumed',
      'question:q-elsewhere',
      'update:u1',
    ]);
  });

  it('AC-INT-001-16 each thing says what it unblocks, from the readiness reasons the server gives', () => {
    const byKey = new Map(needsOf(inbox(), rows).map((n) => [n.key, n.unblocks]));
    expect(byKey.get('question:q-open')).toEqual(['FDR-PRO-003']);
    expect(byKey.get('question:q-elsewhere')).toEqual([]);
    expect(byKey.get('question:q-assumed')).toEqual([]);
    expect(byKey.get('version:v1')).toEqual(['FDR-PRO-003']);
    expect(byKey.get('version:v2')).toEqual(['FDR-PRO-003']);
    expect(byKey.get('link:l1')).toEqual(['FDR-PRO-005']);
    expect(byKey.get('proposal:p1')).toEqual(['FDR-PRO-003']);
    expect(byKey.get('classification:c1')).toEqual([]);
  });

  it('AC-INT-001-11 the list keeps its groups in order, with blocking questions first and a package as one row', () => {
    const groups = groupsOf(needsOf(inbox(), rows));
    expect(groups.map((g) => [g.title, g.items.map((i) => i.key)])).toEqual([
      ['Conflicts', ['conflict:r-old', 'conflict:r-approved']],
      ['Questions', ['question:q-open', 'question:q-assumed', 'question:q-elsewhere']],
      ['Proposals', ['proposal:p1', 'package:pkg']],
      ['Versions to approve', ['version:v1', 'version:v2']],
      ['Links to review', ['link:l1']],
      ['Classifications to review', ['classification:c1']],
      ['Knowledge updates that failed', ['update:u1']],
    ]);
    expect(groupsOf([])).toEqual([]);
  });

  it('AC-INT-001-16 the time left is a sum of small estimates per thing', () => {
    const items = needsOf(inbox(), rows);
    expect(minutesOf(items)).toBeGreaterThanOrEqual(items.length);
    expect(minutesOf([])).toBe(0);
  });
});
