import { describe, expect, it } from 'vitest';
import type { Inbox, ProductState, RecordDetail, RecordVersion } from '../../src/api/types.ts';
import {
  baseVersion,
  defaultVersion,
  isEarlierDraft,
  newerDraft,
  rowStage,
  selectVersion,
  stageOf,
  versionIndex,
  versionStage,
  waitingCount,
  waitingFor,
  waitingPhrase,
  warningsOf,
} from '../../src/screens/record/logic.ts';

function version(n: number, state: string, current = false): RecordVersion {
  return {
    id: `v${n}`,
    n,
    state,
    epistemic_status: state === 'approved' ? 'confirmed' : 'proposed',
    current,
    title: 'Activity catalog',
    sections: [],
    annexes: [],
    change_note: null,
    origin: null,
    author: 'human:ana',
    approved_by: null,
    created_at: '2026-09-24T10:00:00Z',
    approved_at: null,
    origin_exploration: null,
    inferred_questions: [],
    criteria: [],
    links: [],
    readiness: null,
  };
}

function record(versions: RecordVersion[]): RecordDetail {
  const current = versions.findLast((v) => v.state === 'approved')?.n ?? null;
  return {
    id: 'r',
    code: 'FDR-CAT-001',
    type: 'fdr',
    domain: 'catalog',
    current,
    implementation: 'not implemented',
    versions: versions.map((v) => ({ ...v, current: v.n === current })),
    incoming: [],
  };
}

function at(r: RecordDetail, i: number): RecordVersion {
  const v = r.versions[i];
  if (!v) throw new Error(`no version at ${i}`);
  return v;
}

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

describe('the first bar of a record', () => {
  it('AC-INT-001-08 is full only with a true readiness, rust when an approved version stops being ready, empty otherwise', () => {
    expect(stageOf({ ready: true, reasons: [], warnings: [] }, true)).toBe('ready');
    expect(stageOf({ ready: false, reasons: ['Version 1 is not approved.'], warnings: [] }, false)).toBe('not-ready');
    expect(
      stageOf({ ready: false, reasons: ['It is based on DEC-EVE-001 v1, but the current one is v2.'], warnings: [] }, true),
    ).toBe('doubt');
    expect(stageOf(null, false)).toBe('not-ready');
    expect(rowStage({ readiness: { ready: false, reasons: ['x'], warnings: [] }, current: 2 })).toBe('doubt');
    expect(rowStage({ readiness: { ready: false, reasons: ['x'], warnings: [] }, current: null })).toBe('not-ready');
    // A draft is never "in doubt": it was never ready.
    const r = record([version(1, 'approved'), version(2, 'draft')]);
    expect(versionStage(at(r, 1), { ready: false, reasons: ['x'], warnings: [] })).toBe('not-ready');
    expect(versionStage(at(r, 0), { ready: false, reasons: ['x'], warnings: [] })).toBe('doubt');
  });

  it('AC-INT-001-08 a warning of the readiness belongs to the check it cites, without its code', () => {
    const readiness = {
      ready: false,
      reasons: [],
      warnings: ['AC-CAT-001-04: "fast" is vague; state a measure or a checkable result.', 'AC-CAT-001-01: other.'],
    };
    expect(warningsOf('AC-CAT-001-04', readiness)).toEqual(['"fast" is vague; state a measure or a checkable result.']);
    expect(warningsOf('AC-CAT-001-02', readiness)).toEqual([]);
  });
});

describe('the version on screen', () => {
  it('AC-INT-001-05 shows the current version by default, and a draft older than it can only be discarded', () => {
    const r = record([version(1, 'superseded'), version(2, 'draft'), version(3, 'approved'), version(4, 'draft')]);
    expect(defaultVersion(r)?.n).toBe(3);
    expect(selectVersion(r, 2)?.n).toBe(2);
    expect(selectVersion(r, 9)?.n).toBe(3);
    expect(isEarlierDraft(r, { state: 'draft', n: 2 })).toBe(true);
    expect(isEarlierDraft(r, { state: 'draft', n: 4 })).toBe(false);
    expect(isEarlierDraft(r, { state: 'approved', n: 3 })).toBe(false);
    expect(newerDraft(r, at(r, 2))?.n).toBe(4);
    // Without anything approved, the latest.
    expect(defaultVersion(record([version(1, 'draft'), version(2, 'draft')]))?.n).toBe(2);
  });

  it('AC-INT-001-06 the base of a new version is the last one that was not discarded, as the server takes it', () => {
    const r = record([version(1, 'approved'), version(2, 'draft'), version(3, 'discarded')]);
    expect(baseVersion(r)?.n).toBe(2);
  });
});

