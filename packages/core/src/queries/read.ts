// Read models for Pillar 1: product state, inbox, explorations, records with
// their readiness, and batches. These are derived functions: nothing is stored (§4 of the plan).

import { sql } from 'kysely';
import { taskCoversOf, taskSizeView } from './sizes.ts';
import {
  AGENT_PROPOSAL_TYPES,
  type DesignSystemSpec,
  designSystemWarnings,
  type Dependency,
  type ReadinessInput,
  DomainError,
  READINESS_BASES,
  type Readiness,
  type RecordType,
  type TaskBuildState,
  criterionState,
  featureDone,
  taskBuildState,
  epistemicOfObservation,
  epistemicOfQuestion,
  epistemicOfProposal,
  epistemicOfVersion,
  readiness,
  relationOf,
  behaviorSteps,
} from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { staleDependencies } from '../commands/proposals.ts';
import { epicOrder } from '../commands/epic-order.ts';
import { threadDraft } from './draft.ts';
import { githubConfig } from '../github/client.ts';

/** Records that are not built, so they have no readiness: a decision, and the product definition. */
const WITHOUT_READINESS: ReadonlySet<string> = new Set(['decision', 'product_definition']);

type Dep = { type: string; id: string; code?: string; version: number };

async function currentOf(db: Db, recordId: string): Promise<number | null> {
  const v = await db
    .selectFrom('record_versions')
    .select('n')
    .where('record_id', '=', recordId)
    .where('state', '=', 'approved')
    .orderBy('n', 'desc')
    .executeTakeFirst();
  return v?.n ?? null;
}

/**
 * Whether knowledge has checked what rests on a record against its version `n`: the update that
 * version triggered is applied (a contradiction found comes back as a review, which blocks too).
 */
async function knowledgeChecked(db: Db, recordId: string, n: number): Promise<boolean> {
  const v = await db.selectFrom('record_versions').select('id').where('record_id', '=', recordId).where('n', '=', n).executeTakeFirst();
  if (!v) return false;
  const u = await db
    .selectFrom('knowledge_updates')
    .select('state')
    .where(sql<boolean>`trigger->>'id' = ${v.id}`)
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  return u?.state === 'applied';
}

/** Origin exploration of a version: follows its origin (proposal → batch → run → scope). */
export async function originExploration(db: Db, versionId: string, hops = 6): Promise<string | null> {
  let cursor: { type: string; id: string } | null = { type: 'record_version', id: versionId };
  for (let i = 0; i < hops && cursor; i++) {
    if (cursor.type === 'exploration') return cursor.id;
    if (cursor.type === 'record_version') {
      const v = await db.selectFrom('record_versions').select('origin').where('id', '=', cursor.id).executeTakeFirst();
      cursor = (v?.origin as { type: string; id: string } | null) ?? null;
    } else if (cursor.type === 'proposal') {
      const p = await db
        .selectFrom('proposals')
        .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
        .select(['proposal_batches.run_id'])
        .where('proposals.id', '=', cursor.id)
        .executeTakeFirst();
      if (!p?.run_id) return null;
      const run = await db.selectFrom('ai_runs').select('scope').where('id', '=', p.run_id).executeTakeFirst();
      const scope = run?.scope as { type: string; id?: string } | undefined;
      cursor = scope?.id ? { type: scope.type, id: scope.id } : null;
    } else {
      return null;
    }
  }
  return null;
}

