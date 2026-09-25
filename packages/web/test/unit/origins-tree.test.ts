import { describe, expect, it } from 'vitest';
import type {
  Exploration,
  Link,
  ProductRow,
  ProductState,
  RecordDetail,
  RecordType,
  RecordVersion,
} from '../../src/api/types.ts';
import { GEOMETRY, buildOrigins, edgePath, traceOf, whyOf } from '../../src/screens/origins/tree.ts';

const at = '2026-09-24T10:00:00Z';

function thread(id: string, purpose: string, over: Partial<Exploration> = {}): Exploration {
  return {
    id,
    project_id: 'p',
    parent_id: null,
    purpose,
    origin_type: null,
    origin_id: null,
    origin_version: null,
    state: 'active',
    state_reason: null,
    opened_by: 'human:ana',
    created_at: at,
    open_questions: 0,
    last_activity: at,
    ...over,
  };
}

function link(from: string, to: string, type = 'based_on'): Link {
  return {
    id: `${from}-${to}`,
    type,
    from_type: 'record_version',
    from_id: from,
    from_version: 1,
    to_type: 'record_version',
    to_id: to,
    to_version: 1,
    state: 'current',
    created_by: 'human:ana',
    created_at: at,
  };
}

type Spec = {
  code: string;
  type: RecordType;
  title: string;
  thread?: string;
  versions: { id: string; n: number; state: string; links?: Link[]; change_note?: string }[];
};

function record(s: Spec): { row: ProductRow; detail: RecordDetail } {
  const approved = s.versions.filter((v) => v.state === 'approved').at(-1);
  const latest = s.versions.at(-1);
  if (!latest) throw new Error('no versions');
  const versions: RecordVersion[] = s.versions.map((v) => ({
    id: v.id,
    n: v.n,
    state: v.state,
    epistemic_status: v.state === 'approved' ? 'confirmed' : 'proposed',
    current: v.id === approved?.id,
    title: s.title,
    sections: [],
    annexes: [],
    change_note: v.change_note ?? null,
    origin: null,
    author: 'human:ana',
    approved_by: v.state === 'approved' ? 'human:ana' : null,
    created_at: at,
    approved_at: null,
    origin_exploration: s.thread ?? null,
    inferred_questions: [],
    criteria: [],
    links: v.links ?? [],
    readiness: null,
  }));
  const row: ProductRow = {
    code: s.code,
    type: s.type,
    domain: 'x',
    title: s.title,
    current: approved?.n ?? null,
    latest: { n: latest.n, state: latest.state },
    epistemic_status: approved ? 'confirmed' : 'proposed',
    readiness: null,
    implementation: 'not implemented',
    summary: '',
    checks: 0,
    latest_id: latest.id,
    current_id: approved?.id ?? null,
    updated_at: at,
    updated_by: 'human:ana',
    origin_exploration: s.thread ?? null,
  };
  return {
    row,
    detail: {
      id: `rec-${s.code}`,
      code: s.code,
      type: s.type,
      domain: 'x',
      current: row.current,
      implementation: '',
      versions,
      incoming: [],
    },
  };
}

function input(specs: Spec[], threads: Exploration[]) {
  const built = specs.map(record);
  const rows = built.map((b) => b.row);
  const state: ProductState = {
    project: { id: 'p', name: 'P', state: 'active' },
    decisions: rows.filter((r) => r.type === 'decision'),
    designs: rows.filter((r) => r.type !== 'decision'),
    ready_to_build: [],
    explorations: [],
    inbox: { total: 0 },
  };
  return { state, explorations: threads, records: built.map((b) => b.detail) };
}

// A thread that concluded in a decision, which a feature follows; and an imported decision whose
// old version a tech decision is based on, outside any thread.
const signUps = thread('t1', 'Sign-ups for club activities', { state: 'concluded', state_reason: 'Signing up is instant.' });
const guests = thread('t2', 'Guest passes', { parent_id: 't1' });
const specs: Spec[] = [
  {
    code: 'DEC-SIG-001',
    type: 'decision',
    title: 'Signing up is instant',
    thread: 't1',
    versions: [{ id: 'dec1', n: 1, state: 'approved' }],
  },
  {
    code: 'FDR-SIG-001',
    type: 'fdr',
    title: 'Sign up for an activity',
    thread: 't1',
    versions: [{ id: 'fdr1', n: 1, state: 'draft', links: [link('fdr1', 'dec1')], change_note: 'Drafted from the decision.' }],
  },
  {
    code: 'DEC-PLN-001',
    type: 'decision',
    title: 'Reimplementar DEMIURGO como v2',
    versions: [
      { id: 'pln1', n: 1, state: 'superseded' },
      { id: 'pln2', n: 2, state: 'approved' },
    ],
  },
  {
    code: 'ADR-STK-001',
    type: 'adr',
    title: 'Stack de la v2',
    versions: [{ id: 'stk1', n: 1, state: 'draft', links: [link('stk1', 'pln1')] }],
  },
];