describe('what a record touches and what of it waits for the person', () => {
  it('AC-INT-001-04 resolves a version id to its record from the product state and the links under review', () => {
    const state = {
      designs: [
        {
          code: 'FDR-CAT-001',
          type: 'fdr',
          title: 'Activity catalog',
          latest: { n: 2, state: 'draft' },
          latest_id: 'f2',
          current: 1,
          current_id: 'f1',
        },
      ],
      decisions: [
        {
          code: 'DEC-EVE-001',
          type: 'decision',
          title: 'Guests',
          latest: { n: 1, state: 'approved' },
          latest_id: 'd1',
          current: 1,
          current_id: 'd1',
        },
      ],
    } as unknown as ProductState;
    const inbox = emptyInbox();
    inbox.links_under_review.push({
      id: 'l',
      type: 'based_on',
      from_type: 'record_version',
      from_id: 'f1',
      from_version: 1,
      to_type: 'record_version',
      to_id: 'old',
      to_version: 1,
      state: 'needs_review',
      created_by: 'human:ana',
      epistemic_status: 'pending',
      from_code: 'FDR-CAT-001',
      from_n: 1,
      from_title: 'Activity catalog',
      to_code: 'DEC-OLD-001',
      to_n: 1,
      to_title: 'Old decision',
    });
    const index = versionIndex(state, inbox);
    expect(index.get('f2')).toMatchObject({ code: 'FDR-CAT-001', n: 2 });
    expect(index.get('f1')).toMatchObject({ code: 'FDR-CAT-001', n: 1 });
    expect(index.get('d1')).toMatchObject({ code: 'DEC-EVE-001', n: 1 });
    expect(index.get('old')).toMatchObject({ code: 'DEC-OLD-001', n: 1, title: 'Old decision' });
    expect(index.get('unknown')).toBeUndefined();
  });

  it('AC-INT-001-04 counts its drafts, the proposals that depend on it, its links to review and its thread questions', () => {
    const inbox = emptyInbox();
    inbox.versions_to_approve.push({
      id: 'v',
      code: 'FDR-CAT-001',
      type: 'fdr',
      n: 2,
      title: 'x',
      approvable: true,
      epistemic_status: 'proposed',
    });
    inbox.batches.push({
      id: 'b',
      type: 'agent',
      producer: 'agent:claude-code:1',
      resolution: 'item',
      summary: null,
      run_id: null,
      created: '',
      dependencies: [{ type: 'record', id: 'r', code: 'FDR-CAT-001', version: 1 }],
      proposals: [
        {
          id: 'p1',
          type: 'decision',
          payload: {},
          state: 'pending',
          epistemic_status: 'proposed',
          obsolescence: [],
          assessment: null,
          dependencies: [],
        },
        {
          id: 'p2',
          type: 'decision',
          payload: {},
          state: 'pending',
          epistemic_status: 'proposed',
          obsolescence: [],
          assessment: null,
          dependencies: [],
        },
      ],
    });
    inbox.open_questions.push({
      id: 'q',
      exploration_id: 't',
      question: '?',
      state: 'pending',
      raised_by: 'human:ana',
      epistemic_status: 'pending',
    });
    const w = waitingFor('FDR-CAT-001', inbox, 't');
    expect(w).toEqual({ versions: 1, proposals: 2, links: 0, questions: 1 });
    expect(waitingCount(w)).toBe(4);
    expect(waitingPhrase(w)).toBe('Needs you: 1 version to approve, 2 proposals, 1 question in its thread.');
    expect(waitingCount(waitingFor('FDR-OTH-001', inbox, null))).toBe(0);
  });
});