export async function versionReadiness(db: Db, projectId: string, versionId: string): Promise<Readiness> {
  const v = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'records.type', 'record_versions.n', 'record_versions.state'])
    .where('record_versions.id', '=', versionId)
    .where('records.project_id', '=', projectId)
    .executeTakeFirst();
  if (!v) throw new DomainError('not_found', 'The version does not exist.');
  const criteria = await db
    .selectFrom('criteria')
    .select(['code', 'verification', 'check_text', 'statement', 'step'])
    .where('record_version_id', '=', versionId)
    .orderBy('position')
    .execute();
  const behaviorSection =
    v.type === 'fdr' || v.type === 'epic'
      ? (
          await db.selectFrom('record_versions').select('sections').where('id', '=', versionId).executeTakeFirstOrThrow()
        ).sections
      : [];
  const behaviorStepCount = behaviorSteps(
    (behaviorSection as { title: string; content: string }[]).find((s) => s.title === 'Behavior')?.content ?? '',
  ).length;
  const links = await db
    .selectFrom('links')
    .innerJoin('record_versions as target', 'target.id', 'links.to_id')
    .innerJoin('records as rd', 'rd.id', 'target.record_id')
    .select([
      'links.type',
      'links.state',
      'rd.id as recordId',
      'rd.code',
      'rd.type as targetType',
      'target.n',
      'target.state as targetState',
    ])
    .where('links.from_id', '=', versionId)
    .execute();
  const basedOn: ReadinessInput['basedOn'] = [];
  const needs: ReadinessInput['needs'] = [];
  const linksUnderReview: string[] = [];
  const bases = READINESS_BASES[v.type as RecordType] ?? [];
  for (const e of links) {
    if (e.type === 'based_on' && bases.includes(e.targetType as RecordType)) {
      const current = await currentOf(db, e.recordId);
      basedOn.push({
        code: e.code,
        type: e.targetType,
        version: e.n,
        versionState: e.targetState,
        current,
        linkState: e.state,
        checked: current !== null && current !== e.n ? await knowledgeChecked(db, e.recordId, current) : true,
      });
      continue;
    }
    // A feature based on another feature needs it built first (the map draws it as "needs").
    if (e.type === 'based_on' && v.type === 'fdr' && e.targetType === 'fdr') {
      needs.push({ code: e.code, implementation: await implementationOf(db, e.recordId) });
    }
    if (e.state === 'needs_review') linksUnderReview.push(`${e.code} v${e.n}`);
  }
  const origin = await originExploration(db, versionId);
  const openQuestions = origin
    ? await db
        .selectFrom('questions')
        .select(['question as question', 'state as state'])
        .where('exploration_id', '=', origin)
        .where('state', 'in', ['pending', 'postponed', 'inferred'])
        .orderBy('created_at')
        .execute()
    : [];
  // A proposal affects it if it depends on the record, either by itself or through its batch.
  const pending = await db
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select(['proposals.dependencies', 'proposal_batches.dependencies as batchDeps'])
    .where('proposals.project_id', '=', projectId)
    .where('proposals.state', '=', 'pending')
    .execute();
  const pendingProposals = pending.filter((p) =>
    [...((p.dependencies ?? []) as Dep[]), ...((p.batchDeps ?? []) as Dep[])].some((d) => d.id === v.recordId),
  ).length;
  // An epic lists its features; approving it does not wait for their designs.
  const features =
    v.type === 'epic'
      ? await Promise.all(
          (
            await db
              .selectFrom('planned_features')
              .select(['code', 'name', 'record_id'])
              .where('epic_id', '=', v.recordId)
              .where('state', '!=', 'dropped')
              .orderBy('position')
              .execute()
          ).map(async (f) => ({
            code: f.code,
            name: f.name,
            designed: f.record_id ? (await currentOf(db, f.record_id)) !== null : false,
          })),
        )
      : undefined;
  const own = readiness({
    code: v.code,
    type: v.type as RecordType,
    version: { n: v.n, state: v.state },
    current: await currentOf(db, v.recordId),
    criteria: criteria.map((c) => ({
      code: c.code,
      verification: c.verification,
      check: c.check_text,
      statement: c.statement,
      step: c.step,
    })),
    ...(v.type === 'fdr' ? { behaviorSteps: behaviorStepCount } : {}),
    ...(v.type === 'epic'
      ? { hasOutOfScope: (behaviorSection as { title: string }[]).some((sec) => sec.title.startsWith('Out of scope')) }
      : {}),
    basedOn,
    needs,
    architecturePassed: await architecturePassed(db, projectId),
    linksUnderReview,
    openQuestions,
    pendingProposals,
    ...(features ? { features } : {}),
  });
  // A task is built as a piece of its feature (FDR-BUI-002): it is ready only when its feature is
  // ready to build too (approved basis, built needs, Architecture passed). The Build queue and the
  // task board read this same result.
  if (v.type === 'task') {
    for (const b of basedOn) {
      if (b.type !== 'fdr' || b.current === null) continue;
      const feature = await db
        .selectFrom('record_versions')
        .innerJoin('records', 'records.id', 'record_versions.record_id')
        .select('record_versions.id')
        .where('records.project_id', '=', projectId)
        .where('records.code', '=', b.code)
        .where('record_versions.n', '=', b.current)
        .executeTakeFirst();
      if (!feature) continue;
      const f = await versionReadiness(db, projectId, feature.id);
      for (const reason of f.reasons) own.reasons.push(`Feature ${b.code}: ${reason}`);
    }
    own.ready = own.reasons.length === 0;
  }
  return own;
}

async function architecturePassed(db: Db, projectId: string): Promise<boolean> {
  const stage = await db
    .selectFrom('stages')
    .select('id')
    .where('project_id', '=', projectId)
    .where('stage', '=', 'architecture')
    .where('state', '=', 'passed')
    .executeTakeFirst();
  return stage !== undefined;
}

export type CriterionEvidence = {
  kind: string;
  note: string;
  reference: string | null;
  pr_url: string | null;
  test_name: string | null;
  by: string;
  at: string;
  /** Version of the record the evidence was recorded on: an earlier one when it is inherited. */
  version: number;
  /** pass or fail; a row without a result counts as pass. */
  result: 'pass' | 'fail' | null;
};

/**
 * Evidence of a criterion: its latest, or, for a criterion carried over unchanged (`kept`), the one
 * of the criterion it carries, following the chain. A modified or new criterion starts without.
 */
export async function evidenceOf(db: Db, criterionId: string): Promise<CriterionEvidence | null> {
  let id: string | null = criterionId;
  for (let hops = 0; id && hops < 50; hops++) {
    const e = await db
      .selectFrom('evidence')
      .innerJoin('record_versions as v', 'v.id', 'evidence.record_version_id')
      .select([
        'evidence.kind',
        'evidence.note',
        'evidence.reference',
        'evidence.pr_url',
        'evidence.test_name',
        'evidence.result',
        'evidence.recorded_by',
        'evidence.created_at',
        'v.n',
      ])
      .where('evidence.criterion_id', '=', id)
      .orderBy('evidence.created_at', 'desc')
      .orderBy('evidence.id', 'desc')
      .executeTakeFirst();
    if (e) {
      return {
        kind: e.kind,
        note: e.note,
        reference: e.reference,
        pr_url: e.pr_url,
        test_name: e.test_name,
        by: e.recorded_by,
        at: new Date(e.created_at as unknown as Date).toISOString(),
        version: e.n,
        result: e.result === 'fail' ? 'fail' : e.result === 'pass' ? 'pass' : null,
      };
    }
    const c = await db.selectFrom('criteria').select(['carry', 'derived_from']).where('id', '=', id).executeTakeFirst();
    id = c?.carry === 'kept' ? c.derived_from : null;
  }
  return null;
}

