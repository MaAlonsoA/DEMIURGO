import { describe, expect, it } from 'vitest';
import type { Inbox, ProductRow, ProductState } from '../../src/api/types.ts';
import { featureStatus, railOf } from '../../src/screens/blueprint/rail.ts';

const emptyInbox = (): Inbox => ({
  total: 0,
  batches: [],
  questions_to_confirm: [],
  open_questions: [],
  versions_to_approve: [],
  links_under_review: [],
  classifications_to_review: [],
  rejected_updates: [],
});

function row(code: string, over: Partial<ProductRow> = {}): ProductRow {
  const type = code.startsWith('DEC') ? 'decision' : code.startsWith('ADR') ? 'adr' : code.startsWith('BUG') ? 'bug' : 'fdr';
  return {
    code,
    type,
    domain: 'catalog',
    title: `Title of ${code}`,
    current: null,
    latest: { n: 1, state: 'draft' },
    epistemic_status: 'proposed',
    readiness: type === 'decision' ? null : { ready: false, reasons: ['Version 1 is not approved.'], warnings: [] },
    implementation: 'not implemented',
    summary: '',
    checks: 0,
    latest_id: `${code}-1`,
    current_id: null,
    updated_at: '2026-09-24T10:00:00Z',
    updated_by: 'human:ana',
    origin_exploration: null,
    ...over,
  };
}

function state(rows: ProductRow[], explorations: ProductState['explorations'] = []): ProductState {
  return {
    project: { id: 'p', name: 'Club Activities', state: 'active' },
    decisions: rows.filter((r) => r.type === 'decision'),
    designs: rows.filter((r) => r.type !== 'decision'),
    ready_to_build: rows.filter((r) => r.readiness?.ready).map((r) => r.code),
    explorations,
    inbox: { total: 0 },
  };
}

const ready = { ready: true, reasons: [], warnings: [] };
const blocked = { ready: false, reasons: ['The link with DEC-EVE-001 is pending review.'], warnings: [] };

describe('the status of a feature in the blueprint rail', () => {
  it('AC-INT-001-04 says Needs you with its count first, then Ready to build, In doubt, Draft or Not ready', () => {
    const none = { versions: 0, proposals: 0, links: 0, questions: 0 };
    expect(featureStatus(row('FDR-CAT-001'), { ...none, versions: 1, questions: 2 })).toEqual({
      kind: 'needs',
      word: 'Needs you',
      count: 3,
      detail: 'Needs you: 1 version to approve, 2 questions in its thread.',
    });
    // Even a feature ready to build says it needs the person when something of it waits.
    expect(featureStatus(row('FDR-CAT-001', { current: 1, readiness: ready }), { ...none, questions: 1 }).kind).toBe('needs');
    expect(featureStatus(row('FDR-CAT-001', { current: 1, readiness: ready }), none)).toEqual({
      kind: 'ready',
      word: 'Ready to build',
    });
    expect(featureStatus(row('FDR-CAT-001', { current: 1, readiness: blocked }), none)).toEqual({
      kind: 'doubt',
      word: 'In doubt',
    });
    expect(featureStatus(row('FDR-CAT-001'), none)).toEqual({ kind: 'draft', word: 'Draft' });
    expect(featureStatus(row('FDR-CAT-001', { latest: { n: 1, state: 'discarded' } }), none)).toEqual({
      kind: 'not-ready',
      word: 'Not ready',
    });
  });
});

describe('the blueprint rail', () => {
  it('AC-INT-001-04 groups features, decisions and tech decisions with their marks, marks the one on screen and lists the parked threads', () => {
    const inbox = emptyInbox();
    inbox.versions_to_approve.push({
      id: 'v',
      code: 'FDR-SIG-001',
      type: 'fdr',
      n: 1,
      title: 'Sign up',
      approvable: true,
      epistemic_status: 'proposed',
    });
    const s = state(
      [
        row('FDR-CAT-001', { current: 1, readiness: ready, epistemic_status: 'confirmed', latest: { n: 1, state: 'approved' } }),
        row('FDR-SIG-001'),
        row('DEC-EVE-001', { current: 1, epistemic_status: 'confirmed', latest: { n: 1, state: 'approved' } }),
        row('DEC-EVE-002'),
        row('ADR-STK-001'),
        row('BUG-CAT-001'),
      ],
      [
        {
          id: 't1',
          purpose: 'Guest passes',
          state: 'set_aside',
          parent_id: null,
          origin_type: null,
          origin_id: null,
          open_questions: 0,
        },
        {
          id: 't2',
          purpose: 'Sign-ups',
          state: 'active',
          parent_id: null,
          origin_type: null,
          origin_id: null,
          open_questions: 1,
        },
      ],
    );
    const rail = railOf(s, inbox, 'FDR-SIG-001');
    expect(rail.project).toBe('Club Activities');
    expect(rail.features.map((f) => [f.code, f.status.kind, f.current])).toEqual([
      ['FDR-CAT-001', 'ready', false],
      ['FDR-SIG-001', 'needs', true],
    ]);
    expect(rail.decisions.map((d) => [d.code, d.mark, d.current])).toEqual([
      ['DEC-EVE-001', 'confirmed', false],
      ['DEC-EVE-002', 'proposed', false],
    ]);
    expect(rail.tech.map((d) => [d.code, d.mark])).toEqual([['ADR-STK-001', 'proposed']]);
    expect(rail.parked).toEqual([{ id: 't1', purpose: 'Guest passes' }]);
    // A decision on screen is the one highlighted.
    expect(railOf(s, inbox, 'DEC-EVE-002').decisions.find((d) => d.current)?.code).toBe('DEC-EVE-002');
  });

  it('AC-INT-001-04 without the product state it is empty, and without the inbox nothing is counted', () => {
    expect(railOf(undefined, undefined, 'FDR-CAT-001')).toEqual({
      project: '',
      features: [],
      decisions: [],
      tech: [],
      parked: [],
    });
    const rail = railOf(state([row('FDR-SIG-001')]), undefined, 'FDR-SIG-001');
    expect(rail.features[0]?.status.kind).toBe('draft');
  });
});
