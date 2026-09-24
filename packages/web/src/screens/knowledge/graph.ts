// Pure logic of the knowledge page: the graph grouped by taxonomy area, the relations of a node
// in words, the verdicts of the idea checks and the freshness of the knowledge.

import type { GraphNode, Knowledge, KnowledgeGraph, ProductRow, Taxonomy } from '../../api/types.ts';
import type { IconKind } from '../../ui/icons.tsx';
import { type Axis, parseAxes } from './taxonomy.ts';

/** Node types of the graph: the record types and their criteria (checks). */
export const NODE_TYPES: Record<string, { word: string; plural: string; icon: IconKind; order: number }> = {
  decision: { word: 'Decision', plural: 'Decisions', icon: 'decision', order: 0 },
  adr: { word: 'Tech decision', plural: 'Tech decisions', icon: 'tech', order: 1 },
  fdr: { word: 'Feature', plural: 'Features', icon: 'feature', order: 2 },
  bug: { word: 'Bug', plural: 'Bugs', icon: 'bug', order: 3 },
  criterion: { word: 'Check', plural: 'Checks', icon: 'check', order: 4 },
};

export function nodeType(type: string): { word: string; plural: string; icon: IconKind; order: number } {
  return NODE_TYPES[type] ?? { word: type, plural: type, icon: 'knowledge', order: 9 };
}

/** Relations of the graph in both directions: from the node (out) and towards it (in). */
const EDGE_WORDS: Record<string, { out: string; in: string }> = {
  contains: { out: 'Contains', in: 'Part of' },
  based_on: { out: 'Based on', in: 'Basis of' },
  related: { out: 'Related to', in: 'Related to' },
  design_of: { out: 'Design of', in: 'Designed in' },
  covers: { out: 'Covers', in: 'Covered by' },
  origin: { out: 'Comes from', in: 'Origin of' },
  conflicts_with: { out: 'Conflicts with', in: 'Conflicts with' },
  derived_from: { out: 'Derived from', in: 'Source of' },
};

export type Relation = { key: string; word: string; type: string; ref: string; node: GraphNode | undefined };

export function relationsOf(graph: KnowledgeGraph, ref: string): Relation[] {
  const byRef = new Map(graph.nodes.map((n) => [n.ref, n]));
  const out: Relation[] = [];
  graph.edges.forEach((e, i) => {
    const words = EDGE_WORDS[e.type] ?? { out: e.type, in: e.type };
    if (e.from === ref) out.push({ key: `${i}o`, word: words.out, type: e.type, ref: e.to, node: byRef.get(e.to) });
    else if (e.to === ref) out.push({ key: `${i}i`, word: words.in, type: e.type, ref: e.from, node: byRef.get(e.from) });
  });
  return out;
}

const containment = (word: string) => (word === 'Contains' || word === 'Part of' ? 1 : 0);

/** Relations grouped by their word: what the node rests on first, its checks last. */
export function groupRelations(relations: readonly Relation[]): { word: string; relations: Relation[] }[] {
  const groups = new Map<string, Relation[]>();
  for (const r of relations) groups.set(r.word, [...(groups.get(r.word) ?? []), r]);
  return [...groups.entries()]
    .map(([word, list]) => ({ word, relations: list }))
    .sort((a, b) => containment(a.word) - containment(b.word));
}

/** The axis the graph is grouped by: the first axis of the current approved taxonomy. */
export type AreaAxis = Axis & { taxonomy: { code: string; version: number; title: string } };

export function areaAxis(taxonomies: readonly Taxonomy[]): AreaAxis | null {
  const approved = taxonomies.filter((t) => t.state === 'approved').sort((a, b) => b.version - a.version)[0];
  const first = approved ? parseAxes(approved.axes)[0] : undefined;
  if (!approved || !first) return null;
  return { ...first, taxonomy: { code: approved.code, version: approved.version, title: approved.title } };
}

export type AreaGroup = { key: string; name: string; description: string | null; nodes: GraphNode[] };

export const UNCLASSIFIED = 'Not classified yet';

