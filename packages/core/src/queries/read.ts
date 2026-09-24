// Read models for Pillar 1: product state, inbox, explorations, records with
// their readiness, and batches. These are derived functions: nothing is stored (§4 of the plan).

import {
  type Dependency,
  type ReadinessInput,
  DomainError,
  type Readiness,
  type RecordType,
  epistemicOfObservation,
  epistemicOfQuestion,
  epistemicOfProposal,
  epistemicOfVersion,
  readiness,
} from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { staleDependencies } from '../commands/proposals.ts';

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
    .select(['code', 'verification', 'check_text', 'statement'])
    .where('record_version_id', '=', versionId)
    .orderBy('position')
    .execute();
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
  const linksUnderReview: string[] = [];
  for (const e of links) {
    if (e.type === 'based_on' && e.targetType === 'decision') {
      basedOn.push({
        code: e.code,
        version: e.n,
        versionState: e.targetState,
        current: await currentOf(db, e.recordId),
        linkState: e.state,
      });
    } else if (e.state === 'needs_review') {
      linksUnderReview.push(`${e.code} v${e.n}`);
    }
  }
  const origin = await originExploration(db, versionId);
  const openQuestions = origin
    ? await db
        .selectFrom('questions')
        .select(['question as question', 'state as state'])
        .where('exploration_id', '=', origin)
        .where('state', 'in', ['pending', 'postponed'])
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
  return readiness({
    code: v.code,
    type: v.type as RecordType,
    version: { n: v.n, state: v.state },
    current: await currentOf(db, v.recordId),
    criteria: criteria.map((c) => ({
      code: c.code,
      verification: c.verification,
      check: c.check_text,
      statement: c.statement,
    })),
    basedOn,
    linksUnderReview,
    openQuestions,
    pendingProposals,
  });
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
      .orderBy('position')
      .execute();
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
        assessment: await assessmentOf(db, p.id),
        dependencies: (p.dependencies ?? []) as Dependency[],
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
    .select(['id', 'exploration_id', 'question', 'state', 'conclusion', 'reasoning', 'raised_by'])
    .where('project_id', '=', projectId)
    .where('state', '=', 'inferred')
    .orderBy('created_at')
    .execute();
  // What is waiting for the person even when it doesn't come from an agent: open questions and unapproved drafts.
  const open = await db
    .selectFrom('questions')
    .select(['id', 'exploration_id', 'question', 'state', 'state_reason', 'raised_by'])
    .where('project_id', '=', projectId)
    .where('state', 'in', ['pending', 'postponed'])
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
  const detail = [];
  for (const v of versions) {
    const criteria = await db
      .selectFrom('criteria')
      .selectAll()
      .where('record_version_id', '=', v.id)
      .orderBy('position')
      .execute();
    const links = await db.selectFrom('links').selectAll().where('from_id', '=', v.id).execute();
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
      criteria: criteria.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        statement: c.statement,
        verification: c.verification,
        check: c.check_text,
        carry: c.carry,
      })),
      links,
      readiness: r.type === 'decision' ? null : await versionReadiness(db, projectId, v.id),
    });
  }
  return {
    id: r.id,
    code: r.code,
    type: r.type,
    domain: r.domain,
    current,
    implementation: 'not implemented',
    versions: detail,
  };
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
      code: r.code,
      type: r.type,
      domain: r.domain,
      title: latest.title,
      current,
      latest: { n: latest.n, state: latest.state },
      epistemic_status: current !== null ? 'confirmed' : epistemicOfVersion(latest.state),
      readiness: r.type === 'decision' ? null : await versionReadiness(db, projectId, currentId ?? latest.id),
      implementation: 'not implemented',
      summary: firstParagraph(latest.sections as { title: string; content: string }[]),
      checks: Number(checks.n),
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
  return {
    project: { id: project.id, name: project.name, state: project.state },
    decisions: rows.filter((f) => f.type === 'decision'),
    designs: rows.filter((f) => f.type !== 'decision'),
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
  return {
    ...l,
    ...(importCounts ? { import_counts: importCounts } : {}),
    proposals: proposals.map((p) => ({ ...p, epistemic_status: epistemicOfProposal(p.state) })),
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
