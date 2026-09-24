// Motor de conocimiento (§7 del plan), parte pura. El grafo es una proyección de la autoridad:
// la actualización incremental y la reconstrucción usan exactamente estas funciones, así que
// reconstruir con las clasificaciones guardadas da la misma huella (I10).

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

/** Nodo derivado. `ref` es estable y lleva la versión de lo que representa (p. ej. DEC-PRO-001@2). */
export type Node = {
  ref: string;
  type: string;
  label: string;
  text: string;
  categories: Readonly<Record<string, string>>;
  epistemic: EpistemicStatus;
  /** Si viene de algo con autoridad (registro o criterio), nunca se cambia sin la persona. */
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

/** Cambio de autoridad proyectado de forma determinista (sin clasificador). */
export type Change = {
  /** Nodo principal del cambio (el que se clasifica y se compara con los candidatos). */
  main: Omit<Node, 'from' | 'until' | 'categories'>;
  /** Nodos que acompañan al principal (p. ej. sus criterios). */
  companions: Omit<Node, 'from' | 'until' | 'categories'>[];
  /** Aristas nuevas por la estructura (contiene, enlaces de la autoridad). */
  edges: { type: string; from: string; to: string }[];
  /** Refs que la precedencia de versiones deja sustituidas (lo decide el código, no el modelo). */
  supersedes: string[];
};

export type Candidate = { ref: string; type: string; label: string; text: string; reason: string };

const MAX_CANDIDATES = 12;

/**
 * Preselección determinista de candidatos (§7.3 paso 2): vecinos del registro en el grafo,
 * coincidencias de texto y nodos con las mismas categorías. Acotada y ordenada.
 */
export function selectCandidates(g: Graph, change: Change, categories: Readonly<Record<string, string>>): Candidate[] {
  // Fuera: el propio cambio, lo que sustituye (lo decide la precedencia) y lo que enlaza (esa
  // relación ya la declaró la persona en la autoridad).
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
  // Vecinos a distancia 1 de lo que el cambio sustituye o enlaza.
  const seeds = new Set([...change.supersedes, ...change.edges.map((a) => a.to)]);
  for (const a of currentEdges(g)) {
    if (seeds.has(a.from)) add(byRef.get(a.to), `vecino de ${a.from} (${a.type})`, 3);
    if (seeds.has(a.to)) add(byRef.get(a.from), `vecino de ${a.to} (${a.type})`, 3);
  }
  const text = `${change.main.label}. ${change.main.text}`;
  for (const n of current) {
    const sim = similarity(text, `${n.label}. ${n.text}`);
    if (sim >= 0.08) add(n, `coincidencia de texto (${sim.toFixed(2)})`, 1 + sim);
    const common = Object.entries(categories).filter(([axis, c]) => c !== 'other' && n.categories[axis] === c);
    if (common.length > 0)
      add(n, `misma categoría (${common.map(([e, c]) => `${e}=${c}`).join(', ')})`, 2 + common.length / 10);
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
 * Verificación de las categorías (§7.4): la taxonomía es un conjunto cerrado. Cada respuesta
 * nombra un eje de la taxonomía y una categoría de ese eje, una por eje y con confianza válida.
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
    if (!categories) reasons.push(`La clasificación cita un eje que no está en la taxonomía: ${r.id}.`);
    else if (!categories.has(r.choice)) reasons.push(`«${r.choice}» no es una categoría del eje ${r.id}.`);
    if (!(r.confidence >= 0 && r.confidence <= 1)) reasons.push(`Confianza fuera de rango para el eje ${r.id}.`);
  }
  for (const [axis, n] of seen) if (n > 1) reasons.push(`El eje ${axis} tiene ${n} clasificaciones.`);
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** Verificación determinista (§7.3 paso 4): un veredicto por candidato y todas las referencias existen. */
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
    if (!existing.has(r.id)) reasons.push(`El veredicto cita un nodo inexistente: ${r.id}.`);
    else if (!expected.has(r.id)) reasons.push(`El veredicto cita un nodo que no era candidato: ${r.id}.`);
    if (!(VERDICTS as readonly string[]).includes(r.choice))
      reasons.push(`Veredicto desconocido para ${r.id}: «${r.choice}».`);
    if (!(r.confidence >= 0 && r.confidence <= 1)) reasons.push(`Confianza fuera de rango para ${r.id}.`);
  }
  for (const c of candidates) {
    const n = seen.get(c.ref) ?? 0;
    if (n === 0) reasons.push(`El candidato ${c.ref} no tiene veredicto.`);
    if (n > 1) reasons.push(`El candidato ${c.ref} tiene ${n} veredictos.`);
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export type ReviewProposal = { ref: string; verdict: Verdict; confidence: number; reason: string };

/** Veredicto que no se aplica por falta de confianza: queda anotado en la actualización. */
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
 * Plan de operaciones de una actualización verificada (§7.3 paso 5). Lo que toca la autoridad
 * nunca se cambia: sale como propuesta de revisión para la persona.
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
  // Lo confirmado no vuelve a propuesto: si la versión ya se aprobó (p. ej. «Aceptar y aprobar»),
  // el disparo de la propuesta que la creó no la rebaja.
  if (current.get(change.main.ref)?.epistemic === 'confirmed' && change.main.epistemic !== 'confirmed') {
    return emptyPlan();
  }
  const plan = emptyPlan();
  const invalidate = new Set<string>();
  // Precedencia de versiones, en código: lo sustituido se invalida con sus criterios.
  for (const ref of change.supersedes) {
    if (!current.has(ref)) continue;
    invalidate.add(ref);
    for (const a of currentEdges(g)) if (a.from === ref && a.type === 'contains') invalidate.add(a.to);
  }
  // El mismo ref con otro estado epistémico (borrador que se aprueba) se sustituye.
  for (const n of [change.main, ...change.companions]) if (current.has(n.ref)) invalidate.add(n.ref);
  const applicable = (confidence: number) => routeByConfidence(confidence, thresholds) === 'apply';
  for (const r of responses) {
    const node = current.get(r.id);
    if (!node) continue;
    const verdict = r.choice as Verdict;
    if (verdict === 'keep') continue;
    if (verdict === 'relate') {
      // Una relación es conocimiento derivado: con confianza alta se aplica; si no, queda anotada
      // (la cascada ya pasó la confianza media por el revisor, si lo hay) y no se aplica.
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
    // update, invalidate, add u other sobre algo con autoridad (o con poca confianza): a la persona.
    plan.reviews.push({ ref: r.id, verdict, confidence: r.confidence, reason: r.justification });
  }
  plan.invalidate = [...invalidate].sort();
  for (const n of [change.main, ...change.companions]) {
    plan.project.push({ ...n, categories: n.ref === change.main.ref ? categories : {}, from: newVersion, until: null });
  }
  // Una arista de la estructura solo se proyecta si sus dos extremos quedan vigentes.
  const remaining = new Set([...[...current.keys()].filter((r) => !invalidate.has(r)), ...plan.project.map((n) => n.ref)]);
  for (const a of change.edges) {
    if (remaining.has(a.from) && remaining.has(a.to)) plan.newEdges.push({ ...a, validFrom: newVersion, validTo: null });
  }
  // Las aristas vigentes que tocan un nodo invalidado se invalidan con él.
  for (const a of currentEdges(g)) {
    if (invalidate.has(a.from) || invalidate.has(a.to))
      plan.invalidatedEdges.push({ type: a.type, from: a.from, to: a.to });
  }
  return plan;
}

/**
 * Retirada de lo que proyectó una versión en borrador que se descarta (§7.3): su nodo, sus
 * criterios y las aristas que los tocan quedan invalidados. Nunca retira algo confirmado.
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
    if (invalidate.has(a.from) || invalidate.has(a.to))
      plan.invalidatedEdges.push({ type: a.type, from: a.from, to: a.to });
  }
  return plan;
}

const key = (a: { type: string; from: string; to: string }): string => `${a.type}|${a.from}|${a.to}`;

/** Aplica un plan al grafo en memoria (reconstrucción). */
export function applyPlan(g: Graph, plan: Plan, newVersion: number): Graph {
  const invalidate = new Set(plan.invalidate);
  const edgesOut = new Set(plan.invalidatedEdges.map(key));
  const nodes = g.nodes.map((n) => (n.until === null && invalidate.has(n.ref) ? { ...n, until: newVersion } : n));
  const edges = g.edges.map((a) => (a.validTo === null && edgesOut.has(key(a)) ? { ...a, validTo: newVersion } : a));
  return { version: newVersion, nodes: [...nodes, ...plan.project], edges: [...edges, ...plan.newEdges] };
}

/** Un plan que no cambia nada no sube la versión del grafo. */
export function isEmptyPlan(p: Plan): boolean {
  return (
    p.project.length === 0 && p.invalidate.length === 0 && p.newEdges.length === 0 && p.invalidatedEdges.length === 0
  );
}

/** Huella del grafo: nodos y aristas con su validez, sin ids ni fechas (AC-CON-001-06). */
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

/** Candidatos para evaluar una idea: los nodos vigentes más parecidos (§7.7). */
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
      reason: `coincidencia de texto (${sim.toFixed(2)})`,
    }));
}

/** Selección de conocimiento para un context pack: relevancia léxica, con motivo y presupuesto. */
export function selectForContext(g: Graph, queryName: string, budget: number): { node: Node; reason: string }[] {
  const scored = currentNodes(g)
    .filter((n) => n.epistemic === 'confirmed' && n.type !== 'criterion')
    .map((n) => ({ node: n, sim: similarity(queryName, `${n.label}. ${n.text}`) }))
    .filter(({ sim }) => sim > 0)
    .sort((a, b) => b.sim - a.sim || (a.node.ref < b.node.ref ? -1 : 1));
  const chosen: { node: Node; reason: string }[] = [];
  let used = 0;
  for (const { node, sim } of scored) {
    const cost = node.label.length + Math.min(node.text.length, 600);
    if (used + cost > budget) break;
    used += cost;
    chosen.push({ node, reason: `relevancia por tema (${sim.toFixed(2)})` });
  }
  return chosen;
}
