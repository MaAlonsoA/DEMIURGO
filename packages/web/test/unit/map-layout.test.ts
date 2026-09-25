import { describe, expect, it } from 'vitest';
import type { ProductMap } from '../../src/api/views.ts';
import { connectedTo, lanesOf, relationWord, waitingOn } from '../../src/screens/map/layout.ts';

const row = (code: string, type: 'fdr' | 'adr' | 'decision', domain: string, origin: string | null = null) =>
  ({
    code,
    type,
    domain,
    title: `Title ${code}`,
    current: null,
    latest: { n: 1, state: 'draft' },
    epistemic_status: 'proposed',
    readiness: type === 'decision' ? null : { ready: false, reasons: ['x'], warnings: [] },
    implementation: 'not implemented',
    summary: '',
    checks: 2,
    latest_id: `${code}-v1`,
    current_id: null,
    updated_at: '2026-09-25T10:00:00Z',
    updated_by: 'human:ana',
    origin_exploration: origin,
  }) as ProductMap['records'][number];

const MAP: ProductMap = {
  project: { id: 'p', name: 'Club', state: 'active' },
  areas: ['signups', 'activities', 'members'],
  records: [
    row('FDR-ACT-001', 'fdr', 'activities'),
    row('FDR-SIG-001', 'fdr', 'signups', 't1'),
    row('DEC-SIG-001', 'decision', 'signups'),
    row('ADR-MEM-001', 'adr', 'members'),
    row('DEC-MEM-002', 'decision', 'members'),
  ],
  relations: [
    { from: 'FDR-SIG-001', to: 'FDR-ACT-001', kind: 'needs', link: 'based_on', under_review: false },
    { from: 'FDR-SIG-001', to: 'DEC-SIG-001', kind: 'follows', link: 'based_on', under_review: false },
    { from: 'DEC-MEM-002', to: 'DEC-SIG-001', kind: 'conflicts', link: 'conflicts_with', under_review: true },
  ],
  questions: [
    {
      id: 'q1',
      exploration_id: 't1',
      question: 'A limit on places?',
      state: 'pending',
      impact: 'high',
      conclusion: null,
      affects: ['FDR-SIG-001'],
    },
  ],
  ideas: [{ id: 'i1', purpose: 'Guest passes' }],
};

describe('map layout', () => {
  it('AC-INT-002-01 one lane per area in the order given, features as cards and decisions as rules', () => {
    const lanes = lanesOf(MAP);
    expect(lanes.map((l) => l.area)).toEqual(['signups', 'activities', 'members']);
    expect(lanes[0]).toMatchObject({ features: [{ code: 'FDR-SIG-001' }], rules: [{ code: 'DEC-SIG-001' }] });
    // A tech decision is a rule of its area, like a decision.
    expect(lanes[2]?.rules.map((r) => r.code)).toEqual(['ADR-MEM-001', 'DEC-MEM-002']);
  });

  it('AC-INT-002-03 pointing an element lights up what it is connected to, both ways', () => {
    expect([...connectedTo('FDR-SIG-001', MAP.relations)].toSorted()).toEqual(['DEC-SIG-001', 'FDR-ACT-001', 'FDR-SIG-001']);
    expect([...connectedTo('DEC-SIG-001', MAP.relations)].toSorted()).toEqual(['DEC-MEM-002', 'DEC-SIG-001', 'FDR-SIG-001']);
    expect([...connectedTo('FDR-X', MAP.relations)]).toEqual(['FDR-X']);
  });

  it('AC-INT-002-03 what waits on the person is the open questions of its thread', () => {
    expect(waitingOn('FDR-SIG-001', MAP.questions).map((q) => q.id)).toEqual(['q1']);
    expect(waitingOn('FDR-ACT-001', MAP.questions)).toEqual([]);
  });

  it('AC-INT-002-02 each relation has its word, from either end', () => {
    expect(relationWord('needs', 'from')).toBe('Needs');
    expect(relationWord('needs', 'to')).toBe('Needed by');
    expect(relationWord('follows', 'from')).toBe('Rules it follows');
    expect(relationWord('follows', 'to')).toBe('Followed by');
    expect(relationWord('conflicts', 'to')).toBe('Conflicts with');
    expect(relationWord('affects', 'to')).toBe('Affected by');
  });
});