/**
 * How built a record is, over the criteria of its current version: not implemented (none has
 * evidence), in progress (some) or implemented (all). Without a current version, not implemented.
 */
export async function implementationOf(db: Db, recordId: string): Promise<string> {
  const current = await db
    .selectFrom('record_versions')
    .select('id')
    .where('record_id', '=', recordId)
    .where('state', '=', 'approved')
    .orderBy('n', 'desc')
    .executeTakeFirst();
  if (!current) return 'not implemented';
  const criteria = await db.selectFrom('criteria').select('id').where('record_version_id', '=', current.id).execute();
  let checked = 0;
  for (const c of criteria) if (await evidenceOf(db, c.id)) checked++;
  if (checked === 0) return 'not implemented';
  return checked === criteria.length ? 'implemented' : 'in progress';
}

/** The based_on targets of a version: what it rests on and, for a feature, the features it needs. */
async function basisOf(db: Db, versionId: string, type: RecordType) {
  const targets = await db
    .selectFrom('links')
    .innerJoin('record_versions as t', 't.id', 'links.to_id')
    .innerJoin('records as rd', 'rd.id', 't.record_id')
    .select(['rd.code', 'rd.type'])
    .where('links.from_id', '=', versionId)
    .where('links.type', '=', 'based_on')
    .orderBy('rd.code')
    .execute();
  const bases = READINESS_BASES[type];
  const basis = bases
    ? bases.map((b) => targets.find((t) => t.type === b)).find((t) => t !== undefined)
    : targets[0];
  return {
    based_on: basis?.code ?? null,
    needs: type === 'fdr' ? targets.filter((t) => t.type === 'fdr').map((t) => t.code) : [],
  };
}

export type BasisRefs = {
  messages: {
    id: string;
    exploration_id: string;
    exploration_purpose: string;
    parent_purpose: string | null;
    body: string;
    aspect: string | null;
    aspect_confidence: number | null;
  }[];
  questions: { id: string; question: string; exploration_id: string; exploration_purpose: string }[];
};

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/** The message and question ids a proposal payload says it is based on (basis, evidence, sources). */
function basisIds(payload: unknown): { messages: string[]; questions: string[] } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const messages: string[] = [];
  const questions: string[] = [];
  for (const b of Array.isArray(p.basis) ? (p.basis as { type?: unknown; id?: unknown }[]) : []) {
    if (b.type === 'message' && isUuid(b.id)) messages.push(b.id);
    if (b.type === 'question' && isUuid(b.id)) questions.push(b.id);
  }
  for (const e of Array.isArray(p.evidence) ? (p.evidence as { message_id?: unknown }[]) : [])
    if (isUuid(e.message_id)) messages.push(e.message_id);
  for (const s of Array.isArray(p.sources) ? (p.sources as { question_id?: unknown }[]) : [])
    if (isUuid(s.question_id)) questions.push(s.question_id);
  return { messages, questions };
}

/** The threads behind the messages and questions each proposal is based on, keyed by proposal id. */
async function basisRefsOf(
  db: Db,
  projectId: string,
  proposals: readonly { id: string; payload: unknown }[],
): Promise<Map<string, BasisRefs>> {
  const ids = proposals.map((p) => ({ id: p.id, ...basisIds(p.payload) }));
  const messageIds = [...new Set(ids.flatMap((x) => x.messages))];
  const questionIds = [...new Set(ids.flatMap((x) => x.questions))];
  const messages = messageIds.length
    ? await db
        .selectFrom('messages as m')
        .innerJoin('explorations as e', 'e.id', 'm.exploration_id')
        .leftJoin('explorations as parent', 'parent.id', 'e.parent_id')
        .select([
          'm.id',
          'm.exploration_id',
          'e.purpose as exploration_purpose',
          'parent.purpose as parent_purpose',
          'm.body',
          'm.aspect',
          'm.aspect_confidence',
        ])
        .where('m.project_id', '=', projectId)
        .where('m.id', 'in', messageIds)
        .execute()
    : [];
  const questions = questionIds.length
    ? await db
        .selectFrom('questions as q')
        .innerJoin('explorations as e', 'e.id', 'q.exploration_id')
        .select(['q.id', 'q.question', 'q.exploration_id', 'e.purpose as exploration_purpose'])
        .where('e.project_id', '=', projectId)
        .where('q.id', 'in', questionIds)
        .execute()
    : [];
  const out = new Map<string, BasisRefs>();
  for (const x of ids) {
    out.set(x.id, {
      messages: messages.filter((m) => x.messages.includes(m.id)),
      questions: questions.filter((q) => x.questions.includes(q.id)),
    });
  }
  return out;
}

