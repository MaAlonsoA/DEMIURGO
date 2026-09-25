// The origins tree (spec §4.4), pure: thread → decision → feature or tech decision, from the
// product state, the threads and the links of each record's shown version (based_on and origin).
// It places the nodes left to right, finds the trace of a node and says why it exists.

import type { Exploration, ProductRow, ProductState, RecordDetail, RecordType, RecordVersion } from '../../api/types.ts';
import { TYPE_WORDS, TYPE_WORDS_PLURAL } from '../../words.ts';

export type ThreadNode = {
  key: string;
  kind: 'thread';
  exploration: Exploration;
  parent: Exploration | null;
  /** The record version the thread was opened from, if any. */
  fromRecord: { code: string; n: number } | null;
  phrase: string | null;
};
export type RecordNode = {
  key: string;
  kind: 'record';
  row: ProductRow;
  /** The version the tree shows: the current one, or the latest while none is approved. */
  version: RecordVersion | null;
  phrase: string | null;
};
/** Start of the lane of what does not come from a thread. */
export type StartNode = { key: 'start'; kind: 'start' };
export type OriginNode = ThreadNode | RecordNode | StartNode;

export type EdgeType = 'origin' | 'based_on' | 'link_origin' | 'branch' | 'start';
export type OriginEdge = { key: string; from: string; to: string; type: EdgeType };

export type Box = { x: number; y: number; w: number; h: number };

export type OriginsTree = {
  /** In reading order: each thread with what came from it, then its inner threads, then the rest. */
  nodes: OriginNode[];
  edges: OriginEdge[];
  boxes: Map<string, Box>;
  /** Primary parent of each node (the one the layout and the "why" follow). */
  parents: Map<string, string>;
  width: number;
  height: number;
};

export type Geometry = {
  columns: { x: number; w: number }[];
  /** The node itself, the design system's 44px row: edges meet it at its middle. */
  nodeHeight: number;
  /** The lines under a node: who and when, its code and why it exists. */
  noteHeight: number;
  gap: number;
  laneGap: number;
  width: number;
};

/** Three columns across the given width (the canvas: 1360 px wide at 1440 × 900). */
export function geometryFor(width: number): Geometry {
  const w = Math.max(960, Math.round(width));
  const [a, b, c] = [0.22, 0.235, 0.25].map((f) => Math.round(w * f)) as [number, number, number];
  const gap = Math.floor((w - a - b - c) / 2);
  return {
    columns: [
      { x: 0, w: a },
      { x: a + gap, w: b },
      { x: w - c, w: c },
    ],
    nodeHeight: 44,
    noteHeight: 38,
    gap: 10,
    laneGap: 28,
    width: w,
  };
}

export const GEOMETRY = geometryFor(1360);

export type OriginsInput = { state: ProductState; explorations: readonly Exploration[]; records: readonly RecordDetail[] };

const threadKey = (id: string) => `t:${id}`;
export const recordKey = (code: string) => `r:${code}`;

function shownVersion(detail: RecordDetail | undefined): RecordVersion | null {
  if (!detail) return null;
  return detail.versions.find((v) => v.current) ?? detail.versions.at(-1) ?? null;
}

const columnOf = (n: OriginNode): number => (n.kind === 'record' ? (n.row.type === 'decision' ? 1 : 2) : 0);

const recordOrder = (a: RecordNode, b: RecordNode) =>
  (a.row.type === 'decision' ? 0 : 1) - (b.row.type === 'decision' ? 0 : 1) ||
  a.row.code.localeCompare(b.row.code, 'en', { numeric: true });

