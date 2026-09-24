import { describe, expect, it } from 'vitest';
import type { Proposal } from '../../src/api/types.ts';
import {
  acceptedRecord,
  batchView,
  changedFields,
  citedRecord,
  countRows,
  documentGroups,
  editedPayload,
  obsoleteReason,
  proposalTitle,
} from '../../src/screens/batch/model.ts';

const counts = { decision: 1, adr: 7, fdr: 5, bug: 0, versions: 13, criteria: 114, links: 12, taxonomies: 1, annexes: 2 };

function proposal(type: string, payload: Record<string, unknown>, extra: Partial<Proposal> = {}): Proposal {
  return {
    id: `${type}-${Math.random()}`,
    batch_id: 'b',
    position: 1,
    type,
    payload,
    dependencies: [],
    state: 'pending',
    resolution: null,
    resolved_by: null,
    resolved_at: null,
    created_at: '2026-09-24T10:00:00Z',
    epistemic_status: 'proposed',
    ...extra,
  };
}

describe('the package page', () => {
  it('AC-INT-001-03 an import shows each kind in design/ next to the package, and a difference is marked', () => {
    const rows = countRows({ origin: counts, package: counts });
    expect(rows.map((r) => [r.kind, r.origin, r.inPackage, r.same])).toEqual([
      ['Records', 13, 13, true],
      ['Versions', 13, 13, true],
      ['Checks', 114, 114, true],
      ['Links', 12, 12, true],
      ['Taxonomies', 1, 1, true],
      ['Annexes', 2, 2, true],
    ]);
    const differ = countRows({ origin: counts, package: { ...counts, criteria: 113 } });
    expect(differ.find((r) => r.kind === 'Checks')?.same).toBe(false);
    expect(countRows({ origin: null, package: counts })[0]?.origin).toBeNull();
  });

  it('AC-INT-001-03 the documents of an import are grouped as Decisions, Tech decisions, Features and Taxonomy', () => {
    const doc = (type: string, code: string) => proposal('imported_record', { document: { type, code, title: code }, path: '' });
    const groups = documentGroups([
      doc('fdr', 'FDR-A-001'),
      doc('decision', 'DEC-A-001'),
      proposal('imported_taxonomy', { document: { code: 'TAX-001', title: 'Taxonomy' }, path: '' }),
      doc('adr', 'ADR-A-001'),
    ]);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ['Decisions', 1],
      ['Tech decisions', 1],
      ['Features', 1],
      ['Taxonomy', 1],
    ]);
  });

  it('AC-INT-001-12 an import and a system package are resolved whole; any other batch item by item', () => {
    expect(batchView({ kind: 'import', resolution_mode: 'package' })).toBe('import');
    expect(batchView({ kind: 'system_package', resolution_mode: 'package' })).toBe('package');
    expect(batchView({ kind: 'agent', resolution_mode: 'item' })).toBe('items');
    expect(batchView({ kind: 'knowledge', resolution_mode: 'item' })).toBe('items');
  });

  it("AC-INT-001-12 Change sends the whole payload with the person's edits, and knows what changed", () => {
    const payload = { title: 'Full says Full', context: 'Why', decision: 'Full', consequences: 'None' };
    expect(changedFields(payload, { title: 'Full says Full ', context: 'Why not' })).toEqual(['context']);
    expect(editedPayload(payload, { title: ' Only full ' })).toEqual({ ...payload, title: 'Only full' });
  });

  it('AC-INT-001-13 an out-of-date proposal carries the reason the server gave', () => {
    const reason = 'The proposal is obsolete: DEC-PRO-001 has changed (current: v2; the proposal was based on v1).';
    expect(obsoleteReason({ state: 'superseded', resolution: { obsolete: reason } })).toBe(reason);
    expect(obsoleteReason({ state: 'pending', resolution: null })).toBeNull();
  });

  it('AC-INT-001-12 an idea check cites a record when the code can be derived from the node', () => {
    expect(citedRecord('DEC-PRO-001@2', [])).toEqual({ code: 'DEC-PRO-001', version: 2 });
    expect(citedRecord('AC-WEB-001-03@1', ['ADR-WEB-001', 'FDR-INT-001'])).toEqual({ code: 'ADR-WEB-001', version: 1 });
    // Two records could own the check: no link is invented.
    expect(citedRecord('AC-WEB-001-03@1', ['ADR-WEB-001', 'FDR-WEB-001'])).toBeNull();
    expect(citedRecord('question:123', [])).toBeNull();
  });

  it('AC-INT-001-12 a proposal is named by its title, its purpose or the record it reviews', () => {
    expect(proposalTitle({ type: 'decision', payload: { title: 'A title' } })).toBe('A title');
    expect(proposalTitle({ type: 'exploration', payload: { purpose: 'Why' } })).toBe('Why');
    expect(proposalTitle({ type: 'review', payload: { record: { code: 'DEC-PRO-001', version: 1 } } })).toBe(
      'Review DEC-PRO-001 v1',
    );
    expect(
      acceptedRecord({ resolution: { effect: { type: 'record', code: 'FDR-PRO-002', version: 1, approved: true } } }),
    ).toEqual({
      code: 'FDR-PRO-002',
      version: 1,
      approved: true,
    });
  });
});
