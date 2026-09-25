// The ingester over the recorded fixtures (spec §11, §16 "Evidencia"): materialization of every
// table, idempotency, the unmapped, the rollback notice, the CLI telemetry, the views and the
// derived evaluations.

import { readFile } from 'node:fs/promises';
import { ATTR, LOG, RESOURCE, SERVICE_NAME, manifestSummary, sha256Hex } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { ask } from '../src/ask.ts';
import { ingest } from '../src/ingest/ingest.ts';
import { type FlatLog, type FlatSpan, parseLogs, parseTraces } from '../src/ingest/otlp.ts';
import { BUDGET, IDS, MANIFESTS, TEXTS } from './fixtures/ids.ts';
import { count, useEvidenceDatabase } from './support/db.ts';

type Fixture = { traces?: unknown; logs?: unknown };

const fixture = async (name: string): Promise<Fixture> =>
  JSON.parse(await readFile(new URL(`./fixtures/${name}.otlp.json`, import.meta.url), 'utf8')) as Fixture;

const base = useEvidenceDatabase();
let spans: FlatSpan[] = [];
let logs: FlatLog[] = [];

const spanNamed = (name: string, traceId?: string): FlatSpan => {
  const s = spans.find((x) => x.name === name && (traceId === undefined || x.traceId === traceId));
  if (!s) throw new Error(`No span ${name} in the fixture.`);
  return s;
};

const tableCounts = async (): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  for (const t of [
    'interactions',
    'spans',
    'commands',
    'journal_payloads',
    'runs',
    'provider_calls',
    'sessions',
    'session_uses',
    'texts',
    'provider_events',
    'batches',
    'evaluations',
    'unmapped_records',
    'cli_requests',
    'context_manifests',
    'context_fragments',
  ])
    out[t] = await count(base().pool, t);
  return out;
};

beforeAll(async () => {
  const f = await fixture('interaction');
  spans = parseTraces(f.traces);
  logs = parseLogs(f.logs);
  // Logs first: the materialization must not depend on the order (§11).
  await ingest(base().pool, { logs }, 'collector');
  await ingest(base().pool, { spans }, 'collector');
});