export async function inbox(db: Db, projectId: string) {
  const batches = await db
    .selectFrom('proposal_batches')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('state', '=', 'pending')
    .orderBy('created_at')
    .execute();
  const batchItems = [];
  for (const l of batches) {
    const proposals = await db
      .selectFrom('proposals')
      .selectAll()
      .where('batch_id', '=', l.id)
      .where('state', '=', 'pending')
      // A new thread DEMIURGO suggests (a fork) waits in its thread, not in Needs you.
      .where('type', '<>', 'exploration')
      .orderBy('position')
      .execute();
    if (proposals.length === 0) continue;
    const refs = await basisRefsOf(db, projectId, proposals);
    const withWarning = [];
    for (const p of proposals) {
      const deps = [...((l.dependencies ?? []) as Dependency[]), ...((p.dependencies ?? []) as Dependency[])];
      const warnings = await staleDependencies(db, deps);
      withWarning.push({
        id: p.id,
        type: p.type,
        payload: p.payload,
        state: p.state,
        epistemic_status: epistemicOfProposal(p.state),
        obsolescence: warnings,
        // Only what an agent proposes of its own is checked against the knowledge (knowledge/workflows.ts).
        assessment: ASSESSED.has(p.type) ? await assessmentOf(db, p.id) : null,
        dependencies: (p.dependencies ?? []) as Dependency[],
        aspect_check: p.aspect_check ?? null,
        basis_refs: refs.get(p.id) ?? { messages: [], questions: [] },
      });
    }
    batchItems.push({
      id: l.id,
      type: l.kind,
      producer: l.producer,
      resolution: l.resolution_mode,
      summary: l.summary,
      run_id: l.run_id,
      created: l.created_at,
      dependencies: (l.dependencies ?? []) as Dependency[],
      proposals: withWarning,
    });
  }
  const questions = await db
    .selectFrom('questions')
    .select([
      'id',
      'exploration_id',
      'question',
      'reason',
      'options',
      'multiple',
      'state',
      'conclusion',
      'reasoning',
      'raised_by',
    ])
    .where('project_id', '=', projectId)
    .where('state', '=', 'inferred')
    // Questions still in the reserve don't need the person yet.
    .where('shown_at', 'is not', null)
    .orderBy('created_at')
    .execute();
  // What is waiting for the person even when it doesn't come from an agent: open questions and unapproved drafts.
  const open = await db
    .selectFrom('questions')
    .select(['id', 'exploration_id', 'question', 'reason', 'options', 'multiple', 'state', 'state_reason', 'raised_by'])
    .where('project_id', '=', projectId)
    .where('state', 'in', ['pending', 'postponed'])
    .where('shown_at', 'is not', null)
    .orderBy('created_at')
    .execute();
  const drafts = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select([
      'record_versions.id',
      'records.code',
      'records.type',
      'record_versions.n',
      'record_versions.title',
      'record_versions.state',
      'record_versions.record_id',
    ])
    .where('record_versions.project_id', '=', projectId)
    .where('record_versions.state', '=', 'draft')
    // An accepted epic grows while its features are designed: it is approved from its page, not from here.
    .where('records.type', '!=', 'epic')
    .orderBy('records.code')
    .orderBy('record_versions.n')
    .execute();
  // Which records each link joins, so the person knows what to review.
  const links = await db
    .selectFrom('links')
    .innerJoin('record_versions as f', 'f.id', 'links.from_id')
    .innerJoin('records as fr', 'fr.id', 'f.record_id')
    .innerJoin('record_versions as t', 't.id', 'links.to_id')
    .innerJoin('records as tr', 'tr.id', 't.record_id')
    .selectAll('links')
    .select([
      'fr.code as from_code',
      'f.n as from_n',
      'f.title as from_title',
      'tr.code as to_code',
      't.n as to_n',
      't.title as to_title',
    ])
    .where('links.project_id', '=', projectId)
    .where('links.state', '=', 'needs_review')
    .execute();
  const extra = await pendingKnowledge(db, projectId);
  const total =
    batchItems.reduce((n, l) => n + l.proposals.length, 0) +
    questions.length +
    open.length +
    drafts.length +
    links.length +
    extra.total;
  return {
    total,
    batches: batchItems,
    questions_to_confirm: questions.map((q) => ({ ...q, epistemic_status: epistemicOfQuestion(q.state) })),
    open_questions: open.map((q) => ({ ...q, epistemic_status: epistemicOfQuestion(q.state) })),
    versions_to_approve: await Promise.all(
      drafts.map(async (v) => {
        // A draft older than the current version can no longer be approved: only discarded.
        const current = await currentOf(db, v.record_id);
        return {
          id: v.id,
          code: v.code,
          type: v.type,
          n: v.n,
          title: v.title,
          approvable: current === null || current < v.n,
          epistemic_status: epistemicOfVersion(v.state),
        };
      }),
    ),
    links_under_review: links.map((e) => ({ ...e, epistemic_status: 'pending' as const })),
    ...extra.sections,
  };
}

// S2 extends the inbox with idea assessment and pending knowledge items.
export type KnowledgeSections = {
  classifications_to_review: Record<string, unknown>[];
  rejected_updates: Record<string, unknown>[];
};
type InboxExtension = {
  assessment(db: Db, proposalId: string): Promise<unknown>;
  pending(db: Db, projectId: string): Promise<{ total: number; sections: KnowledgeSections }>;
};
let extension: InboxExtension = {
  assessment: async () => null,
  pending: async () => ({ total: 0, sections: { classifications_to_review: [], rejected_updates: [] } }),
};
export function registerInboxExtension(e: InboxExtension): void {
  extension = e;
}
const assessmentOf = (db: Db, id: string) => extension.assessment(db, id);
const ASSESSED: ReadonlySet<string> = new Set(AGENT_PROPOSAL_TYPES);
const pendingKnowledge = (db: Db, id: string) => extension.pending(db, id);