export function buildOrigins(input: OriginsInput, g: Geometry = GEOMETRY): OriginsTree {
  const rows = [...input.state.decisions, ...input.state.designs];
  const details = new Map(input.records.map((r) => [r.code, r]));
  const versions = new Map<string, { code: string; n: number }>();
  for (const r of input.records) for (const v of r.versions) versions.set(v.id, { code: r.code, n: v.n });
  const threads = new Map(input.explorations.map((e) => [e.id, e]));

  const nodes = new Map<string, OriginNode>();
  for (const e of input.explorations) {
    const origin = e.origin_type === 'record_version' && e.origin_id ? (versions.get(e.origin_id) ?? null) : null;
    nodes.set(threadKey(e.id), {
      key: threadKey(e.id),
      kind: 'thread',
      exploration: e,
      parent: e.parent_id ? (threads.get(e.parent_id) ?? null) : null,
      fromRecord: origin,
      phrase: e.state === 'concluded' && e.state_reason ? e.state_reason : null,
    });
  }
  for (const row of rows) {
    const version = shownVersion(details.get(row.code));
    nodes.set(recordKey(row.code), {
      key: recordKey(row.code),
      kind: 'record',
      row,
      version,
      phrase: version?.change_note ?? null,
    });
  }

  // Edges: links between records, the thread each record comes from, and threads inside threads.
  const edges: OriginEdge[] = [];
  const incoming = new Map<string, OriginEdge[]>();
  const add = (from: string, to: string, type: EdgeType) => {
    if (from === to || edges.some((e) => e.from === from && e.to === to)) return;
    const edge = { key: `${from}>${to}`, from, to, type };
    edges.push(edge);
    incoming.set(to, [...(incoming.get(to) ?? []), edge]);
  };
  for (const row of rows) {
    for (const l of nodeVersion(nodes.get(recordKey(row.code)))?.links ?? []) {
      if (l.to_type !== 'record_version' || (l.type !== 'based_on' && l.type !== 'origin')) continue;
      const target = versions.get(l.to_id);
      if (target && nodes.has(recordKey(target.code)))
        add(recordKey(target.code), recordKey(row.code), l.type === 'based_on' ? 'based_on' : 'link_origin');
    }
  }
  const parents = new Map<string, string>();
  const byParentOrder = (a: OriginEdge, b: OriginEdge) => {
    const x = nodes.get(a.from);
    const y = nodes.get(b.from);
    return x?.kind === 'record' && y?.kind === 'record' ? recordOrder(x, y) : 0;
  };
  for (const row of rows) {
    const key = recordKey(row.code);
    const fromRecords = (incoming.get(key) ?? []).toSorted(byParentOrder)[0];
    if (fromRecords) parents.set(key, fromRecords.from);
    else if (row.origin_exploration && threads.has(row.origin_exploration)) {
      add(threadKey(row.origin_exploration), key, 'origin');
      parents.set(key, threadKey(row.origin_exploration));
    }
  }
  for (const e of input.explorations) {
    if (e.parent_id && threads.has(e.parent_id)) {
      add(threadKey(e.parent_id), threadKey(e.id), 'branch');
      parents.set(threadKey(e.id), threadKey(e.parent_id));
    }
  }
  const roots = rows.map((r) => recordKey(r.code)).filter((k) => !parents.has(k));
  if (roots.length > 0) {
    nodes.set('start', { key: 'start', kind: 'start' });
    for (const k of roots) {
      const n = nodes.get(k);
      // Only the top of each branch hangs from the start; a feature under an unthreaded decision does not.
      if (n) {
        add('start', k, 'start');
        parents.set(k, 'start');
      }
    }
  }

  // A record whose own phrase is missing carries the conclusion of the thread it comes from.
  for (const n of nodes.values()) {
    if (n.kind !== 'record' || n.phrase) continue;
    for (const a of ancestors(parents, n.key)) {
      const t = nodes.get(a);
      if (t?.kind === 'thread' && t.phrase) {
        n.phrase = t.phrase;
        break;
      }
    }
  }

  // Layout: depth-first; a parent sits level with its first child; threads inside a thread go below.
  const children = new Map<string, string[]>();
  for (const [child, parent] of parents) children.set(parent, [...(children.get(parent) ?? []), child]);
  const boxes = new Map<string, Box>();
  const order: OriginNode[] = [];
  const visited = new Set<string>();
  let y = 0;
  const step = g.nodeHeight + g.noteHeight + g.gap;
  const box = (n: OriginNode, top: number): Box => {
    const c = g.columns[columnOf(n)] ?? { x: 0, w: g.width };
    return { x: c.x, y: top, w: c.w, h: g.nodeHeight };
  };
  const place = (key: string) => {
    const n = nodes.get(key);
    if (!n || visited.has(key)) return;
    visited.add(key);
    order.push(n);
    const kids = (children.get(key) ?? []).map((k) => nodes.get(k)).filter((k): k is OriginNode => k !== undefined);
    const right = kids.filter((k): k is RecordNode => k.kind === 'record' && columnOf(k) > columnOf(n)).sort(recordOrder);
    const below = kids.filter((k) => !right.includes(k as RecordNode));
    if (right.length === 0) {
      boxes.set(key, box(n, y));
      y += step;
    } else {
      boxes.set(key, box(n, y));
      for (const k of right) place(k.key);
    }
    for (const k of below.sort(byCreation)) place(k.key);
  };
  const topThreads = input.explorations.filter((e) => !parents.has(threadKey(e.id))).map((e) => threadKey(e.id));
  for (const k of topThreads) {
    place(k);
    y += g.laneGap;
  }
  if (nodes.has('start')) {
    place('start');
    y += g.laneGap;
  }
  const height = boxes.size > 0 ? y - g.laneGap - g.gap : 0;
  return { nodes: order, edges, boxes, parents, width: g.width, height };

  function byCreation(a: OriginNode, b: OriginNode): number {
    if (a.kind === 'thread' && b.kind === 'thread') return a.exploration.created_at.localeCompare(b.exploration.created_at);
    if (a.kind === 'record' && b.kind === 'record') return recordOrder(a, b);
    return a.kind === 'thread' ? 1 : -1;
  }
}

function nodeVersion(n: OriginNode | undefined): RecordVersion | null {
  return n?.kind === 'record' ? n.version : null;
}

function ancestors(parents: Map<string, string>, key: string): string[] {
  const out: string[] = [];
  let cursor = parents.get(key);
  while (cursor && !out.includes(cursor)) {
    out.push(cursor);
    cursor = parents.get(cursor);
  }
  return out;
}

