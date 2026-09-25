// Knowledge selection for context packs (observability §9.2): `selectForContext` reports every
// candidate it weighed, with its similarity and why it stayed out, and the chosen ones are the
// same as before the manifest existed.

import { describe, expect, it } from 'vitest';
import { type Graph, type Node, contextNodeCost, selectForContext } from '../src/knowledge.ts';

const node = (ref: string, label: string, text: string, extra: Partial<Node> = {}): Node => ({
  ref,
  type: 'decision',
  label,
  text,
  categories: {},
  epistemic: 'confirmed',
  authority: true,
  origin: { type: 'record_version', id: null, version: 1 },
  from: 1,
  until: null,
  ...extra,
});

const graph = (nodes: Node[]): Graph => ({ version: 3, nodes, edges: [] });

describe('selectForContext with considered', () => {
  it('lists every candidate: chosen, left out by the budget, or below the threshold', () => {
    const g = graph([
      node('DEC-A@1', 'Membership fee', 'Members pay a yearly membership fee.'),
      node('DEC-B@1', 'Membership fee receipt', 'The membership fee is collected with a receipt.'),
      node('DEC-C@1', 'Zoology', 'Giraffes elephants zebras.'),
      node('DEC-D@1', 'Fee reminder', 'A reminder of the membership fee is sent every year.'),
    ]);
    const budget = contextNodeCost(g.nodes[0] as Node) + contextNodeCost(g.nodes[1] as Node) + 5;
    const { chosen, considered } = selectForContext(g, 'How is the membership fee paid?', budget);
    expect(chosen.map((c) => c.node.ref)).toHaveLength(2);
    for (const c of chosen) {
      expect(c.reason).toMatch(/^topic relevance \(\d\.\d\d\)$/);
      expect(c.score).toBeGreaterThan(0);
    }
    expect(considered).toHaveLength(4);
    const byRef = Object.fromEntries(considered.map((c) => [c.node.ref, c]));
    expect(byRef['DEC-C@1']).toMatchObject({ reason: 'below_threshold', score: 0 });
    const outByBudget = considered.filter((c) => c.reason === 'budget');
    expect(outByBudget).toHaveLength(1);
    expect(outByBudget[0]?.score).toBeGreaterThan(0);
    // The scores are the ones the reasons quote, and the candidates come in relevance order.
    for (const c of chosen) expect(c.reason).toContain(c.score.toFixed(2));
    const scores = considered.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('once the budget is full, every later candidate is out by budget even when it would fit', () => {
    const g = graph([
      node('DEC-A@1', 'Membership fee', 'Members pay a yearly membership fee and the fee is due in January.'),
      node('DEC-B@1', 'Fee', 'Membership fee.'),
    ]);
    const budget = contextNodeCost(g.nodes[0] as Node) + 1;
    const { chosen, considered } = selectForContext(g, 'membership fee', budget);
    expect(chosen).toHaveLength(1);
    expect(considered.map((c) => [c.node.ref, c.reason])).toEqual([
      ['DEC-B@1', 'chosen'],
      ['DEC-A@1', 'budget'],
    ]);
  });

  it('ignores what is not confirmed, criteria, and superseded nodes', () => {
    const g = graph([
      node('DEC-A@1', 'Membership fee', 'Members pay a membership fee.', { epistemic: 'proposed' }),
      node('CRI-A@1', 'Membership fee', 'Members pay a membership fee.', { type: 'criterion' }),
      node('DEC-B@1', 'Membership fee', 'Members pay a membership fee.', { until: 2 }),
      node('DEC-C@1', 'Membership fee', 'Members pay a membership fee.'),
    ]);
    const { chosen, considered } = selectForContext(g, 'membership fee', 10_000);
    expect(chosen.map((c) => c.node.ref)).toEqual(['DEC-C@1']);
    expect(considered.map((c) => c.node.ref)).toEqual(['DEC-C@1']);
  });

  it('caps the cost of a node where the pack cuts its text', () => {
    const long = node('DEC-A@1', 'Fee', 'membership '.repeat(200));
    expect(contextNodeCost(long)).toBe(3 + 600);
    const { chosen } = selectForContext(graph([long]), 'membership', 602);
    expect(chosen).toHaveLength(0);
    expect(selectForContext(graph([long]), 'membership', 603).chosen).toHaveLength(1);
  });
});
