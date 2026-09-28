// The trace of any entity (dev tools only): where it comes from, what it is, and which agent
// contexts read it. It follows the provenance that authority and the event log already keep
// (a version's origin, a proposal's batch and run, a run's pack and the message it answered, an
// inference's run and the person's words it rests on) so a person can check, from the app, that
// what the product shows is what was really decided. Read-only.

import { DomainError } from '@demiurgo/domain';
import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';

export const TRACE_TYPES = [
  'record',
  'record_version',
  'question',
  'message',
  'proposal',
  'batch',
  'run',
  'exploration',
] as const;
export type TraceType = (typeof TRACE_TYPES)[number];

/** One step of the origin chain; `depth` nests what a step comes from under it. */
export type TraceStep = {
  depth: number;
  type: TraceType | 'context_pack';
  id: string;
  label: string;
  actor: string | null;
  at: string | null;
  detail: string | null;
};

export type TraceReader = {
  pack_id: string;
  role: string;
  created_at: string;
  version: number | null;
  runs: { id: string; action: string; state: string }[];
};

export type Trace = {
  entity: { type: TraceType; id: string; row: Record<string, unknown> };
  origin: TraceStep[];
  events: {
    seq: number;
    at: string;
    actor: string;
    command: string;
    entity_type: string;
    state_before: string | null;
    state_after: string | null;
    after: unknown;
    cause: unknown;
  }[];
  /** Which context packs carried it. `tracked: false` when packs don't keep this kind of entity by id. */
  read_by: { tracked: boolean; packs: TraceReader[] };
};

const TABLES = {
  record: 'records',
  record_version: 'record_versions',
  question: 'questions',
  message: 'messages',
  proposal: 'proposals',
  batch: 'proposal_batches',
  run: 'ai_runs',
  exploration: 'explorations',
} as const;

