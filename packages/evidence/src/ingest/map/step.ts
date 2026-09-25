// Engine steps (§6.1: `run.*`, `response.*`, `knowledge.*`, `ideas.*`) → `spans`, and the run they
// describe materialized by upsert, in any order (§5.3): every column merges with `coalesce`, the
// timestamps with `least`/`greatest`.

import { ATTR, SPAN } from '@demiurgo/domain';
import type { FlatSpan } from '../otlp.ts';
import { type MapContext, str, uuidAttr } from './common.ts';
import { insertSpan, touchInteraction } from './span.ts';

export const STEP_NAMES: ReadonlySet<string> = new Set(
  Object.entries(SPAN)
    .filter(([key]) => !['interaction', 'command', 'invokeAgent'].includes(key))
    .map(([, name]) => name),
);

/** Columns of `runs` a note may set; null means "nothing to say". */
export type RunFields = Partial<{
  trace_id: string | null;
  project_id: string | null;
  action: string | null;
  agent: string | null;
  agent_version: string | null;
  provider: string | null;
  requested_model: string | null;
  observed_model: string | null;
  effort: string | null;
  engine_source: string | null;
  pack_hash: string | null;
  schema_version: string | null;
  prompt_hash: string | null;
  session_id: string | null;
  session_mode: string | null;
  provider_session_id: string | null;
  base_run_id: string | null;
  base_pack_hash: string | null;
  delta_hash: string | null;
  retry_of: string | null;
  answers_message_id: string | null;
  requested_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  state: string | null;
  failure_kind: string | null;
  error: string | null;
  usage: string | null;
  output_hash: string | null;
}>;

const COALESCED = [
  'trace_id',
  'project_id',
  'action',
  'agent',
  'agent_version',
  'provider',
  'requested_model',
  'observed_model',
  'effort',
  'engine_source',
  'pack_hash',
  'schema_version',
  'prompt_hash',
  'session_id',
  'session_mode',
  'provider_session_id',
  'base_run_id',
  'base_pack_hash',
  'delta_hash',
  'retry_of',
  'answers_message_id',
  'state',
  'failure_kind',
  'error',
  'usage',
  'output_hash',
] as const;

export async function upsertRun(ctx: MapContext, runId: string, f: RunFields): Promise<void> {
  const values: Record<string, unknown> = { ...f };
  const columns = ['run_id', ...COALESCED, 'requested_at', 'started_at', 'finished_at'];
  const params = [
    runId,
    ...COALESCED.map((c) => values[c] ?? null),
    f.requested_at ?? null,
    f.started_at ?? null,
    f.finished_at ?? null,
  ];
  const sets = [
    ...COALESCED.map((c) => `${c} = coalesce(excluded.${c}, runs.${c})`),
    'requested_at = least(excluded.requested_at, runs.requested_at)',
    'started_at = least(excluded.started_at, runs.started_at)',
    'finished_at = greatest(excluded.finished_at, runs.finished_at)',
  ];
  await ctx.client.query(
    `insert into runs (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})
     on conflict (run_id) do update set ${sets.join(', ')}`,
    params,
  );
  ctx.counts.upserted += 1;
}

export async function mapStep(ctx: MapContext, span: FlatSpan): Promise<void> {
  const a = span.attributes;
  const inserted = await insertSpan(ctx, span, 'demiurgo');
  await touchInteraction(ctx, span, inserted);
  const runId = uuidAttr(a, ATTR.runId);
  if (runId === null) return;
  const fields: RunFields = { trace_id: span.traceId, project_id: uuidAttr(a, ATTR.projectId) };
  const result = str(a, ATTR.stepResult);
  switch (span.name) {
    case SPAN.runPrepare:
      fields.requested_at = span.start;
      break;
    case SPAN.runInvoke:
      fields.started_at = span.start;
      break;
    case SPAN.runApply:
      fields.finished_at = span.end ?? span.start;
      fields.state = span.status === 'error' ? 'failed' : (result ?? 'applied');
      break;
    case SPAN.runFail:
    case SPAN.runAbandon:
      fields.finished_at = span.end ?? span.start;
      fields.state = span.name === SPAN.runFail ? 'failed' : 'abandoned';
      fields.failure_kind = str(a, ATTR.failureKind) ?? str(a, ATTR.errorType);
      fields.error = str(a, ATTR.errorMessage) ?? span.statusMessage;
      break;
    default:
      break;
  }
  const retryOf = span.links.map((l) => l.attributes[ATTR.retryOf]).find((v) => typeof v === 'string');
  if (typeof retryOf === 'string') fields.retry_of = uuidAttr({ v: retryOf }, 'v');
  await upsertRun(ctx, runId, fields);
}
