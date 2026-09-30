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
const CANDIDATE_TEXT = 5000;
/** The product definition is the root every record rests on: it goes nearly whole. */
const DEFINITION_TEXT = 12000;
const CHANGE_TEXT = 12000;

/**
 * A record's text with its criteria first: they are its checkable statements, where contradictions
 * usually live, so a long prose is what gets cut, never them.
 */
export function textWithCriteria(g: Graph, node: Pick<Node, 'ref' | 'text'>, limit: number): string {
  const byRef = new Map(currentNodes(g).map((n) => [n.ref, n]));
  const criteria = currentEdges(g)
    .filter((a) => a.type === 'contains' && a.from === node.ref)
    .map((a) => byRef.get(a.to))
    .filter((n): n is Node => n !== undefined && n.type === 'criterion')
    .map((c) => `- ${c.label}: ${c.text.split('\nCheck:')[0]}`);
  return (criteria.length > 0 ? `Criteria:\n${criteria.join('\n')}\n\n${node.text}` : node.text).slice(0, limit);
}

/** The approved change's text as the classifier and the quote check see it: prose plus its criteria. */
export function changeText(change: Change): string {
  const criteria = change.companions
    .filter((n) => n.type === 'criterion')
    .map((c) => `- ${c.label}: ${c.text.split('\nCheck:')[0]}`);
  return (criteria.length > 0 ? `Criteria:\n${criteria.join('\n')}\n\n${change.main.text}` : change.main.text).slice(0, CHANGE_TEXT);
}

/**
 * Deterministic candidate preselection (§7.3 step 2). Knowledge looks for two things: statements
 * that cannot hold together with the change, and records that describe the same behavior, so
 * their build reuses one implementation. Candidates are the product definition (every record
 * rests on it), the structural neighbors of what the change rests on (its siblings), text
 * matches and nodes with the same categories. Derived `related` edges never seed candidates:
 * they grow with every update and would crowd out the records that matter. A task is only
 * compared with its sibling tasks. Bounded and ordered.
 */
export function selectCandidates(g: Graph, change: Change, categories: Readonly<Record<string, string>>): Candidate[] {
  // Excluded: the change itself and what it supersedes (decided by precedence). What a record
  // rests on is compared too (a feature can contradict the one it builds on), except a task's
  // feature: a task only details it.
  const task = change.main.type === 'task';
  const own = new Set([
    change.main.ref,
    ...change.companions.map((n) => n.ref),
    ...change.supersedes,
    ...(task ? change.edges.map((a) => a.to) : []),
  ]);
  const current = currentNodes(g).filter((n) => !own.has(n.ref) && n.type !== 'criterion' && (!task || n.type === 'task'));
  const byRef = new Map(current.map((n) => [n.ref, n]));
  const chosen = new Map<string, { node: Node; reason: string; weight: number }>();
  const add = (n: Node | undefined, reason: string, weight: number) => {
    if (!n) return;
    const existing = chosen.get(n.ref);
    if (!existing || existing.weight < weight) chosen.set(n.ref, { node: n, reason, weight });
  };
  if (!task && change.main.type !== 'product_definition') {
    for (const n of current) if (n.type === 'product_definition' && n.epistemic === 'confirmed') add(n, 'product definition', 5);
  }
  for (const a of change.edges) if (a.type !== 'contains') add(byRef.get(a.to), `rests on it (${a.type})`, 4);
  // Structural neighbors at distance 1 of what the change supersedes or links to.
  const seeds = new Set([...change.supersedes, ...change.edges.map((a) => a.to)]);
  for (const a of currentEdges(g)) {
    if (a.type === 'related' || a.type === 'contains') continue;
    if (seeds.has(a.from)) add(byRef.get(a.to), `neighbor of ${a.from} (${a.type})`, 3);
    if (seeds.has(a.to)) add(byRef.get(a.from), `neighbor of ${a.to} (${a.type})`, 3);
  }
  // What rested on the version this change replaces is always compared, whatever the limit: knowledge,
  // not a blanket flag, says which of them the new version contradicts.
  const dependents = new Map<string, Node>();
  for (const a of currentEdges(g)) {
    if (a.type === 'related' || a.type === 'contains' || !change.supersedes.includes(a.to)) continue;
    const n = byRef.get(a.from);
    if (n) dependents.set(n.ref, n);
  }
  if (!task) {
    const text = `${change.main.label}. ${change.main.text}`;
    for (const n of current) {
      const sim = similarity(text, `${n.label}. ${n.text}`);
      if (sim >= 0.08) add(n, `text match (${sim.toFixed(2)})`, 1 + sim);
      const common = Object.entries(categories).filter(([axis, c]) => c !== 'other' && n.categories[axis] === c);
      if (common.length > 0) add(n, `same category (${common.map(([e, c]) => `${e}=${c}`).join(', ')})`, 2 + common.length / 10);
    }
  }
  for (const n of dependents.values()) chosen.delete(n.ref);
  const rest = [...chosen.values()].sort((a, b) => b.weight - a.weight || (a.node.ref < b.node.ref ? -1 : 1)).slice(0, MAX_CANDIDATES);
  const resting = [...dependents.values()]
    .sort((a, b) => (a.ref < b.ref ? -1 : 1))
    .map((node) => ({ node, reason: 'rests on the version it replaces' }));
  return [...resting, ...rest]
    .map(({ node, reason }) => ({
      ref: node.ref,
      type: node.type,
      label: node.label,
      text: textWithCriteria(g, node, node.type === 'product_definition' ? DEFINITION_TEXT : CANDIDATE_TEXT),
      reason,
    }));
}