const MAX_DEPTH = 8;
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : typeof d === 'string' ? d : null);
const short = (s: unknown, n = 160) => {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

async function rowOf(db: Db, projectId: string, type: TraceType, id: string) {
  return (await db
    .selectFrom(TABLES[type])
    .selectAll()
    .where('id', '=', id)
    .where('project_id', '=', projectId)
    .executeTakeFirst()) as Record<string, unknown> | undefined;
}

class Walker {
  readonly steps: TraceStep[] = [];
  private readonly seen = new Set<string>();
  private readonly db: Db;
  private readonly projectId: string;

  constructor(db: Db, projectId: string) {
    this.db = db;
    this.projectId = projectId;
  }

  private add(depth: number, step: Omit<TraceStep, 'depth'>): boolean {
    const key = `${step.type}:${step.id}`;
    if (this.seen.has(key) || depth > MAX_DEPTH) return false;
    this.seen.add(key);
    this.steps.push({ depth, ...step });
    return true;
  }

  private async eventOf(id: string, command: string) {
    return this.db
      .selectFrom('events')
      .select(['actor', 'at', 'after', 'cause'])
      .where('project_id', '=', this.projectId)
      .where('entity_id', '=', id)
      .where('command', '=', command)
      .orderBy('seq', 'desc')
      .executeTakeFirst();
  }

  async walk(type: TraceType, id: string, depth: number): Promise<void> {
    const row = await rowOf(this.db, this.projectId, type, id);
    if (!row) return;
    switch (type) {
      case 'record': {
        const latest = await this.db
          .selectFrom('record_versions')
          .select('id')
          .where('record_id', '=', id)
          .orderBy('n', 'desc')
          .executeTakeFirst();
        if (
          this.add(depth, {
            type,
            id,
            label: `${str(row.code)} (${str(row.type)})`,
            actor: null,
            at: iso(row.created_at),
            detail: null,
          }) &&
          latest
        )
          await this.walk('record_version', latest.id, depth + 1);
        return;
      }
      case 'record_version': {
        const approved = row.approved_by ? ` · approved by ${str(row.approved_by)}` : '';
        if (
          !this.add(depth, {
            type,
            id,
            label: `v${str(row.n)} ${short(row.title, 80)}`,
            actor: str(row.author ?? ''),
            at: iso(row.created_at),
            detail: `${str(row.state)}${approved}`,
          })
        )
          return;
        const origin = row.origin as { type?: string; id?: string } | null;
        if (origin?.type && origin.id && origin.type in TABLES) await this.walk(origin.type as TraceType, origin.id, depth + 1);
        return;
      }
      case 'proposal': {
        const payload = row.payload as {
          sources?: { section: string; question_id: string | null }[];
          title?: string;
          section?: string;
          evidence?: { message_id: string; quote: string }[];
        };
        const title = payload.title ?? payload.section;
        if (
          !this.add(depth, {
            type,
            id,
            label: `${str(row.type)} proposal${title ? `: ${short(title, 80)}` : ''}`,
            actor: str(row.resolved_by ?? ''),
            at: iso(row.created_at),
            detail: str(row.state),
          })
        )
          return;
        await this.walk('batch', str(row.batch_id), depth + 1);
        // The product definition: each section comes from one question of the stage.
        for (const s of payload.sources ?? []) if (s.question_id) await this.walk('question', s.question_id, depth + 1);
        // A change proposed in a thread rests on the person's words there.
        for (const ev of payload.evidence ?? []) await this.walk('message', ev.message_id, depth + 1);
        return;
      }
      case 'batch': {
        if (
          !this.add(depth, {
            type,
            id,
            label: `${str(row.kind)} batch by ${str(row.producer)}`,
            actor: str(row.producer),
            at: iso(row.created_at),
            detail: short(row.summary) || null,
          })
        )
          return;
        if (row.run_id) await this.walk('run', str(row.run_id), depth + 1);
        return;
      }
      case 'run': {
        if (
          !this.add(depth, {
            type,
            id,
            label: `${str(row.action)} run`,
            actor: str(row.requested_by ?? ''),
            at: iso(row.created_at),
            detail: str(row.state),
          })
        )
          return;
        if (row.context_pack_id) {
          const pack = await this.db
            .selectFrom('context_packs')
            .select(['id', 'role', 'hash', 'dependencies', 'created_at'])
            .where('id', '=', str(row.context_pack_id))
            .executeTakeFirst();
          if (pack)
            this.add(depth + 1, {
              type: 'context_pack',
              id: pack.id,
              label: `${pack.role} context pack`,
              actor: null,
              at: iso(pack.created_at),
              detail: `${(pack.dependencies as unknown[]).length} dependencies · ${pack.hash.slice(0, 12)}`,
            });
        }
        // The message the run answered, which is where the person's words come in.
        const requested = await this.eventOf(id, 'run.request');
        const answers = (requested?.after as { answers_message?: string } | null)?.answers_message;
        if (answers) await this.walk('message', answers, depth + 1);
        return;
      }
      case 'question': {
        if (
          !this.add(depth, {
            type,
            id,
            label: short(row.question, 120),
            actor: str(row.raised_by ?? ''),
            at: iso(row.created_at),
            detail: `${str(row.state)}${row.conclusion ? `: ${short(row.conclusion, 120)}` : ''}`,
          })
        )
          return;
        const settled = (await this.eventOf(id, 'question.confirm')) ?? (await this.eventOf(id, 'question.discard'));
        if (settled)
          this.steps.push({
            depth: depth + 1,
            type: 'question',
            id,
            label: 'settled by a person',
            actor: settled.actor,
            at: iso(settled.at),
            detail: short(
              (settled.after as { conclusion?: string; reason?: string } | null)?.conclusion ??
                (settled.after as { reason?: string } | null)?.reason ??
                '',
            ),
          });
        const inferred = await this.eventOf(id, 'question.infer');
        if (inferred) {
          const run = (inferred.cause as { run?: string } | null)?.run;
          this.steps.push({
            depth: depth + 1,
            type: 'question',
            id,
            label: 'inferred by DEMIURGO',
            actor: inferred.actor,
            at: iso(inferred.at),
            detail: short((inferred.after as { conclusion?: string } | null)?.conclusion),
          });
          for (const ev of (inferred.after as { evidence?: { message_id: string; quote: string }[] } | null)?.evidence ?? [])
            await this.walk('message', ev.message_id, depth + 2);
          if (run) await this.walk('run', run, depth + 2);
        }
        return;
      }
      case 'message': {
        if (
          !this.add(depth, {
            type,
            id,
            label: short(row.body, 160),
            actor: str(row.author ?? ''),
            at: iso(row.created_at),
            detail: row.kind ? str(row.kind) : null,
          })
        )
          return;
        if (row.run_id) await this.walk('run', str(row.run_id), depth + 1);
        return;
      }
      case 'exploration': {
        if (
          !this.add(depth, {
            type,
            id,
            label: short(row.purpose, 120),
            actor: str(row.opened_by ?? ''),
            at: iso(row.created_at),
            detail: str(row.state),
          })
        )
          return;
        if (row.origin_type && row.origin_id && str(row.origin_type) in TABLES)
          await this.walk(row.origin_type as TraceType, str(row.origin_id), depth + 1);
        return;
      }
    }
  }
}

async function readers(
  db: Db,
  projectId: string,
  type: TraceType,
  id: string,
  row: Record<string, unknown>,
): Promise<Trace['read_by']> {
  let packs: { id: string; role: string; created_at: unknown; dependencies: unknown }[] = [];
  let recordId: string | null = null;
  if (type === 'record' || type === 'record_version') {
    recordId = type === 'record' ? id : str(row.record_id);
    packs = await db
      .selectFrom('context_packs')
      .select(['id', 'role', 'created_at', 'dependencies'])
      .where('project_id', '=', projectId)
      .where(sql<boolean>`dependencies @> ${JSON.stringify([{ type: 'record', id: recordId }])}::jsonb`)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
    if (type === 'record_version') {
      const n = Number(row.n);
      packs = packs.filter((p) =>
        (p.dependencies as { id: string; version: number | null }[]).some((d) => d.id === recordId && d.version === n),
      );
    }
  } else if (type === 'question') {
    packs = await db
      .selectFrom('context_packs')
      .select(['id', 'role', 'created_at', 'dependencies'])
      .where('project_id', '=', projectId)
      .where(sql<boolean>`content -> 'questions' @> ${JSON.stringify([{ id }])}::jsonb`)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
  } else return { tracked: false, packs: [] };
  const runs = packs.length
    ? await db
        .selectFrom('ai_runs')
        .select(['id', 'action', 'state', 'context_pack_id'])
        .where(
          'context_pack_id',
          'in',
          packs.map((p) => p.id),
        )
        .execute()
    : [];
  return {
    tracked: true,
    packs: packs.map((p) => ({
      pack_id: p.id,
      role: p.role,
      created_at: iso(p.created_at) ?? '',
      version: recordId
        ? ((p.dependencies as { id: string; version: number | null }[]).find((d) => d.id === recordId)?.version ?? null)
        : null,
      runs: runs.filter((r) => r.context_pack_id === p.id).map((r) => ({ id: r.id, action: r.action, state: r.state })),
    })),
  };
}

export async function traceEntity(db: Db, projectId: string, type: string, id: string): Promise<Trace> {
  if (!(TRACE_TYPES as readonly string[]).includes(type))
    throw new DomainError('validation', `Nothing to trace of type "${type}".`);
  const t = type as TraceType;
  const row = await rowOf(db, projectId, t, id);
  if (!row) throw new DomainError('not_found', `There is no ${type} ${id} in this project.`);
  const walker = new Walker(db, projectId);
  await walker.walk(t, id, 0);
  const events = await db
    .selectFrom('events')
    .select(['seq', 'at', 'actor', 'command', 'entity_type', 'state_before', 'state_after', 'after', 'cause'])
    .where('project_id', '=', projectId)
    .where((eb) =>
      eb.or([eb('entity_id', '=', id), eb(sql<string>`cause->>'run'`, '=', id), eb(sql<string>`cause->>'proposal'`, '=', id)]),
    )
    .orderBy('seq')
    .limit(200)
    .execute();
  return {
    entity: { type: t, id, row },
    origin: walker.steps,
    events: events.map((e) => ({ ...e, seq: Number(e.seq), at: iso(e.at) ?? '' })),
    read_by: await readers(db, projectId, t, id, row),
  };
}