const byTypeThenRef = (a: GraphNode, b: GraphNode) =>
  nodeType(a.type).order - nodeType(b.type).order || a.ref.localeCompare(b.ref, 'en', { numeric: true });

/** Nodes grouped by the category of the area axis, in the taxonomy's order; unclassified last. */
export function groupByArea(nodes: readonly GraphNode[], axis: AreaAxis | null): AreaGroup[] {
  const groups = new Map<string, GraphNode[]>();
  const rest: GraphNode[] = [];
  for (const n of nodes) {
    const category = axis ? n.areas[axis.code] : undefined;
    if (!axis || !category) {
      rest.push(n);
      continue;
    }
    groups.set(category, [...(groups.get(category) ?? []), n]);
  }
  const result: AreaGroup[] = [];
  for (const c of axis?.categories ?? []) {
    const list = groups.get(c.code);
    if (list) result.push({ key: c.code, name: c.name, description: c.description, nodes: list.sort(byTypeThenRef) });
    groups.delete(c.code);
  }
  // A category of an older version of the taxonomy: shown by its code.
  for (const [code, list] of groups) result.push({ key: code, name: code, description: null, nodes: list.sort(byTypeThenRef) });
  if (rest.length) result.push({ key: '', name: UNCLASSIFIED, description: null, nodes: rest.sort(byTypeThenRef) });
  return result;
}

/** Code and version of the record behind a reference ("FDR-DIS-001@2"); a check goes to its record. */
export function recordOfRef(ref: string, graph: KnowledgeGraph | undefined): { code: string; version: number } | null {
  const fromGraph = graph?.nodes.find((n) => n.ref === ref)?.record;
  if (fromGraph) return fromGraph;
  const m = /^((?:DEC|FDR|ADR|BUG)-[A-Z]{3}-\d{3})@(\d+)$/.exec(ref);
  return m?.[1] ? { code: m[1], version: Number(m[2]) } : null;
}

/** Verdict of a finding of an idea check (IDEA_FINDINGS of the classifier), in words. */
export function verdictWord(verdict: string): { word: string; symbol: string; conflict: boolean } {
  switch (verdict) {
    case 'duplicates':
      return { word: 'Duplicates', symbol: '=', conflict: false };
    case 'conflicts':
      return { word: 'Contradicts', symbol: '≠', conflict: true };
    case 'inconsistent':
      return { word: 'Inconsistent with', symbol: '≠', conflict: true };
    case 'relates':
      return { word: 'Relates to', symbol: '~', conflict: false };
    default:
      return { word: verdict, symbol: '·', conflict: false };
  }
}

export type Freshness = 'current' | 'updating' | 'behind';

/** Ink when up to date, amber while updating, rust when an update failed (spec §3). */
export function freshnessOf(k: Knowledge): Freshness {
  if (k.updates.some((u) => u.state === 'rejected')) return 'behind';
  return k.updates_in_progress > 0 || !k.up_to_date ? 'updating' : 'current';
}

type Trigger = { type?: unknown; id?: unknown; version?: unknown } | null | undefined;

/** What set an update off: an approval, an accepted proposal or a discarded draft. */
export function describeTrigger(
  trigger: unknown,
  rows: readonly Pick<ProductRow, 'code' | 'latest_id' | 'current_id' | 'latest'>[],
) {
  const t = (typeof trigger === 'object' ? trigger : null) as Trigger;
  const id = typeof t?.id === 'string' ? t.id : '';
  const row = rows.find((r) => r.latest_id === id || r.current_id === id);
  const n = typeof t?.version === 'number' ? t.version : row?.latest.n;
  const named = row ? `${row.code}${n ? ` v${n}` : ''}` : null;
  switch (t?.type) {
    case 'record_version':
      return named ? `Approval of ${named}` : 'Approval of a version';
    case 'record_version_discard':
      return named ? `Discard of ${named}` : 'Discard of a draft';
    case 'proposal':
      return 'An accepted proposal';
    default:
      return 'A change';
  }
}