/** Version of the question knowledge asks about a change: part of the cache key. */
export const CHANGE_CONTRACT = 'conflict-quotes-1';

export function hashVerdictsInput(classifier: string, change: Change, candidates: readonly Candidate[]): string {
  return fingerprint({
    classifier,
    contract: CHANGE_CONTRACT,
    change: { ref: change.main.ref, label: change.main.label, text: changeText(change) },
    candidates: candidates.map((c) => ({ ref: c.ref, label: c.label, text: c.text })),
  });
}

/** The two statements a conflict verdict quotes, as `Change: "…" Candidate: "…"`. */
export function quotesOf(justification: string): { change: string; candidate: string } | null {
  const pick = (label: string) =>
    new RegExp(`${label}\\s*:\\s*["“«]([^"”»]{8,})["”»]`, 'i').exec(justification)?.[1]?.trim() ?? null;
  const change = pick('Change');
  const candidate = pick('Candidate');
  return change && candidate ? { change, candidate } : null;
}

const plain = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[*_`#>]/g, '')
    .replace(/[“”«»"]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;,:]+$/, '');

/** A verdict that asks the person to change a record must quote both sides verbatim. */
/** Whether a quote (at least 8 characters) is in a text, ignoring case, markdown, quote and dash styles and spacing. */
export function quoteIn(quote: string, text: string): boolean {
  const q = plain(quote);
  return q.length >= 8 && plain(text).includes(q);
}

export function quotesHold(justification: string, changeSide: string, candidateSide: string): boolean {
  const q = quotesOf(justification);
  if (!q) return false;
  return plain(changeSide).includes(plain(q.change)) && plain(candidateSide).includes(plain(q.candidate));
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
    if (verdict === 'relate' && node.type === 'product_definition') continue;
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
    // Only a conflict the person can see reaches them: both clashing statements quoted verbatim.
    // Undecided evidence ("other") or a conflict without its quotes stays recorded in the update.
    if (verdict === 'other') {
      plan.notApplied.push({ ref: r.id, verdict, confidence: r.confidence, path: 'undecided' });
      continue;
    }
    if (!quotesHold(r.justification, changeText(change), textWithCriteria(g, node, Number.MAX_SAFE_INTEGER))) {
      plan.notApplied.push({ ref: r.id, verdict, confidence: r.confidence, path: 'unquoted' });
      continue;
    }
    // update, invalidate or add over something with authority (or with low confidence): to the person.
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

export type ContextChoice = { node: Node; reason: string; score: number };

/** Why a candidate ended where it did: it entered, the budget was full, or it matched nothing. */
export type ContextCandidateReason = 'chosen' | 'budget' | 'below_threshold';

export type ContextCandidate = { node: Node; score: number; reason: ContextCandidateReason };

export type ContextSelection = {
  chosen: ContextChoice[];
  /** Every candidate (confirmed, not a criterion) with its similarity, in the order they were weighed. */
  considered: ContextCandidate[];
};

/** Where the pack cuts a node's text. */
export const CONTEXT_NODE_TEXT_CHARS = 600;

/** Cost of a node in the knowledge budget: its label plus its text, capped where the pack cuts it. */
export function contextNodeCost(node: Node): number {
  return node.label.length + Math.min(node.text.length, CONTEXT_NODE_TEXT_CHARS);
}

/**
 * Knowledge selection for a context pack: lexical relevance, with reason and budget. Every
 * candidate is reported (observability §9.2): the ones that entered, the ones the budget left out
 * once it was full, and the ones with no lexical match at all (`below_threshold`).
 */
export function selectForContext(g: Graph, queryText: string, budget: number): ContextSelection {
  const scored = currentNodes(g)
    // The product definition goes whole in every pack that writes records, not as a lexical match.
    .filter((n) => n.epistemic === 'confirmed' && n.type !== 'criterion' && n.type !== 'product_definition')
    .map((n) => ({ node: n, sim: similarity(queryText, `${n.label}. ${n.text}`) }))
    .sort((a, b) => b.sim - a.sim || (a.node.ref < b.node.ref ? -1 : 1));
  const chosen: ContextChoice[] = [];
  const considered: ContextCandidate[] = [];
  let used = 0;
  let full = false;
  for (const { node, sim } of scored) {
    if (sim <= 0) {
      considered.push({ node, score: sim, reason: 'below_threshold' });
      continue;
    }
    const cost = contextNodeCost(node);
    // The first node that does not fit closes the budget: the order is by relevance, not by size.
    if (full || used + cost > budget) {
      full = true;
      considered.push({ node, score: sim, reason: 'budget' });
      continue;
    }
    used += cost;
    chosen.push({ node, reason: `topic relevance (${sim.toFixed(2)})`, score: sim });
    considered.push({ node, score: sim, reason: 'chosen' });
  }
  return { chosen, considered };
}