export async function recordDetail(db: Db, projectId: string, code: string) {
  const r = await db
    .selectFrom('records')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('code', '=', code)
    .executeTakeFirst();
  if (!r) throw new DomainError('not_found', `Record ${code} does not exist.`);
  const versions = await db.selectFrom('record_versions').selectAll().where('record_id', '=', r.id).orderBy('n').execute();
  const current = await currentOf(db, r.id);
  // Delivery: the tasks of a feature (or the feature of a task) and their computed build states.
  const delivery = r.type === 'fdr' ? await featureDelivery(db, projectId, r.id, current) : null;
  const taskDrafts = r.type === 'fdr' ? await taskDraftsOf(db, projectId, r.code) : [];
  const detail = [];
  for (const v of versions) {
    const criteria = await db
      .selectFrom('criteria')
      .selectAll()
      .where('record_version_id', '=', v.id)
      .orderBy('position')
      .execute();
    // Each link says which record, version, title and state it points to.
    const rawLinks = await db
      .selectFrom('links')
      .leftJoin('record_versions as t', 't.id', 'links.to_id')
      .leftJoin('records as tr', 'tr.id', 't.record_id')
      .selectAll('links')
      .select(['tr.id as to_record', 'tr.code as to_code', 't.n as to_n', 't.title as to_title', 't.state as to_state'])
      .where('links.from_id', '=', v.id)
      .execute();
    const links = [];
    for (const { to_record, ...l } of rawLinks) {
      links.push({ ...l, to_current: to_record !== null && l.to_n !== null && (await currentOf(db, to_record)) === l.to_n });
    }
    const origin = await originExploration(db, v.id);
    // Inferred questions of the origin thread: the UI shows them as a readiness warning (◐).
    const inferred = origin
      ? await db
          .selectFrom('questions')
          .select(['id', 'question', 'conclusion'])
          .where('exploration_id', '=', origin)
          .where('state', '=', 'inferred')
          .orderBy('created_at')
          .execute()
      : [];
    detail.push({
      id: v.id,
      n: v.n,
      state: v.state,
      epistemic_status: epistemicOfVersion(v.state),
      current: v.n === current,
      title: v.title,
      sections: v.sections,
      annexes: v.annexes,
      change_note: v.change_note,
      origin: v.origin,
      author: v.author,
      approved_by: v.approved_by,
      created_at: v.created_at,
      approved_at: v.approved_at,
      origin_exploration: origin,
      inferred_questions: inferred,
      practice_sources: (v.practice_sources ?? []) as unknown[],
      // A design system's machine-readable part and its advisory warnings (null / empty for other records).
      spec: v.spec ?? null,
      warnings: v.spec ? designSystemWarnings(v.spec as DesignSystemSpec) : [],
      criteria: await Promise.all(
        criteria.map(async (c) => {
          const evidence = await evidenceOf(db, c.id);
          const covering = delivery && v.n === current ? delivery.tasks.filter((t) => t.covers.includes(c.code)) : [];
          return {
            id: c.id,
            code: c.code,
            title: c.title,
            statement: c.statement,
            verification: c.verification,
            check: c.check_text,
            step: c.step,
            carry: c.carry,
            given: c.given_text ?? null,
            when: c.when_text ?? null,
            then: c.then_text ?? null,
            evidence,
            evidence_result: evidence?.result ?? null,
            state: criterionState({ verification: c.verification, evidence, tasks: covering.map((t) => t.build) }),
          };
        }),
      ),
      links,
      readiness: WITHOUT_READINESS.has(r.type) ? null : await versionReadiness(db, projectId, v.id),
    });
  }
  const implementation = await implementationOf(db, r.id);
  const currentDetail = detail.find((d) => d.current);
  return {
    id: r.id,
    code: r.code,
    type: r.type,
    domain: r.domain,
    aspect: r.aspect,
    current,
    implementation,
    size: r.type === 'fdr' || r.type === 'task' ? await latestSize(db, r.id) : null,
    ...(r.type === 'task' ? { build: await taskBuildOf(db, projectId, r.id, implementation === 'implemented') } : {}),
    ...(delivery
      ? {
          tasks: delivery.tasks,
          task_drafts: taskDrafts,
          uncovered: currentDetail ? currentDetail.criteria.filter((c) => !delivery.covered.has(c.code)).map((c) => c.code) : [],
          dod: currentDetail
            ? featureDone({
                criteria: currentDetail.criteria.map((c) => ({ code: c.code, state: c.state })),
                tasks: delivery.tasks.filter((t) => !t.dropped).map((t) => ({ code: t.code, state: t.build })),
                uncovered: currentDetail.criteria.filter((c) => !delivery.covered.has(c.code)).map((c) => c.code),
              })
            : null,
        }
      : {}),
    // A task's effort size, outside its versions (FDR-DEL-006).
    effort: r.type === 'task' ? await taskSizeView(db, r.id) : null,
    covers: r.type === 'task' ? await taskCoversOf(db, r.id) : null,
    versions: detail,
    incoming: await incomingLinks(db, projectId, r.id, r.type),
  };
}

/**
 * The tasks the task-planning agent proposed for a feature and nobody has decided yet: pending
 * design_record proposals of a task based on it. They are shown as drafts on the feature's page;
 * they come in a package, so they are accepted or rejected together (`batch_id`).
 */
async function taskDraftsOf(db: Db, projectId: string, code: string) {
  const rows = await db
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select(['proposals.id', 'proposals.batch_id', 'proposals.payload', 'proposal_batches.state as batch_state', 'proposal_batches.resolution_mode'])
    .where('proposals.project_id', '=', projectId)
    .where('proposals.type', '=', 'design_record')
    .where('proposals.state', '=', 'pending')
    .where('proposal_batches.state', '=', 'pending')
    .where(sql<boolean>`proposals.payload->>'record_type' = 'task'`)
    .where(sql<boolean>`proposals.payload->'based_on'->>'code' = ${code}`)
    .orderBy('proposal_batches.created_at')
    .orderBy('proposals.position')
    .execute();
  return rows.map((p) => {
    const payload = p.payload as { title?: string; size?: string; covers?: string[] };
    return {
      proposal_id: p.id,
      batch_id: p.batch_id,
      resolution: p.resolution_mode,
      title: payload.title ?? '',
      size: payload.size ?? null,
      covers: payload.covers ?? [],
    };
  });
}

