// Statistics and consumption of the engines (FDR-AGE-002), always computed from the provider calls:
// there is no table of their own. Consumption is only shown: there are no limits.

import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';

export type StatsRow = {
  agent: string;
  provider: string;
  model: string;
  effort: string | null;
  calls: number;
  failures: Record<string, number>;
  avgDurationMs: number | null;
  avgTokens: number | null;
  avgQuestions: number | null;
  avgProposals: number | null;
};

export type ConsumptionRow = {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  declaredCostUsd: number;
};

export type Consumption = {
  today: { byProvider: ConsumptionRow[]; byAgent: ConsumptionRow[] };
  week: { byProvider: ConsumptionRow[]; byAgent: ConsumptionRow[] };
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Per agent, provider, model and effort: calls, failures by kind, and averages. */
export async function providerStats(db: Db): Promise<StatsRow[]> {
  const { rows } = await sql<{
    agent: string;
    provider: string;
    model: string;
    effort: string | null;
    calls: string;
    avg_duration: string | null;
    avg_tokens: string | null;
    avg_questions: string | null;
    avg_proposals: string | null;
  }>`
    select c.agent, c.provider, c.requested_model as model, c.effort, count(*) as calls,
      avg((c.usage->>'durationMs')::numeric) as avg_duration,
      avg(coalesce((c.usage->>'inputTokens')::numeric, 0) + coalesce((c.usage->>'outputTokens')::numeric, 0))
        filter (where c.usage is not null) as avg_tokens,
      avg(jsonb_array_length(r.output->'questions')) filter (where jsonb_typeof(r.output->'questions') = 'array') as avg_questions,
      avg(jsonb_array_length(r.output->'proposals')) filter (where jsonb_typeof(r.output->'proposals') = 'array') as avg_proposals
    from agent_calls c left join ai_runs r on r.id = c.run_id
    group by c.agent, c.provider, c.requested_model, c.effort
    order by c.agent, c.provider, c.requested_model, c.effort`.execute(db);
  const failures = await sql<{ agent: string; provider: string; model: string; effort: string | null; kind: string; n: string }>`
    select agent, provider, requested_model as model, effort, failure_kind as kind, count(*) as n
    from agent_calls where state = 'error'
    group by agent, provider, requested_model, effort, failure_kind`.execute(db);
  const keyOf = (r: { agent: string; provider: string; model: string; effort: string | null }) =>
    `${r.agent}|${r.provider}|${r.model}|${r.effort ?? ''}`;
  const failed = new Map<string, Record<string, number>>();
  for (const f of failures.rows) {
    const k = keyOf(f);
    failed.set(k, { ...failed.get(k), [f.kind ?? 'unknown']: Number(f.n) });
  }
  return rows.map((r) => ({
    agent: r.agent,
    provider: r.provider,
    model: r.model,
    effort: r.effort,
    calls: Number(r.calls),
    failures: failed.get(keyOf(r)) ?? {},
    avgDurationMs: num(r.avg_duration),
    avgTokens: num(r.avg_tokens),
    avgQuestions: num(r.avg_questions),
    avgProposals: num(r.avg_proposals),
  }));
}

async function consumed(db: Db, since: Date, by: 'provider' | 'agent'): Promise<ConsumptionRow[]> {
  const { rows } = await sql<{ key: string; calls: string; input: string; output: string; cost: string }>`
    select ${sql.ref(by)} as key, count(*) as calls,
      coalesce(sum((usage->>'inputTokens')::numeric), 0) as input,
      coalesce(sum((usage->>'outputTokens')::numeric), 0) as output,
      coalesce(sum((usage->>'declaredCostUsd')::numeric), 0) as cost
    from agent_calls where started_at >= ${since}
    group by ${sql.ref(by)} order by ${sql.ref(by)}`.execute(db);
  return rows.map((r) => ({
    key: r.key,
    calls: Number(r.calls),
    inputTokens: Number(r.input),
    outputTokens: Number(r.output),
    declaredCostUsd: Number(r.cost),
  }));
}

/** Today (since local midnight) and the last 7 days, per provider and per agent. */
export async function consumption(db: Db, now: Date): Promise<Consumption> {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    today: { byProvider: await consumed(db, midnight, 'provider'), byAgent: await consumed(db, midnight, 'agent') },
    week: { byProvider: await consumed(db, weekAgo, 'provider'), byAgent: await consumed(db, weekAgo, 'agent') },
  };
}

/** The provider calls of a run (each attempt), with their events in order. */
export async function runCalls(db: Db, projectId: string, runId: string) {
  const calls = await db
    .selectFrom('agent_calls')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('run_id', '=', runId)
    .orderBy('started_at')
    .orderBy('id')
    .execute();
  const events =
    calls.length === 0
      ? []
      : await db
          .selectFrom('agent_call_events')
          .select(['call_id', 'seq', 'received_at', 'kind', 'tokens', 'raw'])
          .where(
            'call_id',
            'in',
            calls.map((c) => c.id),
          )
          .orderBy('call_id')
          .orderBy('seq')
          .execute();
  return calls.map((c) => ({ ...c, events: events.filter((e) => e.call_id === c.id) }));
}

/** Live summary of a run's current call: what the SSE stream sends as progress. */
export async function runProgress(db: Db, runId: string) {
  const call = await db
    .selectFrom('agent_calls')
    .select(['id', 'started_at', 'provider', 'requested_model'])
    .where('run_id', '=', runId)
    .orderBy('started_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (!call) return null;
  const summary = await db
    .selectFrom('agent_call_events')
    .select((eb) => [eb.fn.countAll<string>().as('events'), eb.fn.max('tokens').as('tokens'), eb.fn.max('seq').as('last')])
    .where('call_id', '=', call.id)
    .executeTakeFirstOrThrow();
  const last = await db
    .selectFrom('agent_call_events')
    .select('kind')
    .where('call_id', '=', call.id)
    .orderBy('seq', 'desc')
    .executeTakeFirst();
  return {
    run_id: runId,
    call_id: call.id,
    provider: call.provider,
    model: call.requested_model,
    started_at: (call.started_at as unknown as Date).toISOString(),
    events: Number(summary.events),
    tokens: summary.tokens === null ? null : Number(summary.tokens),
    last_kind: last?.kind ?? null,
  };
}
