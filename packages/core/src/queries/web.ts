// Read-only queries of the web UI (H1): lists of threads and runs, and the derived knowledge as
// the UI shows it (graph by taxonomy area, idea assessments with their citation, taxonomies).
// Derived functions: nothing is stored.

import { DomainError } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { originExploration } from './read.ts';

/** Threads with their open questions and their last activity. */
export async function explorationsList(db: Db, projectId: string) {
  const explorations = await db
    .selectFrom('explorations')
    .selectAll()
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
  const last = await db
    .selectFrom('messages')
    .select(['exploration_id', (eb) => eb.fn.max('created_at').as('at')])
    .where('project_id', '=', projectId)
    .groupBy('exploration_id')
    .execute();
  return explorations.map((e) => {
    const message = last.find((m) => m.exploration_id === e.id)?.at as Date | string | undefined;
    return {
      ...e,
      open_questions: Number(open.find((q) => q.exploration_id === e.id)?.n ?? 0),
      last_activity: message ?? e.created_at,
    };
  });
}

/**
 * Runs of the project, newest first. Each one says which thread it belongs to: a conversation by
 * its scope; a draft by the thread where its decision was born. Filters: thread and state.
 */
export async function runsList(db: Db, projectId: string, filter: { exploration?: string; state?: string } = {}) {
  let query = db
    .selectFrom('ai_runs')
    .leftJoin('context_packs', 'context_packs.id', 'ai_runs.context_pack_id')
    .select([
      'ai_runs.id',
      'ai_runs.state',
      'ai_runs.action',
      'ai_runs.scope',
      'ai_runs.provider',
      'ai_runs.model',
      'ai_runs.retry_of',
      'ai_runs.failure_kind',
      'ai_runs.error',
      'ai_runs.requested_by',
      'ai_runs.created_at',
      'ai_runs.started_at',
      'ai_runs.finished_at',
      'context_packs.hash as context_pack_hash',
    ])
    .where('ai_runs.project_id', '=', projectId)
    .orderBy('ai_runs.created_at', 'desc')
    .limit(500);
  if (filter.state) query = query.where('ai_runs.state', '=', filter.state);
  const runs = await query.execute();
  const batches = await db
    .selectFrom('proposal_batches')
    .select(['id', 'run_id'])
    .where('project_id', '=', projectId)
    .where('run_id', 'is not', null)
    .execute();
  const origins = new Map<string, string | null>();
  const rows = [];
  for (const r of runs) {
    const scope = r.scope as { type: string; id?: string };
    let exploration: string | null = null;
    if (scope.type === 'exploration') exploration = scope.id ?? null;
    else if (scope.type === 'record_version' && scope.id) {
      if (!origins.has(scope.id)) origins.set(scope.id, await originExploration(db, scope.id));
      exploration = origins.get(scope.id) ?? null;
    }
    if (filter.exploration && exploration !== filter.exploration) continue;
    rows.push({ ...r, exploration_id: exploration, batch_id: batches.find((b) => b.run_id === r.id)?.id ?? null });
  }
  return rows;
}

/** Code and version of the record a node comes from (records and their criteria). */
async function recordsOfNodes(db: Db, projectId: string) {
  const rows = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['record_versions.id', 'records.code', 'record_versions.n'])
    .where('records.project_id', '=', projectId)
    .execute();
  const criteria = await db
    .selectFrom('criteria')
    .select(['id', 'record_version_id'])
    .where('project_id', '=', projectId)
    .execute();
  const byVersion = new Map(rows.map((r) => [r.id, { code: r.code, version: r.n }]));
  const byCriterion = new Map(criteria.map((c) => [c.id, byVersion.get(c.record_version_id) ?? null]));
  return (source: { type: string; id: string | null }) => {
    if (!source.id) return null;
    if (source.type === 'record_version') return byVersion.get(source.id) ?? null;
    if (source.type === 'criterion') return byCriterion.get(source.id) ?? null;
    return null;
  };
}

