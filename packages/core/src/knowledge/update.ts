// The "Update knowledge" step (§7.3): deterministic candidates → classifier → deterministic
// verification → apply in a transaction together with its event. Verified verdicts are saved
// by input_hash and reused: the same input gives the same applied result. What isn't verified
// never enters the cache, so a retry asks again.

import {
  VERDICT_QUESTION,
  type Candidate,
  type Change,
  type Classifier,
  type Graph,
  type ItemChoice,
  type Plan,
  type ChoiceResponse,
  VERDICTS,
  routeByConfidence,
  hashCategoriesInput,
  hashVerdictsInput,
  currentNodes,
  removalPlan,
  emptyPlan,
  isEmptyPlan,
  buildPlan,
  selectCandidates,
  verifyCategories,
  verifyVerdicts,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import { inTransaction, executeCommand } from '../bus/bus.ts';
import type { Request, Result } from '../bus/types.ts';
import type { Db, Tx } from '../db/connection.ts';
import type { Services } from '../services.ts';
import { UPDATER } from './commands.ts';
import { DISCARD_TRIGGER, type AuthorityObject, deriveChange, deriveRemoval } from './derive.ts';
import { loadGraph } from './graph-pg.ts';

export type Axis = { code: string; name: string; categories: { code: string; name: string; description: string }[] };
/** Current approved taxonomy; `content` is its fingerprint, part of the categories' input_hash. */
export type CurrentTaxonomy = { id: string; code: string; version: number; content: string; axes: Axis[] };

export async function currentTaxonomy(db: Db, projectId: string): Promise<CurrentTaxonomy | null> {
  const t = await db
    .selectFrom('taxonomies')
    .select(['id', 'code', 'version', 'axes', 'content_hash'])
    .where('project_id', '=', projectId)
    .where('state', '=', 'approved')
    .orderBy('code')
    .orderBy('version', 'desc')
    .executeTakeFirst();
  return t ? { id: t.id, code: t.code, version: t.version, content: t.content_hash, axes: t.axes as Axis[] } : null;
}

/** The taxonomy's key in the input_hash: the same code and version with different content is a different entry. */
export const taxonomyKey = (t: { code: string; version: number; content: string }): string =>
  `${t.code}@${t.version}#${t.content}`;

/** A classifier response pending to be saved: it only enters the cache if it's verified. */
export type ToSave = { hash: string; classifier: string; responses: ChoiceResponse[] };

/** Reads from the cache or asks the classifier. Doesn't save: that happens after verification. */
export async function respondWithCache(
  db: Db,
  classifier: Classifier,
  hash: string,
  items: readonly ItemChoice[],
): Promise<{ responses: ChoiceResponse[]; fromCache: boolean; toSave: ToSave | null }> {
  const prior = await db.selectFrom('verdict_cache').select('answers').where('input_hash', '=', hash).executeTakeFirst();
  if (prior) return { responses: prior.answers as ChoiceResponse[], fromCache: true, toSave: null };
  const responses = items.length === 0 ? [] : await classifier.choice(items);
  return { responses, fromCache: false, toSave: { hash, classifier: classifier.id, responses } };
}

/** Saves verified responses (immutable: the first one to arrive stays). */
export async function saveToCache(db: Db, inputs: readonly (ToSave | null)[]): Promise<void> {
  for (const e of inputs) {
    if (!e) continue;
    await sql`insert into verdict_cache (input_hash, classifier, answers) values (${e.hash}, ${e.classifier}, ${JSON.stringify(e.responses)}::jsonb)
      on conflict (input_hash) do nothing`.execute(db);
  }
}

export function itemsForCategories(change: Change, taxonomy: { axes: readonly Axis[] }): ItemChoice[] {
  return taxonomy.axes.map((axis) => ({
    id: axis.code,
    state: {
      task: 'category',
      axis: axis.code,
      categories: axis.categories,
      artifact: { title: change.main.label, text: change.main.text },
    },
    question: `Which category under "${axis.name}" does this artifact belong to?`,
    options: axis.categories.map((c) => c.code),
  }));
}

export function itemsForVerdicts(change: Change, candidates: readonly Candidate[]): ItemChoice[] {
  return candidates.map((c) => ({
    id: c.ref,
    state: {
      task: 'verdict',
      change: {
        ref: change.main.ref,
        type: change.main.type,
        title: change.main.label,
        text: change.main.text,
      },
      candidate: { ref: c.ref, type: c.type, title: c.label, text: c.text },
    },
    question: VERDICT_QUESTION,
    options: VERDICTS,
  }));
}

/** Categories applied to the node: only the high-confidence ones. */
export function applicableCategories(responses: readonly ChoiceResponse[]): Record<string, string> {
  return Object.fromEntries(responses.filter((r) => routeByConfidence(r.confidence) === 'apply').map((r) => [r.id, r.choice]));
}

export type Classified = {
  change: Change;
  taxonomy: { id: string; code: string; version: number; content: string } | null;
  axes: Axis[];
  categoriesHash: string | null;
  categories: ChoiceResponse[];
  candidates: Candidate[];
  verdictsHash: string;
  verdicts: ChoiceResponse[];
  /** New classifier responses: saved to the cache only if they're verified. */
  toSave: ToSave[];
};

/** Runs the full computation for a change over a given graph (incremental and rebuild). */
export async function classifyChange(
  db: Db,
  classifier: Classifier,
  graph: Graph,
  change: Change,
  taxonomy: CurrentTaxonomy | null,
): Promise<Classified> {
  const toSave: ToSave[] = [];
  let categoriesHash: string | null = null;
  let categories: ChoiceResponse[] = [];
  if (taxonomy) {
    categoriesHash = hashCategoriesInput(classifier.id, taxonomyKey(taxonomy), change);
    const r = await respondWithCache(db, classifier, categoriesHash, itemsForCategories(change, taxonomy));
    categories = r.responses;
    if (r.toSave) toSave.push(r.toSave);
  }
  // Only valid categories steer the candidate search; invalid ones cause rejection later.
  const valid = taxonomy && verifyCategories(taxonomy.axes, categories).ok ? categories : [];
  const candidates = selectCandidates(graph, change, applicableCategories(valid));
  const verdictsHash = hashVerdictsInput(classifier.id, change, candidates);
  const r = await respondWithCache(db, classifier, verdictsHash, itemsForVerdicts(change, candidates));
  if (r.toSave) toSave.push(r.toSave);
  return {
    change,
    taxonomy: taxonomy ? { id: taxonomy.id, code: taxonomy.code, version: taxonomy.version, content: taxonomy.content } : null,
    axes: taxonomy?.axes ?? [],
    categoriesHash,
    categories,
    candidates,
    verdictsHash,
    verdicts: r.responses,
    toSave,
  };
}

/** Reasons the classifier's output fails verification (empty if it's verified). */
export function verificationReasons(graph: Graph, d: Classified): string[] {
  const reasons: string[] = [];
  const v = verifyVerdicts(graph, d.candidates, d.verdicts);
  if (!v.ok) reasons.push(...v.reasons);
  if (d.taxonomy) {
    const c = verifyCategories(d.axes, d.categories);
    if (!c.ok) reasons.push(...c.reasons);
  }
  return reasons;
}

export type ClassifyStepResult =
  | { type: 'finished' }
  | { type: 'no_change' }
  | { type: 'error'; reason: string }
  | { type: 'removal'; refs: string[] }
  | { type: 'classified'; data: Classified };

export async function classifyStep(s: Services, updateId: string, projectId: string): Promise<ClassifyStepResult> {
  const u = await s.db
    .selectFrom('knowledge_updates')
    .select(['state', 'trigger'])
    .where('id', '=', updateId)
    .executeTakeFirstOrThrow();
  if (!['queued', 'classifying'].includes(u.state)) return { type: 'finished' };
  if (u.state === 'queued') {
    await executeCommand(s, {
      command: 'knowledge_update.classify',
      actor: UPDATER,
      projectId,
      entityId: updateId,
      data: {},
    });
  }
  // Any failure while deriving or classifying rejects the update: it never stays in progress.
  try {
    const trigger = u.trigger as AuthorityObject;
    if (trigger.type === DISCARD_TRIGGER) return { type: 'removal', refs: await deriveRemoval(s.db, trigger) };
    const change = await deriveChange(s.db, trigger);
    if (!change) return { type: 'no_change' };
    const graph = await loadGraph(s.db, projectId);
    const data = await classifyChange(s.db, s.classifier, graph, change, await currentTaxonomy(s.db, projectId));
    return { type: 'classified', data };
  } catch (e) {
    return { type: 'error', reason: `Could not classify the change: ${String(e).slice(0, 1500)}` };
  }
}

/** The updater's executor: the default actor is the updater itself (system). */
type Execute = (p: Omit<Request, 'actor'> & { actor?: Request['actor'] }) => Promise<Result>;

async function currentNodeId(trx: Tx, projectId: string, ref: string): Promise<string | null> {
  const n = await trx
    .selectFrom('knowledge_nodes')
    .select('id')
    .where('project_id', '=', projectId)
    .where('ref', '=', ref)
    .where('valid_to', 'is', null)
    .executeTakeFirst();
  return n?.id ?? null;
}

/** Applies a plan's operations to the graph in the database, with their commands and events. */
async function applyOperations(
  execute: Execute,
  trx: Tx,
  projectId: string,
  plan: Plan,
  version: number,
  updateId: string,
): Promise<void> {
  // First the edges to close are found (with their nodes still current), then they're invalidated.
  const edgesToClose: string[] = [];
  for (const a of plan.invalidatedEdges) {
    const from = await currentNodeId(trx, projectId, a.from);
    const to = await currentNodeId(trx, projectId, a.to);
    if (!from || !to) continue;
    const edges = await trx
      .selectFrom('knowledge_edges')
      .select('id')
      .where('project_id', '=', projectId)
      .where('kind', '=', a.type)
      .where('from_node', '=', from)
      .where('to_node', '=', to)
      .where('valid_to', 'is', null)
      .execute();
    edgesToClose.push(...edges.map((e) => e.id));
  }
  for (const id of edgesToClose) await execute({ command: 'knowledge_edge.invalidate', entityId: id, data: { until: version } });
  for (const ref of plan.invalidate) {
    const id = await currentNodeId(trx, projectId, ref);
    if (id) await execute({ command: 'knowledge_node.invalidate', entityId: id, data: { until: version } });
  }
  for (const n of plan.project) {
    await execute({
      command: 'knowledge_node.project',
      data: {
        ref: n.ref,
        type: n.type,
        label: n.label,
        text: n.text,
        categories: n.categories,
        epistemic: n.epistemic,
        origin: n.origin,
        from: version,
        update_id: updateId,
      },
    });
  }
  for (const a of plan.newEdges) {
    await execute({
      command: 'knowledge_edge.project',
      data: { type: a.type, from: a.from, to: a.to, valid_from: version, update_id: updateId },
    });
  }
}

const operationsOf = (plan: Plan) => ({
  projected: plan.project.map((n) => n.ref),
  invalidated: plan.invalidate,
  new_edges: plan.newEdges.length,
  invalidated_edges: plan.invalidatedEdges.length,
  reviews: plan.reviews,
  not_applied: plan.notApplied,
});

/** Verifies and applies (or rejects) in a single transaction; idempotent if interrupted. */
export async function applyStep(s: Services, updateId: string, projectId: string, r: ClassifyStepResult): Promise<string> {
  return inTransaction(s, async (executeBase, trx) => {
    await sql`select 1 from projects where id = ${projectId}::uuid for update`.execute(trx);
    const u = await trx
      .selectFrom('knowledge_updates')
      .select('state')
      .where('id', '=', updateId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (u.state !== 'classifying') return u.state;
    const execute: Execute = (p) => executeBase({ projectId, ...p, actor: p.actor ?? UPDATER });
    const reject = async (reasons: string[]) => {
      await execute({ entityId: updateId, command: 'knowledge_update.reject', data: { reasons } });
      return 'rejected';
    };
    if (r.type === 'finished') return u.state;
    if (r.type === 'error') return reject([r.reason]);
    const graph = await loadGraph(trx, projectId);
    // Applies the plan; `after` adds classifications and proposals before the final event.
    const apply = async (plan: Plan, after?: () => Promise<void>) => {
      const version = isEmptyPlan(plan) ? graph.version : graph.version + 1;
      await applyOperations(execute, trx, projectId, plan, version, updateId);
      await after?.();
      await execute({
        entityId: updateId,
        command: 'knowledge_update.apply',
        data: { operations: operationsOf(plan), version_before: graph.version, version_after: version },
      });
      return 'applied';
    };
    if (r.type === 'no_change' || r.type === 'removal') {
      await execute({
        entityId: updateId,
        command: 'knowledge_update.verify',
        data: {
          change: r.type === 'removal' ? { removal: r.refs } : null,
          candidates: [],
          input_hash: '',
          classifier: s.classifier.id,
          verdicts: [],
        },
      });
      if (r.type === 'no_change') return apply(emptyPlan());
      return apply(removalPlan(graph, r.refs));
    }
    const d = r.data;
    await execute({
      entityId: updateId,
      command: 'knowledge_update.verify',
      data: {
        change: d.change,
        candidates: d.candidates,
        input_hash: d.verdictsHash,
        classifier: s.classifier.id,
        verdicts: {
          taxonomy: d.taxonomy,
          categories_hash: d.categoriesHash,
          categories: d.categories,
          verdicts: d.verdicts,
        },
      },
    });
    const reasons = verificationReasons(graph, d);
    if (reasons.length > 0) return reject(reasons);
    const plan = buildPlan(graph, d.change, applicableCategories(d.categories), d.verdicts, graph.version + 1);
    // Whatever touches authority goes out as a proposal: if a review can't be proposed, the
    // update is rejected instead of being lost.
    const reviews = await prepareReviews(trx, projectId, graph, d, plan.reviews);
    if (reviews.reasons.length > 0) return reject(reviews.reasons);
    await saveToCache(trx, d.toSave);
    const taxonomyId = d.taxonomy?.id;
    return apply(plan, async () => {
      for (const c of taxonomyId ? d.categories : []) {
        await execute({
          command: routeByConfidence(c.confidence) === 'apply' ? 'classification.record' : 'classification.hold',
          data: {
            node_ref: d.change.main.ref,
            taxonomy_id: taxonomyId,
            axis: c.id,
            category: c.choice,
            confidence: c.confidence,
            justification: c.justification,
            classifier: s.classifier.id,
            input_hash: d.categoriesHash ?? '',
            update_id: updateId,
          },
        });
      }
      if (reviews.proposals.length > 0) {
        await execute({
          command: 'batch.submit',
          data: {
            summary: `Knowledge suggests reviewing ${reviews.proposals.length} record(s) after ${d.change.main.ref}.`,
            batch_type: 'knowledge',
            resolution: 'item',
            proposals: reviews.proposals,
          },
        });
      }
    });
  });
}

/**
 * If processing an update fails with a system error (after its retries), it's rejected
 * with the reason: it never stays in progress blocking freshness.
 */
export async function rejectOnError(s: Services, updateId: string, projectId: string, e: unknown): Promise<void> {
  const u = await s.db.selectFrom('knowledge_updates').select('state').where('id', '=', updateId).executeTakeFirstOrThrow();
  if (!['queued', 'classifying', 'verifying'].includes(u.state)) return;
  const base = { actor: UPDATER, projectId, entityId: updateId } as const;
  if (u.state === 'queued') await executeCommand(s, { ...base, command: 'knowledge_update.classify', data: {} });
  await executeCommand(s, {
    ...base,
    command: 'knowledge_update.reject',
    data: { reasons: [`System error while processing the update: ${String(e).slice(0, 1500)}`] },
  });
}

type ReviewProposal = {
  type: 'review';
  payload: Record<string, unknown>;
  dependencies: { type: 'record'; id: string; code: string; version: number }[];
};

/**
 * Review proposals for the person. The record is located via the node's origin (the
 * version that projected it), never by parsing its ref.
 */
async function prepareReviews(
  trx: Tx,
  projectId: string,
  graph: Graph,
  d: Classified,
  reviews: Plan['reviews'],
): Promise<{ proposals: ReviewProposal[]; reasons: string[] }> {
  const current = new Map(currentNodes(graph).map((n) => [n.ref, n]));
  const proposals: ReviewProposal[] = [];
  const reasons: string[] = [];
  for (const review of reviews) {
    const origin = current.get(review.ref)?.origin;
    const v =
      origin?.type === 'record_version' && origin.id
        ? await trx
            .selectFrom('record_versions')
            .innerJoin('records', 'records.id', 'record_versions.record_id')
            .select(['records.id as recordId', 'records.code', 'record_versions.n'])
            .where('record_versions.id', '=', origin.id)
            .where('records.project_id', '=', projectId)
            .executeTakeFirst()
        : undefined;
    if (!v) {
      reasons.push(`Can't propose the review of ${review.ref}: its node doesn't come from a record version in this project.`);
      continue;
    }
    proposals.push({
      type: 'review',
      payload: {
        record: { code: v.code, version: v.n },
        verdict: review.verdict,
        reason: (review.reason || `Change ${d.change.main.ref} might affect ${review.ref}.`).slice(0, 2000),
        change: {
          type: d.change.main.origin.type,
          id: d.change.main.origin.id ?? '',
          version: d.change.main.origin.version,
        },
        confidence: review.confidence,
      },
      dependencies: [{ type: 'record', id: v.recordId, code: v.code, version: v.n }],
    });
  }
  return { proposals, reasons };
}
