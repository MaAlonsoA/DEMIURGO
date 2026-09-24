// Knowledge engine (§7 of the plan), pure part. The graph is a projection of authority:
// incremental update and rebuild use exactly these functions, so
// rebuilding with the saved classifications gives the same fingerprint (I10).

import { type EpistemicStatus } from './records.ts';
import { fingerprint } from './fingerprint.ts';
import { similarity } from './text.ts';
import {
  type ChoiceResponse,
  type Thresholds,
  DEFAULT_THRESHOLDS,
  VERDICTS,
  type Verdict,
  routeByConfidence,
} from './classifier.ts';

export type NodeOrigin = { type: string; id: string | null; version: number | null };

/** Derived node. `ref` is stable and carries the version of what it represents (e.g. DEC-PRO-001@2). */
export type Node = {
  ref: string;
  type: string;
  label: string;
  text: string;
  categories: Readonly<Record<string, string>>;
  epistemic: EpistemicStatus;
  /** If it comes from something with authority (a record or a criterion), it's never changed without the person. */
  authority: boolean;
  origin: NodeOrigin;
  from: number;
  until: number | null;
};

export type Edge = { type: string; from: string; to: string; validFrom: number; validTo: number | null };

export type Graph = { version: number; nodes: Node[]; edges: Edge[] };

export const emptyGraph = (): Graph => ({ version: 0, nodes: [], edges: [] });

export const currentNodes = (g: Graph): Node[] => g.nodes.filter((n) => n.until === null);
export const currentEdges = (g: Graph): Edge[] => g.edges.filter((a) => a.validTo === null);

/** Authority change projected deterministically (without the classifier). */
export type Change = {
  /** Main node of the change (the one classified and compared against the candidates). */
  main: Omit<Node, 'from' | 'until' | 'categories'>;
  /** Nodes that accompany the main one (e.g. its criteria). */
  companions: Omit<Node, 'from' | 'until' | 'categories'>[];
  /** New edges from the structure (contains, authority links). */
  edges: { type: string; from: string; to: string }[];
  /** Refs that version precedence leaves superseded (decided by code, not the model). */
  supersedes: string[];
};

export type Candidate = { ref: string; type: string; label: string; text: string; reason: string };

const MAX_CANDIDATES = 12;

/**
 * Deterministic candidate preselection (§7.3 step 2): the record's graph neighbors,
 * text matches and nodes with the same categories. Bounded and ordered.
 */
export function selectCandidates(g: Graph, change: Change, categories: Readonly<Record<string, string>>): Candidate[] {
  // Excluded: the change itself, what it supersedes (decided by precedence) and what it links to
  // (that relationship was already declared by the person in the authority).
  const own = new Set([
    change.main.ref,
    ...change.companions.map((n) => n.ref),
    ...change.supersedes,
    ...change.edges.map((a) => a.to),
  ]);
  const current = currentNodes(g).filter((n) => !own.has(n.ref) && n.type !== 'criterion');
  const byRef = new Map(current.map((n) => [n.ref, n]));
  const chosen = new Map<string, { node: Node; reason: string; weight: number }>();
  const add = (n: Node | undefined, reason: string, weight: number) => {
    if (!n) return;
    const existing = chosen.get(n.ref);
    if (!existing || existing.weight < weight) chosen.set(n.ref, { node: n, reason, weight });
  };
  // Neighbors at distance 1 of what the change supersedes or links to.
  const seeds = new Set([...change.supersedes, ...change.edges.map((a) => a.to)]);
  for (const a of currentEdges(g)) {
    if (seeds.has(a.from)) add(byRef.get(a.to), `neighbor of ${a.from} (${a.type})`, 3);
    if (seeds.has(a.to)) add(byRef.get(a.from), `neighbor of ${a.to} (${a.type})`, 3);
  }
  const text = `${change.main.label}. ${change.main.text}`;
  for (const n of current) {
    const sim = similarity(text, `${n.label}. ${n.text}`);
    if (sim >= 0.08) add(n, `text match (${sim.toFixed(2)})`, 1 + sim);
    const common = Object.entries(categories).filter(([axis, c]) => c !== 'other' && n.categories[axis] === c);
    if (common.length > 0) add(n, `same category (${common.map(([e, c]) => `${e}=${c}`).join(', ')})`, 2 + common.length / 10);
  }
  return [...chosen.values()]
    .sort((a, b) => b.weight - a.weight || (a.node.ref < b.node.ref ? -1 : 1))
    .slice(0, MAX_CANDIDATES)
    .map(({ node, reason }) => ({
      ref: node.ref,
      type: node.type,
      label: node.label,
      text: node.text.slice(0, 1500),
      reason,
    }));
}