/** The latest size of a record (task or feature), or null. */
async function latestSize(db: Db, recordId: string): Promise<string | null> {
  const row = await db
    .selectFrom('task_sizes')
    .select('size')
    .where('record_id', '=', recordId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return row?.size ?? null;
}

type BuildRequestRow = { task_id: string; state: string; pr_url: string | null };

/** The request that says where a task is: the open one, else the latest done, else none. */
function requestOf(rows: readonly BuildRequestRow[]): BuildRequestRow | null {
  return (
    rows.find((r) => r.state === 'requested' || r.state === 'in_review') ?? rows.find((r) => r.state === 'done') ?? null
  );
}

/** Build requests of the given tasks, newest first, grouped by task. */
async function requestsByTask(db: Db, taskIds: string[]): Promise<Map<string, BuildRequestRow[]>> {
  const out = new Map<string, BuildRequestRow[]>();
  if (taskIds.length === 0) return out;
  const rows = await db
    .selectFrom('build_requests')
    .select(['task_id', 'state', 'pr_url'])
    .where('task_id', 'in', taskIds)
    .orderBy('requested_at', 'desc')
    .execute();
  for (const r of rows) out.set(r.task_id, [...(out.get(r.task_id) ?? []), r]);
  return out;
}

/** Codes of the criteria of a feature's current version whose latest evidence failed. */
async function failingCodesOf(db: Db, featureRecordId: string): Promise<Set<string>> {
  const n = await currentOf(db, featureRecordId);
  const out = new Set<string>();
  if (n === null) return out;
  const criteria = await db
    .selectFrom('criteria')
    .innerJoin('record_versions as v', 'v.id', 'criteria.record_version_id')
    .select(['criteria.id', 'criteria.code'])
    .where('v.record_id', '=', featureRecordId)
    .where('v.n', '=', n)
    .execute();
  for (const c of criteria) if ((await evidenceOf(db, c.id))?.result === 'fail') out.add(c.code);
  return out;
}

/** The feature record a task is based on (through its shown version), or null. */
async function featureRecordOfTask(db: Db, taskId: string): Promise<string | null> {
  const v = await db
    .selectFrom('record_versions')
    .select(['id', 'state'])
    .where('record_id', '=', taskId)
    .orderBy(sql`(state = 'approved')`, 'desc')
    .orderBy('n', 'desc')
    .executeTakeFirst();
  if (!v) return null;
  const f = await db
    .selectFrom('links')
    .innerJoin('record_versions as t', 't.id', 'links.to_id')
    .innerJoin('records as rd', 'rd.id', 't.record_id')
    .select('rd.id')
    .where('links.from_id', '=', v.id)
    .where('links.type', '=', 'based_on')
    .where('rd.type', '=', 'fdr')
    .executeTakeFirst();
  return f?.id ?? null;
}

/** A task's computed build state and the request behind it. */
async function taskBuildOf(db: Db, projectId: string, taskId: string, implemented: boolean) {
  const request = requestOf((await requestsByTask(db, [taskId])).get(taskId) ?? []);
  const feature = await featureRecordOfTask(db, taskId);
  const covers = await taskCoversOf(db, taskId);
  const failing = feature ? await failingCodesOf(db, feature) : new Set<string>();
  const state: TaskBuildState = taskBuildState({
    request,
    implemented,
    coveredFailing: covers.some((c) => failing.has(c)),
  });
  // The automatic build (builder agent, pull request, CI, reviewer agent, merge): the open request's, else the latest's.
  const latest = (
    await db
      .selectFrom('build_requests')
      .select(['id', 'pr_url', 'branch'])
      .where('project_id', '=', projectId)
      .where('task_id', '=', taskId)
      .orderBy('requested_at', 'desc')
      .orderBy('id', 'desc')
      .execute()
  )[0];
  const steps = latest
    ? await db
        .selectFrom('build_steps')
        .select(['attempt', 'stage', 'outcome', 'detail', 'created_at'])
        .where('build_request_id', '=', latest.id)
        .orderBy('attempt')
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    : [];
  const review = latest
    ? await db
        .selectFrom('pr_reviews')
        .select(['verdict', 'summary', 'comments'])
        .where('build_request_id', '=', latest.id)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst()
    : undefined;
  return {
    state,
    request: request ? { state: request.state, pr_url: request.pr_url } : null,
    steps: steps.map((x) => ({
      attempt: x.attempt,
      stage: x.stage,
      outcome: x.outcome,
      detail: x.detail,
      at: new Date(x.created_at as unknown as Date).toISOString(),
    })),
    pr_url: latest?.pr_url ?? null,
    branch: latest?.branch ?? null,
    review: review
      ? { verdict: review.verdict, summary: review.summary, comments_count: (review.comments as unknown[]).length }
      : null,
    github: githubConfig() !== null,
  };
}

/**
 * The tasks of a feature: task records whose shown version (the current one, else the latest) is
 * based on any version of it, with size, covers and computed build state, and the criterion codes
 * of its current version that they cover.
 */
async function featureDelivery(db: Db, projectId: string, featureId: string, featureCurrent: number | null) {
  const rows = await db
    .selectFrom('links')
    .innerJoin('record_versions as tv', 'tv.id', 'links.from_id')
    .innerJoin('records as task', 'task.id', 'tv.record_id')
    .innerJoin('record_versions as fv', 'fv.id', 'links.to_id')
    .select(['task.id', 'task.code', 'tv.n', 'tv.title', 'tv.state'])
    .where('links.type', '=', 'based_on')
    .where('fv.record_id', '=', featureId)
    .where('task.type', '=', 'task')
    .where('task.project_id', '=', projectId)
    .execute();
  // Shown version per task: the highest approved, else the highest of any state.
  const shown = new Map<string, (typeof rows)[number]>();
  for (const t of rows) {
    const seen = shown.get(t.id);
    const rank = (x: { n: number; state: string }) => (x.state === 'approved' ? 1_000_000 : 0) + x.n;
    if (!seen || rank(t) > rank(seen)) shown.set(t.id, t);
  }
  const tasks = [...shown.values()].sort((a, b) => a.code.localeCompare(b.code));
  const ids = tasks.map((t) => t.id);
  const requests = await requestsByTask(db, ids);
  const failing = featureCurrent === null ? new Set<string>() : await failingCodesOf(db, featureId);
  const out = [];
  const covered = new Set<string>();
  for (const t of tasks) {
    const covers = await taskCoversOf(db, t.id);
    for (const c of covers) covered.add(c);
    const build = taskBuildState({
      request: requestOf(requests.get(t.id) ?? []),
      implemented: (await implementationOf(db, t.id)) === 'implemented',
      coveredFailing: covers.some((c) => failing.has(c)),
    });
    out.push({ code: t.code, title: t.title, size: await latestSize(db, t.id), covers, build });
  }
  return { tasks: out as { code: string; title: string; size: string | null; covers: string[]; build: TaskBuildState; dropped?: boolean }[], covered };
}

/**
 * What connects to a record (FDR-INT-002): the links that other records' shown version (the
 * current one, or the latest if none is approved) points at any of its versions. A link that a
 * newer version of the other record dropped no longer connects. Each says the relation the map
 * draws for it (needs, follows, conflicts, affects), or null for links the map doesn't draw.
 */
async function incomingLinks(db: Db, projectId: string, recordId: string, recordType: string) {
  const rows = await db
    .selectFrom('links')
    .innerJoin('record_versions as f', 'f.id', 'links.from_id')
    .innerJoin('records as fr', 'fr.id', 'f.record_id')
    .innerJoin('record_versions as t', 't.id', 'links.to_id')
    .select([
      'links.id',
      'links.type',
      'links.state',
      'fr.id as from_record',
      'fr.code as from_code',
      'fr.type as from_type',
      'f.n as from_n',
      'f.title as from_title',
      't.n as to_n',
    ])
    .where('links.project_id', '=', projectId)
    .where('t.record_id', '=', recordId)
    .where('fr.id', '<>', recordId)
    .orderBy('fr.code')
    .orderBy('links.id')
    .execute();
  const shown = new Map<string, number>();
  for (const id of new Set(rows.map((l) => l.from_record))) {
    const latest = await db
      .selectFrom('record_versions')
      .select('n')
      .where('record_id', '=', id)
      .orderBy('n', 'desc')
      .executeTakeFirstOrThrow();
    shown.set(id, (await currentOf(db, id)) ?? latest.n);
  }
  return rows
    .filter((l) => shown.get(l.from_record) === l.from_n)
    .map(({ from_record: _r, ...l }) => ({ ...l, relation: relationOf(l.type, l.from_type, recordType) }));
}

/** First paragraph of the first section with content, as plain text: the card's one line. */
export function firstParagraph(sections: readonly { title: string; content: string }[], max = 240): string {
  const text = sections.find((x) => x.content.trim() !== '')?.content ?? '';
  const paragraph = text.split(/\n\s*\n/).find((x) => x.trim() !== '') ?? '';
  const plain = paragraph
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export async function productState(db: Db, projectId: string) {
  const project = await db.selectFrom('projects').select(['id', 'name', 'state']).where('id', '=', projectId).executeTakeFirst();
  if (!project) throw new DomainError('not_found', 'The project does not exist.');
  const records = await db.selectFrom('records').selectAll().where('project_id', '=', projectId).orderBy('code').execute();
  const epicPositions = await epicOrder(db, projectId);
  const rows = [];
  for (const r of records) {
    const latest = await db
      .selectFrom('record_versions')
      .select(['id', 'n', 'state', 'title', 'sections', 'author', 'approved_by', 'created_at', 'approved_at'])
      .where('record_id', '=', r.id)
      .orderBy('n', 'desc')
      .executeTakeFirstOrThrow();
    const checks = await db
      .selectFrom('criteria')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('record_version_id', '=', latest.id)
      .executeTakeFirstOrThrow();
    const current = await currentOf(db, r.id);
    const currentId =
      current === null
        ? null
        : (
            await db
              .selectFrom('record_versions')
              .select('id')
              .where('record_id', '=', r.id)
              .where('n', '=', current)
              .executeTakeFirstOrThrow()
          ).id;
    rows.push({
      id: r.id,
      code: r.code,
      type: r.type,
      domain: r.domain,
      aspect: r.aspect,
      title: latest.title,
      current,
      latest: { n: latest.n, state: latest.state },
      epistemic_status: current !== null ? 'confirmed' : epistemicOfVersion(latest.state),
      readiness: WITHOUT_READINESS.has(r.type) ? null : await versionReadiness(db, projectId, currentId ?? latest.id),
      implementation: await implementationOf(db, r.id),
      // The person's order of the epics (the ranked backlog); null for any other record.
      epic_position: r.type === 'epic' ? (epicPositions.get(r.id) ?? null) : null,
      ...(await basisOf(db, currentId ?? latest.id, r.type as RecordType)),
      summary: firstParagraph(latest.sections as { title: string; content: string }[]),
      checks: Number(checks.n),
      effort: r.type === 'task' ? await taskSizeView(db, r.id) : null,
      covers: r.type === 'task' ? await taskCoversOf(db, r.id) : null,
      latest_id: latest.id,
      current_id: currentId,
      updated_at: latest.approved_at ?? latest.created_at,
      updated_by: latest.approved_by ?? latest.author,
      origin_exploration: await originExploration(db, latest.id),
    });
  }
  const explorations = await db
    .selectFrom('explorations')
    .select(['id', 'purpose', 'state', 'parent_id', 'origin_type', 'origin_id'])
    .where('project_id', '=', projectId)
    .orderBy('created_at')
    .execute();
  const open = await db
    .selectFrom('questions')
    .select(['exploration_id', (eb) => eb.fn.countAll<string>().as('n')])
    .where('project_id', '=', projectId)
    .where('state', 'in', ['pending', 'postponed', 'inferred'])
    .groupBy('exploration_id')
    .execute();
  const b = await inbox(db, projectId);
  // The features each epic lists, in order: planned (only the name and a sentence) or designed.
  const planned = await db
    .selectFrom('planned_features')
    .innerJoin('records as epic', 'epic.id', 'planned_features.epic_id')
    .select([
      'planned_features.id',
      'planned_features.code',
      'epic.code as epic_code',
      'planned_features.name',
      'planned_features.summary',
      'planned_features.position',
      'planned_features.state',
    ])
    .where('planned_features.project_id', '=', projectId)
    .where('planned_features.state', '<>', 'dropped')
    .orderBy('epic.code')
    .orderBy('planned_features.position')
    .execute();
  return {
    project: { id: project.id, name: project.name, state: project.state },
    planned,
    decisions: rows.filter((f) => f.type === 'decision'),
    // The project's design system (DSY), if it has one: the same row as in `designs`.
    design_system: rows.find((f) => f.type === 'design_system') ?? null,
    // The product definition is not a design to build: it has its own place (productDefinition).
    designs: rows.filter((f) => !WITHOUT_READINESS.has(f.type)),
    ready_to_build: rows.filter((f) => f.readiness?.ready).map((f) => f.code),
    explorations: explorations.map((e) => ({
      ...e,
      open_questions: Number(open.find((a) => a.exploration_id === e.id)?.n ?? 0),
    })),
    inbox: { total: b.total },
  };
}

export async function explorationDetail(db: Db, projectId: string, id: string) {
  const e = await db
    .selectFrom('explorations')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!e) throw new DomainError('not_found', 'The exploration does not exist.');
  const messages = await db
    .selectFrom('messages')
    .selectAll()
    .where('exploration_id', '=', id)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const questions = await db.selectFrom('questions').selectAll().where('exploration_id', '=', id).orderBy('created_at').execute();
  const children = await db.selectFrom('explorations').select(['id', 'purpose', 'state']).where('parent_id', '=', id).execute();
  return {
    ...e,
    messages: messages.map((m) => ({
      ...m,
      epistemic_status: m.author.startsWith('human:') ? null : epistemicOfObservation(m.kind),
    })),
    questions: questions.map((q) => ({ ...q, epistemic_status: epistemicOfQuestion(q.state) })),
    children,
    // What its "Draft" button writes (an epic, a feature or its tasks), or null when nothing can be drafted here.
    draft: await threadDraft(db, projectId, e),
  };
}

export async function batchDetail(db: Db, projectId: string, id: string) {
  const l = await db
    .selectFrom('proposal_batches')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!l) throw new DomainError('not_found', 'The batch does not exist.');
  const proposals = await db.selectFrom('proposals').selectAll().where('batch_id', '=', id).orderBy('position').execute();
  const importCounts = l.kind === 'import' ? await importCountsOf(db, l.id, proposals) : null;
  const refs = l.kind === 'import' ? new Map<string, BasisRefs>() : await basisRefsOf(db, projectId, proposals);
  return {
    ...l,
    ...(importCounts ? { import_counts: importCounts } : {}),
    proposals: proposals.map((p) => ({
      ...p,
      epistemic_status: epistemicOfProposal(p.state),
      basis_refs: refs.get(p.id) ?? { messages: [], questions: [] },
    })),
  };
}