/** Current nodes and edges (and the invalidated nodes, greyed out in the UI), with their taxonomy area. */
export async function knowledgeGraph(db: Db, projectId: string) {
  const state = await db
    .selectFrom('knowledge_graph_state')
    .select('version')
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  const nodes = await db
    .selectFrom('knowledge_nodes')
    .selectAll()
    .where('project_id', '=', projectId)
    .orderBy('ref')
    .orderBy('valid_from', 'desc')
    .execute();
  // One row per reference: the current one, or the latest invalidated one if none is current.
  const chosen = new Map<string, (typeof nodes)[number]>();
  for (const n of nodes) {
    const prior = chosen.get(n.ref);
    if (!prior || (prior.valid_to !== null && n.valid_to === null)) chosen.set(n.ref, n);
  }
  const recordOf = await recordsOfNodes(db, projectId);
  const refById = new Map(nodes.map((n) => [n.id, n.ref]));
  const edges = await db
    .selectFrom('knowledge_edges')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('valid_to', 'is', null)
    .orderBy('id')
    .execute();
  return {
    graph_version: Number(state?.version ?? 0),
    nodes: [...chosen.values()].map((n) => ({
      ref: n.ref,
      type: n.kind,
      label: n.label,
      excerpt: n.body.slice(0, 400),
      epistemic_status: n.epistemic,
      areas: (n.categories ?? {}) as Record<string, string>,
      state: n.valid_to === null ? 'current' : 'invalidated',
      record: recordOf({ type: n.source_type, id: n.source_id }),
    })),
    edges: edges.map((e) => ({
      type: e.kind,
      from: refById.get(e.from_node) ?? '',
      to: refById.get(e.to_node) ?? '',
      state: e.state,
    })),
  };
}

type Finding = { finding: string; citation: string; epistemic_status?: string; confidence?: number; justification?: string };

/** Idea assessments, newest first: the verdict of each finding and the node or record it cites. */
export async function ideaAssessments(db: Db, projectId: string) {
  const rows = await db
    .selectFrom('idea_assessments')
    .innerJoin('proposals', 'proposals.id', 'idea_assessments.proposal_id')
    .select([
      'idea_assessments.id',
      'idea_assessments.findings',
      'idea_assessments.graph_version',
      'idea_assessments.classifier',
      'idea_assessments.created_at',
      'proposals.id as proposal_id',
      'proposals.type as proposal_type',
      'proposals.payload',
      'proposals.batch_id',
      'proposals.state as proposal_state',
    ])
    .where('idea_assessments.project_id', '=', projectId)
    .orderBy('idea_assessments.created_at', 'desc')
    .execute();
  const nodes = await db
    .selectFrom('knowledge_nodes')
    .select(['ref', 'label', 'source_type', 'source_id'])
    .where('project_id', '=', projectId)
    .execute();
  const recordOf = await recordsOfNodes(db, projectId);
  const nodeOf = new Map(nodes.map((n) => [n.ref, n]));
  return rows.map((r) => {
    const stored = (Array.isArray(r.findings) ? { findings: r.findings } : r.findings) as {
      findings?: Finding[];
      error?: string | null;
    };
    const payload = r.payload as Record<string, unknown>;
    return {
      id: r.id,
      graph_version: Number(r.graph_version),
      classifier: r.classifier,
      created_at: r.created_at,
      error: stored.error ?? null,
      proposal: {
        id: r.proposal_id,
        type: r.proposal_type,
        title: typeof payload.title === 'string' ? payload.title : typeof payload.purpose === 'string' ? payload.purpose : null,
        batch_id: r.batch_id,
        state: r.proposal_state,
      },
      findings: (stored.findings ?? []).map((f) => {
        const node = nodeOf.get(f.citation);
        return {
          verdict: f.finding,
          citation: f.citation,
          label: node?.label ?? null,
          record: node ? recordOf({ type: node.source_type, id: node.source_id }) : null,
          epistemic_status: f.epistemic_status ?? null,
          confidence: f.confidence ?? null,
          justification: f.justification ?? null,
        };
      }),
    };
  });
}

/** Taxonomies of the project with their state and their content. */
export async function taxonomiesList(db: Db, projectId: string) {
  const project = await db.selectFrom('projects').select('id').where('id', '=', projectId).executeTakeFirst();
  if (!project) throw new DomainError('not_found', 'The project does not exist.');
  return db
    .selectFrom('taxonomies')
    .select(['id', 'code', 'version', 'title', 'axes', 'sections', 'state', 'author', 'created_at', 'approved_at', 'approved_by'])
    .where('project_id', '=', projectId)
    .orderBy('code')
    .orderBy('version', 'desc')
    .execute();
}

type Subject = {
  kind: 'record' | 'exploration' | 'batch' | 'knowledge' | 'project';
  key: string;
  title: string | null;
  record_type?: string;
};

const KNOWLEDGE_ENTITIES = new Set([
  'knowledge_update',
  'knowledge_node',
  'knowledge_edge',
  'classification',
  'idea_assessment',
  'taxonomy',
  'context_pack',
]);

/**
 * "What changed" since an event id: the events after it grouped by the thing they touch (a record,
 * a thread, a batch, the knowledge or the project), in order of first appearance, and the latest
 * id, which the UI remembers as the person's last visit.
 */