export function hashVerdictsInput(classifier: string, change: Change, candidates: readonly Candidate[]): string {
  return fingerprint({
    classifier,
    change: { ref: change.main.ref, label: change.main.label, text: change.main.text },
    candidates: candidates.map((c) => ({ ref: c.ref, label: c.label, text: c.text })),
  });
}

export function hashCategoriesInput(classifier: string, taxonomy: string, change: Change): string {
  return fingerprint({
    classifier,
    taxonomy,
    ref: change.main.ref,
    label: change.main.label,
    text: change.main.text,
  });
}

/**
 * Category verification (§7.4): the taxonomy is a closed set. Each response
 * names a taxonomy axis and a category of that axis, one per axis and with valid confidence.
 */
export function verifyCategories(
  axes: readonly { code: string; categories: readonly { code: string }[] }[],
  responses: readonly ChoiceResponse[],
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const byAxis = new Map(axes.map((e) => [e.code, new Set(e.categories.map((c) => c.code))]));
  const seen = new Map<string, number>();
  for (const r of responses) {
    seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
    const categories = byAxis.get(r.id);
    if (!categories) reasons.push(`The classification cites an axis that is not in the taxonomy: ${r.id}.`);
    else if (!categories.has(r.choice)) reasons.push(`"${r.choice}" is not a category of axis ${r.id}.`);
    if (!(r.confidence >= 0 && r.confidence <= 1)) reasons.push(`Confidence out of range for axis ${r.id}.`);
  }
  for (const [axis, n] of seen) if (n > 1) reasons.push(`Axis ${axis} has ${n} classifications.`);
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** Deterministic verification (§7.3 step 4): one verdict per candidate and all references exist. */
export function verifyVerdicts(
  g: Graph,
  candidates: readonly Candidate[],
  responses: readonly ChoiceResponse[],
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const expected = new Set(candidates.map((c) => c.ref));
  const existing = new Set(currentNodes(g).map((n) => n.ref));
  const seen = new Map<string, number>();
  for (const r of responses) {
    seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
    if (!existing.has(r.id)) reasons.push(`The verdict cites a node that does not exist: ${r.id}.`);
    else if (!expected.has(r.id)) reasons.push(`The verdict cites a node that was not a candidate: ${r.id}.`);
    if (!(VERDICTS as readonly string[]).includes(r.choice)) reasons.push(`Unknown verdict for ${r.id}: "${r.choice}".`);
    if (!(r.confidence >= 0 && r.confidence <= 1)) reasons.push(`Confidence out of range for ${r.id}.`);
  }
  for (const c of candidates) {
    const n = seen.get(c.ref) ?? 0;
    if (n === 0) reasons.push(`Candidate ${c.ref} has no verdict.`);
    if (n > 1) reasons.push(`Candidate ${c.ref} has ${n} verdicts.`);
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export type ReviewProposal = { ref: string; verdict: Verdict; confidence: number; reason: string };

/** Verdict that isn't applied due to low confidence: it's recorded in the update. */
export type UnappliedVerdict = { ref: string; verdict: Verdict; confidence: number; path: string };

export type Plan = {
  project: Node[];
  invalidate: string[];
  newEdges: Edge[];
  invalidatedEdges: { type: string; from: string; to: string }[];
  reviews: ReviewProposal[];
  notApplied: UnappliedVerdict[];
};

export const emptyPlan = (): Plan => ({
  project: [],
  invalidate: [],
  newEdges: [],
  invalidatedEdges: [],
  reviews: [],
  notApplied: [],
});

/**
 * Operation plan for a verified update (§7.3 step 5). What touches authority
 * is never changed: it comes out as a review proposal for the person.
 */
export function buildPlan(
  g: Graph,
  change: Change,
  categories: Readonly<Record<string, string>>,
  responses: readonly ChoiceResponse[],
  newVersion: number,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Plan {
  const current = new Map(currentNodes(g).map((n) => [n.ref, n]));
  // Confirmed doesn't go back to proposed: if the version was already approved (e.g. "Accept and approve"),
  // the trigger from the proposal that created it doesn't downgrade it.
  if (current.get(change.main.ref)?.epistemic === 'confirmed' && change.main.epistemic !== 'confirmed') {
    return emptyPlan();
  }
  const plan = emptyPlan();
  const invalidate = new Set<string>();
  // Version precedence, in code: what's superseded is invalidated along with its criteria.
  for (const ref of change.supersedes) {
    if (!current.has(ref)) continue;
    invalidate.add(ref);
    for (const a of currentEdges(g)) if (a.from === ref && a.type === 'contains') invalidate.add(a.to);
  }
  // The same ref with a different epistemic status (a draft that gets approved) is superseded.
  for (const n of [change.main, ...change.companions]) if (current.has(n.ref)) invalidate.add(n.ref);
  const applicable = (confidence: number) => routeByConfidence(confidence, thresholds) === 'apply';
  for (const r of responses) {
    const node = current.get(r.id);
    if (!node) continue;
    const verdict = r.choice as Verdict;
    if (verdict === 'keep') continue;
    if (verdict === 'relate') {
      // A relation is derived knowledge: with high confidence it's applied; otherwise it's recorded
      // (the cascade already routed medium confidence through the reviewer, if any) and not applied.
      if (applicable(r.confidence))
        plan.newEdges.push({
          type: 'related',
          from: change.main.ref,
          to: r.id,
          validFrom: newVersion,
          validTo: null,
        });
      else
        plan.notApplied.push({ ref: r.id, verdict, confidence: r.confidence, path: routeByConfidence(r.confidence, thresholds) });
      continue;
    }
    if (verdict === 'invalidate' && !node.authority && applicable(r.confidence)) {
      invalidate.add(r.id);
      continue;
    }
    // update, invalidate, add or other over something with authority (or with low confidence): to the person.
    plan.reviews.push({ ref: r.id, verdict, confidence: r.confidence, reason: r.justification });
  }
  plan.invalidate = [...invalidate].sort();
  for (const n of [change.main, ...change.companions]) {
    plan.project.push({ ...n, categories: n.ref === change.main.ref ? categories : {}, from: newVersion, until: null });
  }
  // A structural edge is only projected if both its ends remain current.
  const remaining = new Set([...[...current.keys()].filter((r) => !invalidate.has(r)), ...plan.project.map((n) => n.ref)]);
  for (const a of change.edges) {
    if (remaining.has(a.from) && remaining.has(a.to)) plan.newEdges.push({ ...a, validFrom: newVersion, validTo: null });
  }
  // Current edges touching an invalidated node are invalidated along with it.
  for (const a of currentEdges(g)) {
    if (invalidate.has(a.from) || invalidate.has(a.to)) plan.invalidatedEdges.push({ type: a.type, from: a.from, to: a.to });
  }
  return plan;
}

/**
 * Removal of what a discarded draft version projected (§7.3): its node, its
 * criteria and the edges touching them are invalidated. Never removes something confirmed.
 */
export function removalPlan(g: Graph, refs: readonly string[]): Plan {
  const plan = emptyPlan();
  const current = new Map(currentNodes(g).map((n) => [n.ref, n]));
  const invalidate = new Set<string>();
  for (const ref of refs) {
    const n = current.get(ref);
    if (!n || n.epistemic === 'confirmed') continue;
    invalidate.add(ref);
    for (const a of currentEdges(g)) if (a.from === ref && a.type === 'contains') invalidate.add(a.to);
  }
  plan.invalidate = [...invalidate].sort();
  for (const a of currentEdges(g)) {
    if (invalidate.has(a.from) || invalidate.has(a.to)) plan.invalidatedEdges.push({ type: a.type, from: a.from, to: a.to });
  }
  return plan;
}

const key = (a: { type: string; from: string; to: string }): string => `${a.type}|${a.from}|${a.to}`;

/** Applies a plan to the in-memory graph (rebuild). */
export function applyPlan(g: Graph, plan: Plan, newVersion: number): Graph {
  const invalidate = new Set(plan.invalidate);
  const edgesOut = new Set(plan.invalidatedEdges.map(key));
  const nodes = g.nodes.map((n) => (n.until === null && invalidate.has(n.ref) ? { ...n, until: newVersion } : n));
  const edges = g.edges.map((a) => (a.validTo === null && edgesOut.has(key(a)) ? { ...a, validTo: newVersion } : a));
  return { version: newVersion, nodes: [...nodes, ...plan.project], edges: [...edges, ...plan.newEdges] };
}

/** A plan that changes nothing doesn't bump the graph version. */
export function isEmptyPlan(p: Plan): boolean {
  return p.project.length === 0 && p.invalidate.length === 0 && p.newEdges.length === 0 && p.invalidatedEdges.length === 0;
}

/** Graph fingerprint: nodes and edges with their validity, without ids or dates (AC-CON-001-06). */
export function graphFingerprint(g: Graph): string {
  const nodes = [...g.nodes]
    .map((n) => ({
      ref: n.ref,
      type: n.type,
      categories: n.categories,
      epistemic: n.epistemic,
      from: n.from,
      until: n.until,
    }))
    .sort((a, b) => (a.ref === b.ref ? a.from - b.from : a.ref < b.ref ? -1 : 1));
  const edges = [...g.edges]
    .map((a) => ({ type: a.type, from: a.from, to: a.to, validFrom: a.validFrom, validTo: a.validTo }))
    .sort((a, b) => {
      const ka = `${a.type}|${a.from}|${a.to}|${a.validFrom}`;
      const kb = `${b.type}|${b.from}|${b.to}|${b.validFrom}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  return fingerprint({ version: g.version, nodes, edges });
}

/** Candidates for assessing an idea: the most similar current nodes (§7.7). */
export function ideaCandidates(g: Graph, idea: string, limit = 8): Candidate[] {
  return currentNodes(g)
    .filter((n) => n.type !== 'criterion')
    .map((n) => ({ n, sim: similarity(idea, `${n.label}. ${n.text}`) }))
    .filter(({ sim }) => sim >= 0.05)
    .sort((a, b) => b.sim - a.sim || (a.n.ref < b.n.ref ? -1 : 1))
    .slice(0, limit)
    .map(({ n, sim }) => ({
      ref: n.ref,
      type: n.type,
      label: n.label,
      text: n.text.slice(0, 1500),
      reason: `text match (${sim.toFixed(2)})`,
    }));
}

/** Knowledge selection for a context pack: lexical relevance, with reason and budget. */
export function selectForContext(g: Graph, queryText: string, budget: number): { node: Node; reason: string }[] {
  const scored = currentNodes(g)
    .filter((n) => n.epistemic === 'confirmed' && n.type !== 'criterion')
    .map((n) => ({ node: n, sim: similarity(queryText, `${n.label}. ${n.text}`) }))
    .filter(({ sim }) => sim > 0)
    .sort((a, b) => b.sim - a.sim || (a.node.ref < b.node.ref ? -1 : 1));
  const chosen: { node: Node; reason: string }[] = [];
  let used = 0;
  for (const { node, sim } of scored) {
    const cost = node.label.length + Math.min(node.text.length, 600);
    if (used + cost > budget) break;
    used += cost;
    chosen.push({ node, reason: `topic relevance (${sim.toFixed(2)})` });
  }
  return chosen;
}