type Counts = Record<'decision' | 'adr' | 'fdr' | 'bug' | 'versions' | 'criteria' | 'links' | 'taxonomies' | 'annexes', number>;

/** Counts of an import: those of design/ when it was imported, and those of the proposals of the package. */
async function importCountsOf(db: Db, batchId: string, proposals: readonly { type: string; payload: unknown }[]) {
  const event = await db
    .selectFrom('events')
    .select('after')
    .where('entity_id', '=', batchId)
    .where('command', '=', 'design.import')
    .executeTakeFirst();
  const after = event?.after as { counts?: Counts } | null | undefined;
  const origin = after?.counts ?? null;
  const documents = proposals
    .filter((p) => p.type === 'imported_record')
    .map(
      (p) => (p.payload as { document: { type: string; criteria?: unknown[]; links?: unknown[]; annexes?: unknown[] } }).document,
    );
  const pkg: Counts = {
    decision: documents.filter((d) => d.type === 'decision').length,
    adr: documents.filter((d) => d.type === 'adr').length,
    fdr: documents.filter((d) => d.type === 'fdr').length,
    bug: documents.filter((d) => d.type === 'bug').length,
    versions: documents.length,
    criteria: documents.reduce((n, d) => n + (d.criteria?.length ?? 0), 0),
    links: documents.reduce((n, d) => n + (d.links?.length ?? 0), 0),
    taxonomies: proposals.filter((p) => p.type === 'imported_taxonomy').length,
    annexes: documents.reduce((n, d) => n + (d.annexes?.length ?? 0), 0),
  };
  return { origin, package: pkg };
}
