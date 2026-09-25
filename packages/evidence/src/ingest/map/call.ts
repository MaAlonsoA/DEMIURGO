// `invoke_agent <agent>` (§6.2) → `provider_calls` with every attribute as a column, the session it
// used (`sessions`, `session_uses`) and what the run learns from it (`runs`).

import { ATTR } from '@demiurgo/domain';
import type { FlatSpan } from '../otlp.ts';
import { type MapContext, durationMs, int, jsonAttr, jsonb, list, num, str, uuidAttr } from './common.ts';
import { insertSpan, touchInteraction } from './span.ts';
import { upsertRun } from './step.ts';

export async function mapCall(ctx: MapContext, span: FlatSpan): Promise<void> {
  const a = span.attributes;
  const inserted = await insertSpan(ctx, span, 'demiurgo');
  await touchInteraction(ctx, span, inserted);
  const callId = uuidAttr(a, ATTR.callId);
  if (callId === null) return;

  const runId = uuidAttr(a, ATTR.runId);
  const sessionId = uuidAttr(a, ATTR.sessionId);
  const mode = str(a, ATTR.sessionMode);
  const provider = str(a, ATTR.providerId);
  const failed = span.status === 'error' || str(a, ATTR.failureKind) !== null;
  const usage = {
    uncached: int(a, ATTR.usageUncachedInputTokens),
    cacheRead: int(a, ATTR.genAiUsageCacheReadInputTokens),
    cacheWrite: int(a, ATTR.genAiUsageCacheWriteInputTokens),
    output: int(a, ATTR.genAiUsageOutputTokens),
    reasoning: int(a, ATTR.genAiUsageReasoningOutputTokens),
  };
  // `gen_ai.usage.input_tokens` includes the cache (§6.2); without the uncached figure it is the best we have.
  if (usage.uncached === null) {
    const total = int(a, ATTR.genAiUsageInputTokens);
    if (total !== null) usage.uncached = total - (usage.cacheRead ?? 0) - (usage.cacheWrite ?? 0);
  }
  const common = {
    agent: str(a, ATTR.genAiAgentName) ?? span.name.replace(/^invoke_agent\s+/, ''),
    agent_version: str(a, ATTR.genAiAgentVersion),
    requested_model: str(a, ATTR.genAiRequestModel),
    observed_model: str(a, ATTR.genAiResponseModel),
    effort: str(a, ATTR.effort),
    engine_source: str(a, ATTR.engineSource),
    session_mode: mode,
    provider_session_id: str(a, ATTR.genAiConversationId),
    base_run_id: uuidAttr(a, ATTR.sessionBaseRun),
    base_pack_hash: str(a, ATTR.sessionBasePackHash),
    delta_hash: str(a, ATTR.deltaHash),
    prompt_hash: str(a, ATTR.promptHash),
    schema_version: str(a, ATTR.schemaVersion),
    output_hash: str(a, ATTR.outputHash),
  };

  await ctx.client.query(
    `insert into provider_calls (call_id, trace_id, span_id, run_id, update_id, project_id, agent, agent_version, provider,
       provider_name, requested_model, observed_model, effort, engine_source, attempt, session_id, session_mode,
       provider_session_id, base_run_id, base_pack_hash, delta_hash, prompt_hash, input_hash, schema_hash, schema_version,
       output_hash, cli_version, cli_command, cli_cwd, exit_code, stderr_hash, stop_reason, state, failure_kind, error,
       started_at, finished_at, duration_ms, duration_reported_ms, duration_api_ms, ttft_ms, tokens_uncached_input,
       tokens_cache_read, tokens_cache_write, tokens_output, tokens_reasoning, tokens_provenance, usage_raw,
       declared_cost_usd, turns, transcript_path, transcript_size, transcript_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
       $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47,
       $48, $49, $50, $51, $52, $53)
     on conflict (call_id) do update set
       trace_id = excluded.trace_id, span_id = excluded.span_id, run_id = coalesce(excluded.run_id, provider_calls.run_id),
       update_id = coalesce(excluded.update_id, provider_calls.update_id),
       project_id = coalesce(excluded.project_id, provider_calls.project_id),
       agent = excluded.agent, agent_version = excluded.agent_version, provider = excluded.provider,
       provider_name = excluded.provider_name, requested_model = excluded.requested_model,
       observed_model = excluded.observed_model, effort = excluded.effort, engine_source = excluded.engine_source,
       attempt = excluded.attempt, session_id = excluded.session_id, session_mode = excluded.session_mode,
       provider_session_id = excluded.provider_session_id, base_run_id = excluded.base_run_id,
       base_pack_hash = excluded.base_pack_hash, delta_hash = excluded.delta_hash, prompt_hash = excluded.prompt_hash,
       input_hash = excluded.input_hash, schema_hash = excluded.schema_hash, schema_version = excluded.schema_version,
       output_hash = excluded.output_hash, cli_version = excluded.cli_version, cli_command = excluded.cli_command,
       cli_cwd = excluded.cli_cwd, exit_code = excluded.exit_code, stderr_hash = excluded.stderr_hash,
       stop_reason = excluded.stop_reason, state = excluded.state, failure_kind = excluded.failure_kind,
       error = excluded.error, started_at = excluded.started_at, finished_at = excluded.finished_at,
       duration_ms = excluded.duration_ms, duration_reported_ms = excluded.duration_reported_ms,
       duration_api_ms = excluded.duration_api_ms, ttft_ms = excluded.ttft_ms,
       tokens_uncached_input = excluded.tokens_uncached_input, tokens_cache_read = excluded.tokens_cache_read,
       tokens_cache_write = excluded.tokens_cache_write, tokens_output = excluded.tokens_output,
       tokens_reasoning = excluded.tokens_reasoning, tokens_provenance = excluded.tokens_provenance,
       usage_raw = excluded.usage_raw, declared_cost_usd = excluded.declared_cost_usd, turns = excluded.turns,
       transcript_path = excluded.transcript_path, transcript_size = excluded.transcript_size,
       transcript_hash = excluded.transcript_hash`,
    [
      callId,
      span.traceId,
      span.spanId,
      runId,
      uuidAttr(a, ATTR.updateId),
      uuidAttr(a, ATTR.projectId),
      common.agent,
      common.agent_version,
      provider,
      str(a, ATTR.genAiProviderName),
      common.requested_model,
      common.observed_model,
      common.effort,
      common.engine_source,
      int(a, ATTR.callAttempt),
      sessionId,
      mode,
      common.provider_session_id,
      common.base_run_id,
      common.base_pack_hash,
      common.delta_hash,
      common.prompt_hash,
      str(a, ATTR.inputHash),
      str(a, ATTR.schemaHash),
      common.schema_version,
      common.output_hash,
      str(a, ATTR.cliVersion),
      // The argv of the child, as one line (§6.2: never its environment).
      list(a, ATTR.cliCommand)?.join(' ') ?? null,
      str(a, ATTR.cliCwd),
      int(a, ATTR.cliExitCode),
      str(a, ATTR.cliStderrHash),
      str(a, ATTR.cliStopReason),
      failed ? 'failed' : 'ok',
      str(a, ATTR.failureKind),
      str(a, ATTR.errorMessage) ?? span.statusMessage,
      span.start,
      span.end,
      durationMs(span.start, span.end),
      num(a, ATTR.callDurationReportedMs),
      num(a, ATTR.callDurationApiMs),
      num(a, ATTR.callTtftMs),
      usage.uncached,
      usage.cacheRead,
      usage.cacheWrite,
      usage.output,
      usage.reasoning,
      jsonb(jsonAttr(a, ATTR.usageProvenance)),
      jsonb(jsonAttr(a, ATTR.usageRaw)),
      num(a, ATTR.usageDeclaredCostUsd),
      int(a, ATTR.usageTurns),
      str(a, ATTR.transcriptPath),
      int(a, ATTR.transcriptSize),
      str(a, ATTR.transcriptHash),
    ],
  );
  ctx.counts.upserted += 1;

  if (sessionId !== null) {
    const fresh = mode === 'fresh';
    await ctx.client.query(
      `insert into sessions (session_id, provider, provider_session_id, key_hash, project_id, agent, agent_version, model,
         created_trace_id, created_call_id, created_at, name, transcript_path)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (session_id) do update set
         provider = coalesce(excluded.provider, sessions.provider),
         provider_session_id = coalesce(excluded.provider_session_id, sessions.provider_session_id),
         key_hash = coalesce(excluded.key_hash, sessions.key_hash),
         project_id = coalesce(excluded.project_id, sessions.project_id),
         agent = coalesce(excluded.agent, sessions.agent),
         agent_version = coalesce(excluded.agent_version, sessions.agent_version),
         model = coalesce(excluded.model, sessions.model),
         created_trace_id = coalesce(sessions.created_trace_id, excluded.created_trace_id),
         created_call_id = coalesce(sessions.created_call_id, excluded.created_call_id),
         created_at = least(sessions.created_at, excluded.created_at),
         name = coalesce(excluded.name, sessions.name),
         transcript_path = coalesce(excluded.transcript_path, sessions.transcript_path)`,
      [
        sessionId,
        provider,
        common.provider_session_id,
        str(a, ATTR.sessionKeyHash),
        uuidAttr(a, ATTR.projectId),
        common.agent,
        common.agent_version,
        common.requested_model,
        fresh ? span.traceId : null,
        fresh ? callId : null,
        fresh ? span.start : null,
        str(a, ATTR.sessionName),
        str(a, ATTR.transcriptPath),
      ],
    );
    ctx.counts.upserted += 1;
    if (mode !== null && mode !== 'none') {
      await ctx.client.query(
        `insert into session_uses (call_id, session_id, run_id, mode, base_run_id, delta_hash, tokens_cache_read,
           tokens_uncached_input, at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (call_id) do update set
           session_id = excluded.session_id, run_id = excluded.run_id, mode = excluded.mode,
           base_run_id = excluded.base_run_id, delta_hash = excluded.delta_hash,
           tokens_cache_read = excluded.tokens_cache_read, tokens_uncached_input = excluded.tokens_uncached_input,
           at = excluded.at`,
        [callId, sessionId, runId, mode, common.base_run_id, common.delta_hash, usage.cacheRead, usage.uncached, span.start],
      );
      ctx.counts.upserted += 1;
    }
  }

  if (runId !== null) {
    await upsertRun(ctx, runId, {
      trace_id: span.traceId,
      project_id: uuidAttr(a, ATTR.projectId),
      provider,
      session_id: sessionId,
      ...common,
      ...(failed ? { failure_kind: str(a, ATTR.failureKind) ?? str(a, ATTR.errorType), error: str(a, ATTR.errorMessage) } : {}),
    });
  }
}
