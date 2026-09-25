// Human evaluations derived from commands (§11, §15.2), without asking anyone anything. Pure rules
// over `commands` and `journal_payloads`; idempotent by the unique key of `evaluations`
// (target, name, source, actor, time). Run at ingest for the commands a batch touched, and by
// `pnpm evidence derive` for every command.
//
// Payload names come from the core's handlers (packages/core/src/commands/proposals.ts, runs.ts,
// exploration.ts): `proposal.create` → after.batch; `proposal.accept_edited` → after.edit;
// `run.retry` → after.retry_of, after.override; `question.confirm` → before/after.conclusion.

import type { PoolClient } from 'pg';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === 'string' && RE_UUID.test(v) ? v.toLowerCase() : null);

export const DERIVED_COMMANDS = [
  'proposal.accept',
  'proposal.accept_edited',
  'proposal.reject',
  'run.retry',
  'question.confirm',
] as const;

type CommandRow = {
  trace_id: string;
  span_id: string;
  command: string;
  actor: string | null;
  entity_type: string | null;
  entity_id: string | null;
  state_before: string | null;
  outcome: string | null;
  started_at: Date;
  ended_at: Date | null;
  before: unknown;
  after: unknown;
};

export type DerivedEvaluation = {
  traceId: string;
  targetType: 'run';
  targetId: string;
  name: string;
  score: number;
  byActor: string;
  at: Date;
};

/** The run that produced a proposal: proposal → its `proposal.create` journal → batch → run. */
async function runOfProposal(client: PoolClient, proposalId: string): Promise<string | null> {
  const { rows } = await client.query<{ run_id: string | null }>(
    `select b.run_id
     from commands c
     join journal_payloads j on j.trace_id = c.trace_id and j.span_id = c.span_id
     join batches b on b.batch_id::text = j.after->>'batch'
     where c.command = 'proposal.create' and c.entity_id = $1
     limit 1`,
    [proposalId],
  );
  return uuid(rows[0]?.run_id);
}

/** The run that inferred a question: the last successful `question.infer` on it before `at`. */
async function runOfInference(client: PoolClient, questionId: string, at: Date): Promise<string | null> {
  const { rows } = await client.query<{ run: string | null }>(
    `select coalesce(c.cause_run::text, substring(c.actor from '^agent:run:(.{36})$')) as run
     from commands c
     where c.command = 'question.infer' and c.entity_type = 'question' and c.entity_id = $1
       and coalesce(c.outcome, 'ok') = 'ok' and c.started_at <= $2
     order by c.started_at desc
     limit 1`,
    [questionId, at],
  );
  return uuid(rows[0]?.run);
}

/** The rule of one command: what it says about a run, or nothing. */
export async function ruleFor(client: PoolClient, row: CommandRow): Promise<DerivedEvaluation | null> {
  if (row.outcome !== null && row.outcome !== 'ok') return null;
  const at = row.ended_at ?? row.started_at;
  const after = isObject(row.after) ? row.after : {};
  const before = isObject(row.before) ? row.before : {};
  const base = { traceId: row.trace_id, targetType: 'run' as const, byActor: row.actor ?? '', at };
  switch (row.command) {
    case 'proposal.accept':
    case 'proposal.accept_edited':
    case 'proposal.reject': {
      if (row.entity_id === null) return null;
      const run = await runOfProposal(client, row.entity_id);
      if (run === null) return null;
      if (row.command === 'proposal.reject') return { ...base, targetId: run, name: 'human.rejected', score: 0 };
      const edited = row.command === 'proposal.accept_edited' || after.edit !== undefined;
      return edited
        ? { ...base, targetId: run, name: 'human.accepted_edited', score: 0.5 }
        : { ...base, targetId: run, name: 'human.accepted', score: 1 };
    }
    case 'run.retry': {
      const original = uuid(after.retry_of);
      if (original === null) return null;
      const other = after.override !== undefined && after.override !== null;
      return { ...base, targetId: original, name: other ? 'human.retried_other_engine' : 'human.retried', score: 0 };
    }
    case 'question.confirm': {
      // Only an inferred question says something about a run. The payload of `question.confirm`
      // carries no run today (exploration.ts: { conclusion }), so the run is the one that applied the
      // last `question.infer` on that question (its `cause_run`, or its `agent:run:<id>` actor); a
      // payload that names it (`inferred_by`, `run_id`) wins when the core adds one.
      if (row.state_before !== 'inferred' || row.entity_id === null) return null;
      const run =
        uuid(after.inferred_by) ?? uuid(after.run_id) ?? uuid(after.run) ?? (await runOfInference(client, row.entity_id, at));
      if (run === null) return null;
      const same = (before.conclusion ?? null) === (after.conclusion ?? null) || before.conclusion === undefined;
      return same
        ? { ...base, targetId: run, name: 'human.inference_confirmed', score: 1 }
        : { ...base, targetId: run, name: 'human.inference_corrected', score: 0 };
    }
    default:
      return null;
  }
}

async function store(client: PoolClient, e: DerivedEvaluation): Promise<boolean> {
  const { rowCount } = await client.query(
    `insert into evaluations (trace_id, target_type, target_id, name, score, by_actor, source, at)
     values ($1, $2, $3, $4, $5, $6, 'human', $7)
     on conflict (target_type, target_id, name, source, by_actor, at) do nothing`,
    [e.traceId, e.targetType, e.targetId, e.name, e.score, e.byActor, e.at],
  );
  return (rowCount ?? 0) > 0;
}

const SELECT = `select c.trace_id, c.span_id, c.command, c.actor, c.entity_type, c.entity_id, c.state_before, c.outcome,
    c.started_at, c.ended_at, j.before, j.after
  from commands c
  left join journal_payloads j on j.trace_id = c.trace_id and j.span_id = c.span_id
  where c.command = any($1::text[])`;

/** Derives for the given commands (`trace:span`), inside the caller's transaction. Returns how many were new. */
export async function deriveFor(client: PoolClient, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const traces = keys.map((k) => k.split(':')[0] ?? '');
  const spans = keys.map((k) => k.split(':')[1] ?? '');
  const { rows } = await client.query<CommandRow>(
    `${SELECT} and (c.trace_id, c.span_id) in (select * from unnest($2::text[], $3::text[]))`,
    [[...DERIVED_COMMANDS], traces, spans],
  );
  let created = 0;
  for (const row of rows) {
    const e = await ruleFor(client, row);
    if (e && (await store(client, e))) created += 1;
  }
  return created;
}

/** Derives for every command of the base (`pnpm evidence derive`). Returns how many were new. */
export async function deriveAll(client: PoolClient): Promise<number> {
  const { rows } = await client.query<CommandRow>(`${SELECT} order by c.started_at`, [[...DERIVED_COMMANDS]]);
  let created = 0;
  for (const row of rows) {
    const e = await ruleFor(client, row);
    if (e && (await store(client, e))) created += 1;
  }
  return created;
}