describe('the origins tree', () => {
  it('AC-INT-001-04 goes from a thread to its decision and from the decision to the feature based on it', () => {
    const tree = buildOrigins(input(specs, [signUps, guests]));
    expect(tree.edges.map((e) => `${e.from} ${e.type} ${e.to}`).sort()).toEqual([
      'r:DEC-PLN-001 based_on r:ADR-STK-001',
      'r:DEC-SIG-001 based_on r:FDR-SIG-001',
      'start start r:DEC-PLN-001',
      't:t1 branch t:t2',
      't:t1 origin r:DEC-SIG-001',
    ]);
    // Each record keeps its mark (its epistemic status) and the version it shows.
    const fdr = tree.nodes.find((n) => n.key === 'r:FDR-SIG-001');
    expect(fdr?.kind === 'record' && [fdr.row.epistemic_status, fdr.version?.n]).toEqual(['proposed', 1]);
    const pln = tree.nodes.find((n) => n.key === 'r:DEC-PLN-001');
    expect(pln?.kind === 'record' && [pln.row.epistemic_status, pln.version?.n]).toEqual(['confirmed', 2]);
  });

  it('AC-INT-001-04 reads in order: each thread with what came from it, its inner threads, then what has no thread', () => {
    const tree = buildOrigins(input(specs, [signUps, guests]));
    expect(tree.nodes.map((n) => n.key)).toEqual([
      't:t1',
      'r:DEC-SIG-001',
      'r:FDR-SIG-001',
      't:t2',
      'start',
      'r:DEC-PLN-001',
      'r:ADR-STK-001',
    ]);
  });

  it('AC-INT-001-04 lays nodes out left to right by kind, each parent level with its first child, without overlaps', () => {
    const tree = buildOrigins(input(specs, [signUps, guests]));
    const box = (k: string) => {
      const b = tree.boxes.get(k);
      if (!b) throw new Error(k);
      return b;
    };
    expect([box('t:t1').x, box('r:DEC-SIG-001').x, box('r:FDR-SIG-001').x]).toEqual(GEOMETRY.columns.map((c) => c.x));
    expect(box('t:t1').y).toBe(box('r:DEC-SIG-001').y);
    expect(box('r:DEC-SIG-001').y).toBe(box('r:FDR-SIG-001').y);
    expect(box('t:t2').y).toBeGreaterThan(box('t:t1').y);
    expect(box('start').y).toBeGreaterThan(box('t:t2').y);
    const columns = new Map<number, number[]>();
    for (const b of tree.boxes.values()) columns.set(b.x, [...(columns.get(b.x) ?? []), b.y]);
    for (const ys of columns.values()) {
      const sorted = ys.toSorted((a, b) => a - b);
      sorted.slice(1).forEach((y, i) => expect(y - (sorted[i] ?? 0)).toBeGreaterThanOrEqual(GEOMETRY.nodeHeight));
    }
    expect(tree.height).toBeGreaterThan(box('r:ADR-STK-001').y);
  });

  it('AC-INT-001-04 pointing at a feature lights its whole trace and nothing else', () => {
    const tree = buildOrigins(input(specs, [signUps, guests]));
    const trace = traceOf(tree, 'r:FDR-SIG-001');
    expect([...trace.nodes].sort()).toEqual(['r:DEC-SIG-001', 'r:FDR-SIG-001', 't:t1']);
    expect(trace.edges.size).toBe(2);
    // A decision lights what it comes from and what follows it.
    expect([...traceOf(tree, 'r:DEC-PLN-001').nodes].sort()).toEqual(['r:ADR-STK-001', 'r:DEC-PLN-001', 'start']);
  });

  it('AC-INT-001-04 says why a feature exists: the decision it follows, the thread, its conclusion and its change note', () => {
    const tree = buildOrigins(input(specs, [signUps, guests]));
    const why = whyOf(tree, 'r:FDR-SIG-001');
    const text = why.sentence.map((s) => s.text).join('');
    expect(text).toBe(
      '“Sign up for an activity” is a feature that follows the decision “Signing up is instant”, which came from the thread “Sign-ups for club activities”.',
    );
    expect(why.sentence.filter((s) => s.to).map((s) => s.to)).toEqual([
      { kind: 'record', code: 'FDR-SIG-001' },
      { kind: 'record', code: 'DEC-SIG-001' },
      { kind: 'thread', id: 't1' },
    ]);
    expect(why.phrases).toEqual([
      { label: 'Change note of FDR-SIG-001 v1', text: 'Drafted from the decision.' },
      { label: 'The thread concluded', text: 'Signing up is instant.' },
    ]);
    // The node carries its own phrase; a record without a change note carries its thread's conclusion.
    const dec = tree.nodes.find((n) => n.key === 'r:DEC-SIG-001');
    expect(dec?.kind === 'record' && dec.phrase).toBe('Signing up is instant.');
  });

  it('AC-INT-001-04 without a thread it says so, and a thread says where it branched from and what it led to', () => {
    const tree = buildOrigins(input(specs, [signUps, guests]));
    expect(
      whyOf(tree, 'r:ADR-STK-001')
        .sentence.map((s) => s.text)
        .join(''),
    ).toBe(
      '“Stack de la v2” is a tech decision that follows the decision “Reimplementar DEMIURGO como v2”. It doesn’t come from a thread.',
    );
    expect(
      whyOf(tree, 't:t2')
        .sentence.map((s) => s.text)
        .join(''),
    ).toBe('“Guest passes” is a thread, branched from “Sign-ups for club activities”. Nothing has come from it yet.');
    expect(
      whyOf(tree, 't:t1')
        .sentence.map((s) => s.text)
        .join(''),
    ).toBe('“Sign-ups for club activities” is a thread. It led to 1 decision and 1 feature.');
  });

  it('AC-INT-001-04 without records or threads there is nothing to draw', () => {
    const tree = buildOrigins(input([], []));
    expect(tree.nodes).toEqual([]);
    expect(tree.height).toBe(0);
  });

  it('AC-INT-001-04 an edge between columns is a curve from the right side to the left side', () => {
    const from = { x: 0, y: 0, w: 300, h: 80 };
    const to = { x: 500, y: 92, w: 320, h: 80 };
    expect(edgePath(from, to)).toBe('M300 40 C400 40 400 132 500 132');
    // Within a column (a thread inside a thread): a straight line down the left side.
    expect(edgePath(from, { x: 0, y: 200, w: 300, h: 80 })).toBe('M20 80 V200');
  });
});