export async function changesSince(db: Db, projectId: string, since: string) {
  const events = await db
    .selectFrom('events')
    .select([
      'id',
      'at',
      'actor',
      'command',
      'entity_type',
      'entity_id',
      'entity_version',
      'state_before',
      'state_after',
      'after',
    ])
    .where('project_id', '=', projectId)
    .where('id', '>', since)
    .orderBy('id')
    .limit(5000)
    .execute();
  const records = new Map<string, Subject>();
  const recordSubject = async (recordId: string): Promise<Subject> => {
    const known = records.get(recordId);
    if (known) return known;
    const r = await db.selectFrom('records').select(['code', 'type']).where('id', '=', recordId).executeTakeFirst();
    const latest = await db
      .selectFrom('record_versions')
      .select('title')
      .where('record_id', '=', recordId)
      .orderBy('n', 'desc')
      .executeTakeFirst();
    const s: Subject = {
      kind: 'record',
      key: r?.code ?? recordId,
      title: latest?.title ?? null,
      record_type: r?.type ?? 'unknown',
    };
    records.set(recordId, s);
    return s;
  };
  const versionRecord = async (versionId: string) =>
    (await db.selectFrom('record_versions').select('record_id').where('id', '=', versionId).executeTakeFirst())?.record_id ??
    null;
  const explorations = new Map<string, Subject>();
  const explorationSubject = async (id: string): Promise<Subject> => {
    const known = explorations.get(id);
    if (known) return known;
    const e = await db.selectFrom('explorations').select('purpose').where('id', '=', id).executeTakeFirst();
    const s: Subject = { kind: 'exploration', key: id, title: e?.purpose ?? null };
    explorations.set(id, s);
    return s;
  };
  const project: Subject = { kind: 'project', key: projectId, title: null };
  const knowledge: Subject = { kind: 'knowledge', key: 'knowledge', title: null };

  const subjectOf = async (e: (typeof events)[number]): Promise<Subject> => {
    const id = e.entity_id;
    switch (e.entity_type) {
      case 'record':
        return recordSubject(id);
      case 'record_version': {
        const r = await versionRecord(id);
        return r ? recordSubject(r) : project;
      }
      case 'criterion': {
        const c = await db.selectFrom('criteria').select('record_version_id').where('id', '=', id).executeTakeFirst();
        const r = c ? await versionRecord(c.record_version_id) : null;
        return r ? recordSubject(r) : project;
      }
      case 'link': {
        const l = await db.selectFrom('links').select('from_id').where('id', '=', id).executeTakeFirst();
        const r = l ? await versionRecord(l.from_id) : null;
        return r ? recordSubject(r) : project;
      }
      case 'exploration':
        return explorationSubject(id);
      case 'question':
      case 'message': {
        const table = e.entity_type === 'question' ? 'questions' : 'messages';
        const row = await db.selectFrom(table).select('exploration_id').where('id', '=', id).executeTakeFirst();
        return row ? explorationSubject(row.exploration_id) : project;
      }
      case 'ai_run': {
        const run = await db.selectFrom('ai_runs').select('scope').where('id', '=', id).executeTakeFirst();
        const scope = run?.scope as { type: string; id?: string } | undefined;
        if (scope?.type === 'exploration' && scope.id) return explorationSubject(scope.id);
        if (scope?.type === 'record_version' && scope.id) {
          const origin = await originExploration(db, scope.id);
          if (origin) return explorationSubject(origin);
        }
        return project;
      }
      case 'batch':
      case 'proposal': {
        const batchId =
          e.entity_type === 'batch'
            ? id
            : (await db.selectFrom('proposals').select('batch_id').where('id', '=', id).executeTakeFirst())?.batch_id;
        if (!batchId) return project;
        const b = await db
          .selectFrom('proposal_batches')
          .select(['summary', 'kind'])
          .where('id', '=', batchId)
          .executeTakeFirst();
        return { kind: 'batch', key: batchId, title: b?.summary ?? null, record_type: b?.kind ?? 'unknown' };
      }
      default:
        return KNOWLEDGE_ENTITIES.has(e.entity_type) ? knowledge : project;
    }
  };

  const things = new Map<string, Subject & { events: Omit<(typeof events)[number], 'after'>[] }>();
  for (const e of events) {
    const s = await subjectOf(e);
    const k = `${s.kind}:${s.key}`;
    const { after: _after, ...row } = e;
    const thing = things.get(k) ?? { ...s, events: [] };
    thing.events.push(row);
    things.set(k, thing);
  }
  return { latest: events.at(-1)?.id ?? since, things: [...things.values()] };
}