/** The trace of a node: everything it comes from and everything that comes from it. */
export function traceOf(tree: OriginsTree, key: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([key]);
  const edges = new Set<string>();
  const walk = (direction: 'up' | 'down') => {
    const seen = new Set([key]);
    const queue = [key];
    while (queue.length > 0) {
      const k = queue.shift() ?? '';
      for (const e of tree.edges) {
        if ((direction === 'up' ? e.to : e.from) !== k) continue;
        const other = direction === 'up' ? e.from : e.to;
        edges.add(e.key);
        nodes.add(other);
        if (!seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
  };
  walk('up');
  walk('down');
  return { nodes, edges };
}

/** A curve from the right side of one node to the left side of the next, or a line down a column
    (left of the lines under the nodes it passes). */
export function edgePath(from: Box, to: Box): string {
  if (to.x <= from.x) return `M${from.x + 20} ${from.y + from.h} V${to.y}`;
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const mx = Math.round((x1 + x2) / 2);
  return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
}

export type Segment = { text: string; to?: { kind: 'record'; code: string } | { kind: 'thread'; id: string } };
export type Why = { sentence: Segment[]; phrases: { label: string; text: string }[] };

const quoted = (s: string) => `“${s}”`;
/** The order in which "It led to …" lists what came from a thread. */
const LED_TO_ORDER: RecordType[] = [
  'decision',
  'fdr',
  'adr',
  'bug',
  'requirement',
  'quality_requirement',
  'threat_model',
  'production_readiness',
];

const typeWord = (row: ProductRow) => TYPE_WORDS[row.type].toLowerCase();

function linkTo(n: ThreadNode | RecordNode): Segment {
  return n.kind === 'thread'
    ? { text: quoted(n.exploration.purpose), to: { kind: 'thread', id: n.exploration.id } }
    : { text: quoted(n.row.title), to: { kind: 'record', code: n.row.code } };
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listed(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** "Why does this exist?": the sentence of its trace, and the phrases that say why along it. */
export function whyOf(tree: OriginsTree, key: string): Why {
  const byKey = new Map(tree.nodes.map((n) => [n.key, n]));
  const node = byKey.get(key);
  if (!node || node.kind === 'start') return { sentence: [], phrases: [] };
  const sentence: Segment[] = [linkTo(node)];
  const chain = [key, ...ancestors(tree.parents, key)].map((k) => byKey.get(k)).filter((n): n is OriginNode => !!n);

  if (node.kind === 'thread') {
    sentence.push({ text: ' is a thread' });
    if (node.parent) {
      const parent = byKey.get(threadKey(node.parent.id));
      if (parent?.kind === 'thread') sentence.push({ text: ', branched from ' }, linkTo(parent));
    }
    if (node.fromRecord) sentence.push({ text: `, opened from ${node.fromRecord.code} v${node.fromRecord.n}` });
    const records = tree.nodes.filter((n): n is RecordNode => n.kind === 'record' && descends(tree, n.key, key));
    // Every record type counts, requirements and stage records included (not only the first four).
    const kinds = LED_TO_ORDER.map((t) => ({ t, n: records.filter((r) => r.row.type === t).length }))
      .filter((x) => x.n > 0)
      .map((x) => count(x.n, TYPE_WORDS[x.t].toLowerCase(), TYPE_WORDS_PLURAL[x.t].toLowerCase()));
    sentence.push({ text: kinds.length ? `. It led to ${listed(kinds)}.` : '. Nothing has come from it yet.' });
  } else {
    sentence.push({ text: ` is a ${typeWord(node.row)}` });
    let first = true;
    let threaded = false;
    for (const a of chain.slice(1)) {
      if (a.kind === 'start') break;
      if (a.kind === 'thread') {
        threaded = true;
        sentence.push({ text: first ? ' that came from the thread ' : ', which came from the thread ' }, linkTo(a));
        // What comes after a thread is the thread it branched from.
        const rest = chain.slice(chain.indexOf(a) + 1).filter((n): n is ThreadNode => n.kind === 'thread');
        for (const t of rest) sentence.push({ text: ', branched from ' }, linkTo(t));
        break;
      }
      sentence.push({ text: `${first ? ' that follows' : ', which follows'} the ${typeWord(a.row)} ` }, linkTo(a));
      first = false;
    }
    sentence.push({ text: threaded ? '.' : '. It doesn’t come from a thread.' });
  }

  const phrases: Why['phrases'] = [];
  for (const n of chain) {
    if (n.kind === 'record' && n.version?.change_note)
      phrases.push({ label: `Change note of ${n.row.code} v${n.version.n}`, text: n.version.change_note });
    if (n.kind === 'thread' && n.exploration.state === 'concluded' && n.exploration.state_reason)
      phrases.push({ label: 'The thread concluded', text: n.exploration.state_reason });
  }
  return { sentence: merge(sentence), phrases };
}

/** Is `key` below `ancestor` in the primary tree? */
function descends(tree: OriginsTree, key: string, ancestor: string): boolean {
  return ancestors(tree.parents, key).includes(ancestor);
}

/** Joins consecutive plain texts, so the sentence reads as one. */
function merge(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const last = out.at(-1);
    if (last && !last.to && !s.to) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}