describe('ingesting the recorded interaction', () => {
  it('materializes the three interactions with their root, counters and last_seen_at', async () => {
    const { rows } = await base().pool.query<{
      id: string;
      channel: string;
      actor: string;
      root_command: string;
      project_id: string;
      environment: string;
      instance: string;
      span_count: number;
      error_count: number;
      started_at: Date;
      last_seen_at: Date;
    }>('select * from interactions order by id');
    expect(rows.map((r) => r.id)).toEqual([IDS.interaction1, IDS.interaction2, IDS.interaction3]);
    const first = rows[0];
    expect(first).toMatchObject({
      channel: 'api',
      actor: 'human:ana',
      root_command: 'message.send',
      project_id: IDS.project,
      environment: 'test',
      instance: '8100',
      span_count: 9,
      error_count: 0,
    });
    expect(first?.last_seen_at.getTime()).toBeGreaterThanOrEqual(first?.started_at.getTime() ?? 0);
    expect(rows[1]?.root_command).toBe('proposal.accept');
  });

  it('keeps every span with its source, parent and ids', async () => {
    expect(await count(base().pool, 'spans')).toBe(spans.length);
    const { rows } = await base().pool.query<{
      source: string;
      parent_span_id: string | null;
      run_id: string | null;
      call_id: string | null;
    }>("select source, parent_span_id, run_id, call_id from spans where name = 'invoke_agent explorer' and trace_id = $1", [
      spanNamed('run.invoke', spanNamed('interaction message.send').traceId).traceId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'demiurgo', run_id: IDS.run1, call_id: IDS.call1 });
    expect(rows[0]?.parent_span_id).toBe(
      spanNamed('run.invoke', rows[0] ? spanNamed('interaction message.send').traceId : '').spanId,
    );
  });

  it('records every command with its outcome, states, cause and journal payload', async () => {
    const { rows } = await base().pool.query<{
      command: string;
      entity_type: string;
      entity_id: string;
      state_before: string | null;
      state_after: string;
      outcome: string;
      event_seq: string;
      cause_run: string | null;
      actor: string;
      after: unknown;
    }>(
      `select c.command, c.entity_type, c.entity_id, c.state_before, c.state_after, c.outcome, c.event_seq, c.cause_run, c.actor, j.after
       from commands c left join journal_payloads j on (j.trace_id, j.span_id) = (c.trace_id, c.span_id) order by c.event_seq`,
    );
    expect(rows.map((r) => r.command)).toEqual([
      'message.send',
      'run.request',
      'batch.submit',
      'proposal.create',
      'proposal.accept',
      'run.request',
    ]);
    expect(rows[2]).toMatchObject({
      entity_type: 'batch',
      entity_id: IDS.batch,
      cause_run: IDS.run1,
      actor: `agent:run:${IDS.run1}`,
      outcome: 'ok',
      after: { type: 'agent', proposals: 1 },
    });
    expect(rows[4]).toMatchObject({ state_before: 'pending', state_after: 'accepted', after: { approve: false } });
    expect(await count(base().pool, 'journal_payloads')).toBe(6);
  });

  it('materializes the runs from the commands, the steps and the call, whatever the order', async () => {
    const { rows } = await base().pool.query<Record<string, unknown>>('select * from runs order by run_id');
    expect(rows).toHaveLength(2);
    const [run1, run2] = rows;
    expect(run1).toMatchObject({
      run_id: IDS.run1,
      trace_id: IDS.interaction1.replaceAll('-', ''),
      project_id: IDS.project,
      action: 'exploration_chat',
      agent: 'explorer',
      agent_version: 'v3',
      provider: 'claude',
      requested_model: 'claude-sonnet-4-5',
      observed_model: 'claude-sonnet-4-5-20260901',
      effort: 'medium',
      engine_source: 'group',
      pack_hash: IDS.pack1,
      prompt_hash: sha256Hex(TEXTS.systemPrompt),
      session_id: IDS.session,
      session_mode: 'fresh',
      provider_session_id: IDS.session,
      answers_message_id: IDS.message,
      state: 'applied',
    });
    expect(run1?.requested_at).toBeInstanceOf(Date);
    expect(run1?.started_at).toBeInstanceOf(Date);
    expect(run1?.finished_at).toBeInstanceOf(Date);
    expect(run2).toMatchObject({
      run_id: IDS.run2,
      session_mode: 'resumed',
      base_run_id: IDS.run1,
      base_pack_hash: IDS.pack1,
      delta_hash: IDS.delta,
    });
  });

  it('keeps every attribute of the provider call as a column, tokens and provenance included', async () => {
    const { rows } = await base().pool.query<Record<string, unknown>>('select * from provider_calls order by call_id');
    expect(rows).toHaveLength(2);
    const [call1, call2] = rows;
    expect(call1).toMatchObject({
      call_id: IDS.call1,
      run_id: IDS.run1,
      agent: 'explorer',
      provider: 'claude',
      provider_name: 'anthropic',
      requested_model: 'claude-sonnet-4-5',
      attempt: 1,
      session_id: IDS.session,
      session_mode: 'fresh',
      input_hash: sha256Hex(TEXTS.input),
      output_hash: sha256Hex(TEXTS.outputRaw),
      schema_version: '2',
      cli_version: '2.1.283',
      cli_command: 'claude -p --output-format stream-json',
      exit_code: 0,
      stop_reason: 'end_turn',
      state: 'ok',
      duration_reported_ms: 1234,
      tokens_uncached_input: '9000',
      tokens_cache_read: '0',
      tokens_cache_write: '1000',
      tokens_output: '400',
      tokens_reasoning: null,
      declared_cost_usd: 0.042,
      turns: 1,
    });
    expect(call1?.tokens_provenance).toMatchObject({
      uncachedInput: 'claude:result.usage.input_tokens',
      reasoning: 'not_reported',
    });
    expect(call1?.usage_raw).toMatchObject({ usage: { input_tokens: 9000 } });
    expect(call1?.duration_ms).toBeGreaterThanOrEqual(0);
    expect(call2).toMatchObject({
      call_id: IDS.call2,
      session_mode: 'resumed',
      base_run_id: IDS.run1,
      delta_hash: IDS.delta,
      tokens_uncached_input: '1000',
      tokens_cache_read: '8000',
      tokens_cache_write: '500',
    });
  });

  it('materializes the session once, created by the fresh call, and one use per call', async () => {
    const { rows } = await base().pool.query<Record<string, unknown>>('select * from sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      session_id: IDS.session,
      provider: 'claude',
      provider_session_id: IDS.session,
      key_hash: 'k'.repeat(64),
      agent: 'explorer',
      model: 'claude-sonnet-4-5',
      created_call_id: IDS.call1,
      created_trace_id: IDS.interaction1.replaceAll('-', ''),
      name: 'demiurgo explorer 0199a000',
    });
    const uses = await base().pool.query<Record<string, unknown>>('select * from session_uses order by at');
    expect(uses.rows.map((u) => [u.call_id, u.mode, u.base_run_id, u.tokens_cache_read])).toEqual([
      [IDS.call1, 'fresh', null, '0'],
      [IDS.call2, 'resumed', IDS.run1, '8000'],
    ]);
  });

  it('stores each text once by hash and every provider event by id', async () => {
    const { rows } = await base().pool.query<{ hash: string; kind: string; chars: number; body: string }>(
      'select * from texts order by kind',
    );
    expect(rows.map((r) => r.kind)).toEqual(['input', 'input', 'output_raw', 'system_prompt']);
    const prompt = rows.find((r) => r.kind === 'system_prompt');
    expect(prompt).toMatchObject({
      hash: sha256Hex(TEXTS.systemPrompt),
      chars: TEXTS.systemPrompt.length,
      body: TEXTS.systemPrompt,
    });
    const events = await base().pool.query<{ call_id: string; seq: number; kind: string; tokens: unknown; raw: string }>(
      'select call_id, seq, kind, tokens, raw from provider_events order by call_id, seq',
    );
    expect(events.rows).toHaveLength(4);
    expect(events.rows[1]).toMatchObject({ call_id: IDS.call1, seq: 2, kind: 'result', tokens: { input_tokens: 9000 } });
    expect(JSON.parse(events.rows[1]?.raw ?? '{}')).toMatchObject({ type: 'result' });
  });

  it('materializes the batch of the run and derives the human acceptance of its proposal', async () => {
    const batches = await base().pool.query<Record<string, unknown>>('select * from batches');
    expect(batches.rows).toHaveLength(1);
    expect(batches.rows[0]).toMatchObject({ batch_id: IDS.batch, run_id: IDS.run1, project_id: IDS.project, proposals: 1 });
    const evaluations = await base().pool.query<Record<string, unknown>>('select * from evaluations');
    expect(evaluations.rows).toHaveLength(1);
    expect(evaluations.rows[0]).toMatchObject({
      target_type: 'run',
      target_id: IDS.run1,
      name: 'human.accepted',
      score: 1,
      by_actor: 'human:ana',
      source: 'human',
      trace_id: IDS.interaction2.replaceAll('-', ''),
    });
  });

  it('writes one receipt per batch', async () => {
    const { rows } = await base().pool.query<{ origin: string; spans: number; logs: number; upserted: number; unmapped: number }>(
      'select origin, spans, logs, upserted, unmapped from ingest_receipts order by id',
    );
    expect(rows[0]).toMatchObject({ origin: 'collector', spans: 0, logs: logs.length, unmapped: 0 });
    expect(rows[1]).toMatchObject({ origin: 'collector', spans: spans.length, logs: 0, unmapped: 0 });
    expect(rows[1]?.upserted).toBeGreaterThan(spans.length);
  });

  it('ingesting the same fixture again changes no counts', async () => {
    const before = await tableCounts();
    const interactions = await base().pool.query<{ span_count: number }>('select span_count from interactions order by id');
    await ingest(base().pool, { spans }, 'collector');
    await ingest(base().pool, { logs }, 'collector');
    expect(await tableCounts()).toEqual(before);
    const after = await base().pool.query<{ span_count: number }>('select span_count from interactions order by id');
    expect(after.rows).toEqual(interactions.rows);
  });
});

