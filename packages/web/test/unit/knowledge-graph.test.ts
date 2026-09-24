import { describe, expect, it } from 'vitest';
import type { GraphNode, Knowledge, KnowledgeGraph, ProductRow, Taxonomy } from '../../src/api/types.ts';
import {
  areaAxis,
  describeTrigger,
  freshnessOf,
  groupByArea,
  groupRelations,
  recordOfRef,
  relationsOf,
  verdictWord,
} from '../../src/screens/knowledge/graph.ts';

const axes = [
  {
    code: 'area',
    name: 'Área del producto',
    categories: [
      { code: 'diseno', name: 'Diseño', description: 'Decisiones, FDR, ADR.' },
      { code: 'conocimiento', name: 'Conocimiento', description: 'Grafo derivado.' },
      { code: 'other', name: 'Otra', description: 'Ninguna encaja.' },
    ],
  },
  { code: 'calidad', name: 'Atributo de calidad', categories: [{ code: 'other', name: 'Otra', description: 'x' }] },
];

function taxonomy(state: string, version = 1): Taxonomy {
  return {
    id: `t${version}`,
    code: 'TAX-001',
    version,
    title: 'Taxonomía inicial',
    axes,
    sections: [],
    state,
    author: 'human:ana',
    created_at: '2026-09-24T10:00:00Z',
    approved_at: null,
    approved_by: null,
  };
}

function node(ref: string, type: string, areas: Record<string, string> = {}, state: GraphNode['state'] = 'current'): GraphNode {
  const [code = '', n = '1'] = ref.split('@');
  return {
    ref,
    type,
    label: `Label of ${ref}`,
    excerpt: '',
    epistemic_status: 'proposed',
    areas,
    state,
    record: { code: type === 'criterion' ? 'FDR-DIS-001' : code, version: Number(n) },
  };
}

function k(over: Partial<Knowledge>): Knowledge {
  return {
    graph_version: 4,
    up_to_date: true,
    updates_in_progress: 0,
    fingerprint: 'f',
    current_nodes: 1,
    current_edges: 0,
    updates: [],
    ...over,
  };
}