describe('views', () => {
  it('v_session_reuse says reused for the resumed call with cache_ratio >= 0.5 and none for the fresh one', async () => {
    const { rows } = await base().pool.query<{
      call_id: string;
      mode: string;
      verdict: string;
      cache_ratio: number | null;
      base_run_id: string | null;
    }>('select call_id, mode, verdict, cache_ratio, base_run_id from v_session_reuse order by started_at');
    expect(rows).toEqual([
      { call_id: IDS.call1, mode: 'fresh', verdict: 'none', cache_ratio: 0, base_run_id: null },
      { call_id: IDS.call2, mode: 'resumed', verdict: 'reused', cache_ratio: 8000 / 9500, base_run_id: IDS.run1 },
    ]);
  });

  it('v_interaction_summary gives the phases and totals of each interaction', async () => {
    const { rows } = await base().pool.query<Record<string, unknown>>(
      'select * from v_interaction_summary order by interaction_id',
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      interaction_id: IDS.interaction1,
      commands: '4',
      runs: '1',
      provider_calls: '1',
      errors: '0',
      tokens_input: '10000',
      tokens_output: '400',
    });
    expect(Number(rows[0]?.total_ms)).toBeGreaterThanOrEqual(0);
    expect(Number(rows[0]?.api_ms)).toBeGreaterThanOrEqual(0);
    expect(rows[1]).toMatchObject({ interaction_id: IDS.interaction2, commands: '1', provider_calls: '0' });
  });

  it('v_tokens_by_engine sums the calls per provider, model, effort, agent and version', async () => {
    const { rows } = await base().pool.query<Record<string, unknown>>('select * from v_tokens_by_engine');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'claude',
      requested_model: 'claude-sonnet-4-5',
      effort: 'medium',
      agent: 'explorer',
      agent_version: 'v3',
      calls: '2',
      runs: '2',
      failed_calls: '0',
      tokens_uncached_input: '10000',
      tokens_cache_read: '8000',
      tokens_cache_write: '1500',
      tokens_output: '700',
    });
  });
});

describe('the context manifest (§9)', () => {
  it('materializes one manifest per pack with its totals, and one row per fragment with its origin', async () => {
    const { rows } = await base().pool.query<Record<string, unknown>>('select * from context_manifests order by pack_hash');
    expect(rows).toHaveLength(2);
    const summary = manifestSummary(MANIFESTS.run1);
    expect(rows[0]).toMatchObject({
      pack_hash: IDS.pack1,
      pack_id: IDS.packId1,
      project_id: IDS.project,
      builder: 'exploration_chat@2',
      role: 'explore',
      graph_version: 2,
      budget: BUDGET,
      candidates: 5,
      fragments: 5,
      included_chars: summary.includedChars,
      dropped_count: 1,
      built_trace_id: IDS.interaction1.replaceAll('-', ''),
    });
    expect(rows[0]?.built_at).toBeInstanceOf(Date);
    expect(rows[1]).toMatchObject({ pack_hash: IDS.pack2, candidates: 6, fragments: 6, dropped_count: 2 });
    expect(await count(base().pool, 'context_fragments')).toBe(11);
    const fragments = await base().pool.query<Record<string, unknown>>(
      'select * from context_fragments where pack_hash = $1 order by seq',
      [IDS.pack1],
    );
    expect(fragments.rows.map((f) => [f.section, f.decision, f.position])).toEqual([
      ['purpose', 'included', 0],
      ['messages', 'included', 1],
      ['decisions', 'included', 2],
      ['knowledge', 'included', 3],
      ['knowledge', 'dropped', null],
    ]);
    expect(fragments.rows[1]).toMatchObject({
      source_type: 'message',
      source_id: IDS.message,
      source_version: null,
      source_event_seq: '1',
      text_hash: sha256Hex(TEXTS.input),
      chars: TEXTS.input.length,
      reason: 'recent',
      score: null,
    });
    expect(fragments.rows[4]).toMatchObject({
      source_type: 'knowledge_node',
      source_id: 'DEC-ZZZ-001@1',
      source_version: 2,
      reason: 'below_threshold',
      score: 0,
    });
  });

  it('v_context_budget gives, per pack and section, what entered against the budget and what fell out', async () => {
    const { rows } = await base().pool.query<Record<string, unknown>>(
      'select * from v_context_budget where pack_hash = $1 order by section',
      [IDS.pack1],
    );
    expect(rows.map((r) => r.section)).toEqual(['decisions', 'knowledge', 'messages', 'purpose']);
    expect(rows[0]).toMatchObject({
      builder: 'exploration_chat@2',
      role: 'explore',
      candidates: 5,
      budget_chars: 4000,
      included_chars: 8 + TEXTS.decision1.length,
      included_count: '1',
      truncated_count: '0',
      dropped_count: '0',
    });
    expect(rows[1]).toMatchObject({
      budget_chars: 4000,
      included_count: '1',
      dropped_count: '1',
      included_chars: TEXTS.node1.length - 1,
    });
    expect(rows[3]).toMatchObject({
      section: 'purpose',
      budget_chars: null,
      fill_ratio: null,
      included_chars: TEXTS.purpose.length,
    });
    const second = await base().pool.query<Record<string, unknown>>(
      "select section, included_chars, truncated_count, dropped_count from v_context_budget where pack_hash = $1 and section in ('decisions', 'knowledge') order by section",
      [IDS.pack2],
    );
    expect(second.rows).toEqual([
      { section: 'decisions', included_chars: 408, truncated_count: '1', dropped_count: '0' },
      { section: 'knowledge', included_chars: 0, truncated_count: '0', dropped_count: '2' },
    ]);
  });

  it('context-of-run lists every fragment of the run, in order, with origin, decision and reason', async () => {
    const r = await ask(base().pool, 'context-of-run', { run: IDS.run1 });
    expect(r.header).toMatch(/^What exactly did this run's agent receive/);
    expect(r.columns).toEqual([
      'seq',
      'section',
      'source_type',
      'source_id',
      'version',
      'event_seq',
      'original_chars',
      'chars',
      'decision',
      'reason',
      'score',
      'position',
      'text_hash',
      'builder',
      'pack',
    ]);
    const col = (name: string) => r.columns.indexOf(name);
    expect(r.rows.map((row) => row[col('seq')])).toEqual([1, 2, 3, 4, 5]);
    expect(r.rows.map((row) => [row[col('section')], row[col('source_id')], row[col('decision')], row[col('reason')]])).toEqual([
      ['purpose', IDS.exploration, 'included', 'scope'],
      ['messages', IDS.message, 'included', 'recent'],
      ['decisions', IDS.record, 'included', 'approved'],
      ['knowledge', 'DEC-PRO-001@1', 'included', 'relevance:0.31'],
      ['knowledge', 'DEC-ZZZ-001@1', 'dropped', 'below_threshold'],
    ]);
    expect(r.rows[1]?.[col('event_seq')]).toBe('1');
    expect(r.rows[2]?.[col('version')]).toBe(1);
    expect(r.rows[4]?.[col('position')]).toBeNull();
    expect(r.rows[0]?.[col('builder')]).toBe('exploration_chat@2');
    expect(await ask(base().pool, 'context-of-run', { run: IDS.batch })).toMatchObject({ rows: [] });
  });

  it('context-diff lists what is in only one of the two packs or changed decision or text', async () => {
    const r = await ask(base().pool, 'context-diff', { run_a: IDS.run1, run_b: IDS.run2 });
    const col = (name: string) => r.columns.indexOf(name);
    const pick = (row: unknown[]) => [
      row[col('section')],
      row[col('source_id')],
      row[col('difference')],
      row[col('decision_a')],
      row[col('decision_b')],
      row[col('version_a')],
      row[col('version_b')],
    ];
    expect(r.rows.map(pick)).toEqual([
      ['decisions', IDS.record, 'decision', 'included', 'truncated', 1, 2],
      ['knowledge', 'DEC-PRO-001@1', 'decision', 'included', 'dropped', 2, 2],
      ['messages', IDS.message2, 'only_b', null, 'included', null, null],
    ]);
    // The same pack against itself: nothing differs.
    expect((await ask(base().pool, 'context-diff', { run_a: IDS.run1, run_b: IDS.run1 })).rows).toEqual([]);
  });
});

describe('what the ingester does not know', () => {
  const demiurgoResource = { [RESOURCE.serviceName]: SERVICE_NAME, [RESOURCE.environment]: 'test' };

  it('keeps an unknown note in unmapped_records with the reason', async () => {
    const log: FlatLog = {
      resource: demiurgoResource,
      scope: { name: SERVICE_NAME, version: '1' },
      traceId: IDS.interaction1.replaceAll('-', ''),
      spanId: null,
      time: new Date().toISOString(),
      eventName: 'demiurgo.something.new',
      body: 'hello',
      attributes: { 'event.name': 'demiurgo.something.new' },
      severity: 9,
      severityText: 'INFO',
    };
    const receipt = await ingest(base().pool, { logs: [log] }, 'collector');
    expect(receipt.unmapped).toBe(1);
    const { rows } = await base().pool.query<{ kind: string; reason: string; record: { eventName: string } }>(
      "select kind, reason, record from unmapped_records where reason like 'unknown log record%'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'log',
      reason: 'unknown log record: demiurgo.something.new',
      record: { eventName: 'demiurgo.something.new' },
    });
    // Again: same fingerprint, same row.
    await ingest(base().pool, { logs: [log] }, 'collector');
    expect(await count(base().pool, 'unmapped_records', "reason like 'unknown log record%'")).toBe(1);
  });

  it('a dropped notice is kept as unmapped with reason dropped-notice', async () => {
    const log: FlatLog = {
      resource: demiurgoResource,
      scope: { name: SERVICE_NAME, version: '1' },
      traceId: null,
      spanId: null,
      time: new Date().toISOString(),
      eventName: LOG.dropped,
      body: null,
      attributes: { [ATTR.droppedSpans]: 3, [ATTR.droppedLogs]: 0, [ATTR.droppedSince]: '2026-09-26T00:00:00Z' },
      severity: 13,
      severityText: 'WARN',
    };
    await ingest(base().pool, { logs: [log] }, 'collector');
    expect(await count(base().pool, 'unmapped_records', "reason = 'dropped-notice'")).toBe(1);
  });

  it('a rollback notice marks the named commands and removes their journal payloads', async () => {
    const trace = IDS.interaction1.replaceAll('-', '');
    const target = spanNamed('command message.send', trace);
    expect(await count(base().pool, 'journal_payloads', 'trace_id = $1 and span_id = $2', [trace, target.spanId])).toBe(1);
    const notice: FlatLog = {
      resource: demiurgoResource,
      scope: { name: SERVICE_NAME, version: '1' },
      traceId: trace,
      spanId: null,
      time: new Date().toISOString(),
      eventName: LOG.transactionRollback,
      body: null,
      attributes: { [ATTR.rollbackSpans]: [target.spanId], [ATTR.errorType]: 'guard', [ATTR.errorMessage]: 'Blocked.' },
      severity: 9,
      severityText: 'INFO',
    };
    await ingest(base().pool, { logs: [notice] }, 'collector');
    const { rows } = await base().pool.query<{ outcome: string }>(
      'select outcome from commands where trace_id = $1 and span_id = $2',
      [trace, target.spanId],
    );
    expect(rows[0]?.outcome).toBe('rollback');
    expect(await count(base().pool, 'journal_payloads', 'trace_id = $1 and span_id = $2', [trace, target.spanId])).toBe(0);
    // The span and its journal arriving again (a retry of the Collector) do not undo the notice.
    await ingest(base().pool, { spans: [target] }, 'collector');
    await ingest(
      base().pool,
      { logs: logs.filter((l) => l.spanId === target.spanId && l.eventName === LOG.journal) },
      'collector',
    );
    const again = await base().pool.query<{ outcome: string }>(
      'select outcome from commands where trace_id = $1 and span_id = $2',
      [trace, target.spanId],
    );
    expect(again.rows[0]?.outcome).toBe('rollback');
    expect(await count(base().pool, 'journal_payloads', 'trace_id = $1 and span_id = $2', [trace, target.spanId])).toBe(0);
  });
});