describe('the knowledge graph as the UI shows it', () => {
  it('AC-INT-001-17 groups the nodes by the first axis of the approved taxonomy, with the unclassified ones last', () => {
    const graph: KnowledgeGraph = {
      graph_version: 3,
      nodes: [
        node('AC-DIS-001-01@1', 'criterion', { area: 'diseno' }),
        node('FDR-DIS-001@1', 'fdr', { area: 'diseno', calidad: 'other' }),
        node('DEC-PLN-001@1', 'decision'),
        node('ADR-CON-001@1', 'adr', { area: 'conocimiento' }),
      ],
      edges: [],
    };
    const axis = areaAxis([taxonomy('draft', 2), taxonomy('approved', 1)]);
    expect(axis?.code).toBe('area');
    expect(axis?.taxonomy).toMatchObject({ code: 'TAX-001', version: 1 });
    const groups = groupByArea(graph.nodes, axis);
    expect(groups.map((g) => [g.name, g.nodes.map((n) => n.ref)])).toEqual([
      ['Diseño', ['FDR-DIS-001@1', 'AC-DIS-001-01@1']],
      ['Conocimiento', ['ADR-CON-001@1']],
      ['Not classified yet', ['DEC-PLN-001@1']],
    ]);
  });

  it('AC-INT-001-17 without an approved taxonomy every node is not classified yet', () => {
    expect(areaAxis([taxonomy('draft')])).toBeNull();
    const groups = groupByArea([node('DEC-PLN-001@1', 'decision', { area: 'diseno' })], null);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe('Not classified yet');
  });

  it('AC-INT-001-17 a node lists its relations both ways, in words, with the other node', () => {
    const graph: KnowledgeGraph = {
      graph_version: 3,
      nodes: [node('FDR-DIS-001@1', 'fdr'), node('AC-DIS-001-01@1', 'criterion'), node('DEC-PLN-001@1', 'decision')],
      edges: [
        { type: 'contains', from: 'FDR-DIS-001@1', to: 'AC-DIS-001-01@1', state: 'current' },
        { type: 'based_on', from: 'FDR-DIS-001@1', to: 'DEC-PLN-001@1', state: 'current' },
      ],
    };
    const fdr = relationsOf(graph, 'FDR-DIS-001@1');
    expect(fdr.map((r) => [r.word, r.node?.ref])).toEqual([
      ['Contains', 'AC-DIS-001-01@1'],
      ['Based on', 'DEC-PLN-001@1'],
    ]);
    expect(relationsOf(graph, 'AC-DIS-001-01@1').map((r) => r.word)).toEqual(['Part of']);
    expect(relationsOf(graph, 'DEC-PLN-001@1').map((r) => r.word)).toEqual(['Basis of']);
  });

  it('AC-INT-001-17 the peek groups the relations by kind, with what a node rests on before what it contains', () => {
    const checks = Array.from({ length: 12 }, (_, i) => node(`AC-DIS-001-${String(i + 1).padStart(2, '0')}@1`, 'criterion'));
    const graph: KnowledgeGraph = {
      graph_version: 3,
      nodes: [node('FDR-DIS-001@1', 'fdr'), node('DEC-PLN-001@1', 'decision'), ...checks],
      edges: [
        ...checks.map((c) => ({ type: 'contains', from: 'FDR-DIS-001@1', to: c.ref, state: 'current' })),
        { type: 'based_on', from: 'FDR-DIS-001@1', to: 'DEC-PLN-001@1', state: 'current' },
      ],
    };
    const groups = groupRelations(relationsOf(graph, 'FDR-DIS-001@1'));
    expect(groups.map((g) => [g.word, g.relations.length])).toEqual([
      ['Based on', 1],
      ['Contains', 12],
    ]);
  });

  it('AC-INT-001-17 each finding of an idea check has its verdict in words, and a contradiction is a conflict', () => {
    expect(verdictWord('duplicates')).toMatchObject({ word: 'Duplicates', conflict: false });
    expect(verdictWord('conflicts')).toMatchObject({ word: 'Contradicts', conflict: true });
    expect(verdictWord('relates')).toMatchObject({ word: 'Relates to', conflict: false });
    expect(verdictWord('inconsistent').conflict).toBe(true);
    expect(verdictWord('something-else').word).toBe('something-else');
  });

  it('AC-INT-001-17 a reference names its record and version, and a check goes to its record through the graph', () => {
    const graph: KnowledgeGraph = { graph_version: 1, nodes: [node('AC-DIS-001-01@1', 'criterion')], edges: [] };
    expect(recordOfRef('FDR-DIS-001@2', graph)).toEqual({ code: 'FDR-DIS-001', version: 2 });
    expect(recordOfRef('AC-DIS-001-01@1', graph)).toEqual({ code: 'FDR-DIS-001', version: 1 });
    expect(recordOfRef('AC-XYZ-001-01@1', undefined)).toBeNull();
  });

  it('AC-INT-001-17 the freshness is current, updating or behind, as in the header', () => {
    expect(freshnessOf(k({}))).toBe('current');
    expect(freshnessOf(k({ up_to_date: false, updates_in_progress: 2 }))).toBe('updating');
    const rejected = {
      id: 'u',
      state: 'rejected',
      trigger: {},
      failure: 'x',
      graph_version_before: null,
      graph_version_after: null,
      created_at: '',
    };
    expect(freshnessOf(k({ updates: [rejected] }))).toBe('behind');
  });

  it('AC-INT-001-17 an update says what triggered it, naming the record when the product knows the version', () => {
    const rows = [{ code: 'FDR-DIS-001', latest_id: 'v1', current_id: null, latest: { n: 1, state: 'draft' } }] as ProductRow[];
    expect(describeTrigger({ type: 'record_version', id: 'v1', version: 1 }, rows)).toBe('Approval of FDR-DIS-001 v1');
    expect(describeTrigger({ type: 'record_version', id: 'other', version: 3 }, rows)).toBe('Approval of a version');
    expect(describeTrigger({ type: 'proposal', id: 'p', version: null }, rows)).toBe('An accepted proposal');
    expect(describeTrigger({ type: 'record_version_discard', id: 'v1', version: 1 }, rows)).toBe('Discard of FDR-DIS-001 v1');
    expect(describeTrigger(null, rows)).toBe('A change');
  });
});