describe('telemetry of the CLIs', () => {
  it('Claude Code spans land in spans with their source and its api_request becomes a cli_request of the call', async () => {
    const f = await fixture('claude-code');
    const receipt = await ingest(base().pool, { spans: parseTraces(f.traces), logs: parseLogs(f.logs) }, 'collector');
    expect(receipt.spans).toBe(2);
    expect(receipt.logs).toBe(2);
    const spanRows = await base().pool.query<{ name: string; source: string; call_id: string }>(
      "select name, source, call_id from spans where source = 'claude_code' order by name",
    );
    expect(spanRows.rows).toEqual([
      { name: 'claude_code.interaction', source: 'claude_code', call_id: IDS.call1 },
      { name: 'llm_request', source: 'claude_code', call_id: IDS.call1 },
    ]);
    const { rows } = await base().pool.query<Record<string, unknown>>("select * from cli_requests where source = 'claude_code'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      call_id: IDS.call1,
      trace_id: IDS.interaction1.replaceAll('-', ''),
      request_id: 'req_01HXYZ0001',
      attempt: 1,
      model: 'claude-sonnet-4-5-20260901',
      stop_reason: 'end_turn',
      tokens_uncached_input: '9000',
      tokens_cache_read: '0',
      tokens_cache_write: '1000',
      tokens_output: '400',
      cost_usd: 0.042,
      duration_ms: 2300,
      error_status: null,
      attributes: { 'session.id': IDS.session, 'event.name': 'claude_code.api_request' },
    });
    // The user prompt event is not a request: kept as unmapped, never lost.
    expect(await count(base().pool, 'unmapped_records', "reason = 'CLI event not mapped: claude_code.user_prompt'")).toBe(1);
  });

  it('Codex events join the call by the resource attribute; its input counts the cache inside', async () => {
    const f = await fixture('codex');
    await ingest(base().pool, { logs: parseLogs(f.logs) }, 'collector');
    const { rows } = await base().pool.query<Record<string, unknown>>(
      "select * from cli_requests where source = 'codex' order by at",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      call_id: IDS.call2,
      attempt: 1,
      duration_ms: 1480,
      error_status: '200',
      tokens_output: null,
    });
    expect(rows[1]).toMatchObject({
      call_id: IDS.call2,
      model: 'gpt-5-codex',
      tokens_uncached_input: '1000',
      tokens_cache_read: '8000',
      tokens_output: '300',
      tokens_reasoning: '120',
      attributes: { 'event.kind': 'response.completed' },
    });
    expect(await count(base().pool, 'unmapped_records', "reason = 'CLI event not mapped: codex.conversation_starts'")).toBe(1);
    // Again: the same requests, no more rows.
    await ingest(base().pool, { logs: parseLogs(f.logs) }, 'collector');
    expect(await count(base().pool, 'cli_requests')).toBe(3);
  });
});
