// Observability vocabulary (docs/superpowers/specs/2026-09-26-motor-observabilidad-design.md §6).
// Pure, no I/O. Every name an emitted note can carry lives here, with the vocabulary version:
// renaming an attribute or a note is a version bump, never a silent change. The GenAI names are
// pinned to the OpenTelemetry `semantic-conventions-genai` repository as of 09-2026.

import { sha256 } from './fingerprint.ts';

/** Version of this vocabulary. Every note carries it as `demiurgo.schema_version`. */
export const OBSERVE_SCHEMA_VERSION = 1;

/** Resource attributes shared by every note (§5.6). */
export const RESOURCE = {
  serviceName: 'service.name',
  serviceVersion: 'service.version',
  environment: 'deployment.environment.name',
  instance: 'demiurgo.instance',
  schemaVersion: 'demiurgo.schema_version',
  workflowsVersion: 'demiurgo.workflows_version',
} as const;

export const SERVICE_NAME = 'demiurgo';

export const ENVIRONMENTS = ['real', 'qa', 'dev', 'test'] as const;
export type ObserveEnvironment = (typeof ENVIRONMENTS)[number];

export const CHANNELS = ['api', 'mcp', 'cli', 'system'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Request header the MCP server sends so the API records its interactions with channel `mcp` (§7.2). */
export const CHANNEL_HEADER = 'x-demiurgo-channel';

/** Span names (§6.1). Interaction and command spans append the command name. */
export const SPAN = {
  interaction: 'interaction',
  command: 'command',
  invokeAgent: 'invoke_agent',
  runPrepare: 'run.prepare',
  runInvoke: 'run.invoke',
  runApply: 'run.apply',
  runFail: 'run.fail',
  runAbandon: 'run.abandon',
  responseFreshness: 'response.freshness',
  responseRequest: 'response.request',
  responseAbandon: 'response.abandon',
  knowledgeClassify: 'knowledge.classify',
  knowledgeApply: 'knowledge.apply',
  ideasAssess: 'ideas.assess',
} as const;

/** Log record names (§6.3). */
export const LOG = {
  text: 'demiurgo.text',
  providerEvent: 'demiurgo.provider.event',
  contextManifest: 'demiurgo.context.manifest',
  journal: 'demiurgo.journal',
  transactionRollback: 'demiurgo.transaction.rollback',
  evaluation: 'gen_ai.evaluation.result',
  dropped: 'demiurgo.observe.dropped',
} as const;
export type LogName = (typeof LOG)[keyof typeof LOG];

export const TEXT_KINDS = [
  'system_prompt',
  'input',
  'schema',
  'output_raw',
  'stderr',
  'transcript_chunk',
  'pack_content',
  'delta',
] as const;
export type TextKind = (typeof TEXT_KINDS)[number];

export const COMMAND_OUTCOMES = [
  'ok',
  'forbidden',
  'validation',
  'not_found',
  'invalid_transition',
  'guard',
  'rollback',
  'error',
] as const;
export type CommandOutcome = (typeof COMMAND_OUTCOMES)[number];

export const ENGINE_SOURCES = ['override', 'agent', 'group'] as const;
export type EngineSource = (typeof ENGINE_SOURCES)[number];

/** Attribute names (§6). Grouped by the note that carries them; the same name means the same thing everywhere. */
export const ATTR = {
  // Interaction and commands
  interactionId: 'demiurgo.interaction.id',
  channel: 'demiurgo.channel',
  actor: 'demiurgo.actor',
  actorType: 'demiurgo.actor.type',
  projectId: 'demiurgo.project.id',
  command: 'demiurgo.command',
  entityType: 'demiurgo.entity.type',
  entityId: 'demiurgo.entity.id',
  entityVersion: 'demiurgo.entity.version',
  httpRoute: 'http.route',
  stateBefore: 'demiurgo.state.before',
  stateAfter: 'demiurgo.state.after',
  eventSeq: 'demiurgo.event.seq',
  eventNone: 'demiurgo.event.none',
  outcome: 'demiurgo.outcome',
  reasons: 'demiurgo.reasons',
  causeRun: 'demiurgo.cause.run',
  causeBatch: 'demiurgo.cause.batch',
  causeProposal: 'demiurgo.cause.proposal',
  payloadBeforeHash: 'demiurgo.payload.before.hash',
  payloadAfterHash: 'demiurgo.payload.after.hash',
  rollbackSpans: 'demiurgo.transaction.rollback.spans',
  // Engine steps
  runId: 'demiurgo.run.id',
  updateId: 'demiurgo.update.id',
  batchId: 'demiurgo.batch.id',
  workflowId: 'demiurgo.workflow.id',
  stepAttempt: 'demiurgo.step.attempt',
  stepResult: 'demiurgo.step.result',
  classifySource: 'demiurgo.classify.source',
  retryOf: 'demiurgo.run.retry_of',
  // Provider call (GenAI semconv + ours)
  genAiOperationName: 'gen_ai.operation.name',
  genAiProviderName: 'gen_ai.provider.name',
  genAiAgentName: 'gen_ai.agent.name',
  genAiAgentVersion: 'gen_ai.agent.version',
  genAiRequestModel: 'gen_ai.request.model',
  genAiResponseModel: 'gen_ai.response.model',
  genAiConversationId: 'gen_ai.conversation.id',
  genAiUsageInputTokens: 'gen_ai.usage.input_tokens',
  genAiUsageOutputTokens: 'gen_ai.usage.output_tokens',
  genAiUsageCacheReadInputTokens: 'gen_ai.usage.cache_read.input_tokens',
  genAiUsageCacheWriteInputTokens: 'gen_ai.usage.cache_write.input_tokens',
  genAiUsageReasoningOutputTokens: 'gen_ai.usage.reasoning.output_tokens',
  genAiSystemInstructions: 'gen_ai.system_instructions',
  genAiInputMessages: 'gen_ai.input.messages',
  providerId: 'demiurgo.provider.id',
  modelObservedProvenance: 'demiurgo.model.observed_provenance',
  effort: 'demiurgo.effort',
  engineSource: 'demiurgo.engine.source',
  sessionId: 'demiurgo.session.id',
  sessionMode: 'demiurgo.session.mode',
  sessionKeyHash: 'demiurgo.session.key_hash',
  sessionBaseRun: 'demiurgo.session.base_run',
  sessionBasePackHash: 'demiurgo.session.base_pack_hash',
  sessionName: 'demiurgo.session.name',
  deltaHash: 'demiurgo.delta.hash',
  callId: 'demiurgo.call.id',
  callAttempt: 'demiurgo.call.attempt',
  promptHash: 'demiurgo.prompt.hash',
  inputHash: 'demiurgo.input.hash',
  schemaHash: 'demiurgo.schema.hash',
  schemaVersion: 'demiurgo.schema.version',
  outputHash: 'demiurgo.output.hash',
  packHash: 'demiurgo.pack.hash',
  packId: 'demiurgo.pack.id',
  packBuilder: 'demiurgo.pack.builder',
  packRole: 'demiurgo.pack.role',
  packBudget: 'demiurgo.pack.budget',
  packReused: 'demiurgo.pack.reused',
  graphVersion: 'demiurgo.graph.version',
  usageUncachedInputTokens: 'demiurgo.usage.uncached_input_tokens',
  usageDeclaredCostUsd: 'demiurgo.usage.declared_cost_usd',
  usageTurns: 'demiurgo.usage.turns',
  usageProvenance: 'demiurgo.usage.provenance',
  usageRaw: 'demiurgo.usage.raw',
  callDurationReportedMs: 'demiurgo.call.duration_reported_ms',
  callDurationApiMs: 'demiurgo.call.duration_api_ms',
  callTtftMs: 'demiurgo.call.ttft_ms',
  cliVersion: 'demiurgo.cli.version',
  cliCommand: 'demiurgo.cli.command',
  cliCwd: 'demiurgo.cli.cwd',
  cliExitCode: 'demiurgo.cli.exit_code',
  cliStderrHash: 'demiurgo.cli.stderr_hash',
  cliStopReason: 'demiurgo.cli.stop_reason',
  cliTraceParent: 'demiurgo.cli.traceparent',
  transcriptPath: 'demiurgo.transcript.path',
  transcriptSize: 'demiurgo.transcript.size',
  transcriptHash: 'demiurgo.transcript.hash',
  transcriptOffset: 'demiurgo.transcript.offset',
  failureKind: 'demiurgo.failure_kind',
  errorType: 'error.type',
  errorMessage: 'error.message',
  // Log records
  textHash: 'demiurgo.text.hash',
  textKind: 'demiurgo.text.kind',
  textChars: 'demiurgo.text.chars',
  eventId: 'demiurgo.event.id',
  eventKind: 'demiurgo.event.kind',
  eventTokens: 'demiurgo.event.tokens',
  eventReceivedAt: 'demiurgo.event.received_at',
  evaluationName: 'gen_ai.evaluation.name',
  evaluationScoreValue: 'gen_ai.evaluation.score.value',
  evaluationScoreLabel: 'gen_ai.evaluation.score.label',
  evaluationExplanation: 'gen_ai.evaluation.explanation',
  evaluationTargetType: 'demiurgo.evaluation.target.type',
  evaluationTargetId: 'demiurgo.evaluation.target.id',
  evaluationBy: 'demiurgo.evaluation.by',
  evaluationSource: 'demiurgo.evaluation.source',
  droppedSpans: 'demiurgo.observe.dropped.spans',
  droppedLogs: 'demiurgo.observe.dropped.logs',
  droppedSince: 'demiurgo.observe.since',
} as const;

/** `gen_ai.provider.name` per DEMIURGO provider (§6.2); OpenCode uses its own provider key. */
export const GEN_AI_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  claude: 'anthropic',
  codex: 'openai',
  simulated: 'demiurgo_simulated',
};

/** Environment of the child CLIs: names DEMIURGO sets per call (§7.6). */
export const CLI_ENV = {
  traceParent: 'TRACEPARENT',
  resourceAttributes: 'OTEL_RESOURCE_ATTRIBUTES',
  otlpEndpoint: 'OTEL_EXPORTER_OTLP_ENDPOINT',
  otlpProtocol: 'OTEL_EXPORTER_OTLP_PROTOCOL',
  tracesExporter: 'OTEL_TRACES_EXPORTER',
  logsExporter: 'OTEL_LOGS_EXPORTER',
  metricsExporter: 'OTEL_METRICS_EXPORTER',
  claudeTelemetry: 'CLAUDE_CODE_ENABLE_TELEMETRY',
  claudeEnhancedTelemetry: 'CLAUDE_CODE_ENHANCED_TELEMETRY_BETA',
} as const;

/** The interaction id (UUID v7 with hyphens) as an OpenTelemetry trace id (32 hex chars). */
export function traceIdOf(interactionId: string): string {
  return interactionId.replace(/-/g, '').toLowerCase();
}

/** The inverse of `traceIdOf`: a 32-hex trace id back to its UUID form. */
export function interactionIdOf(traceId: string): string {
  const h = traceId.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const RE_TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** Parses a W3C `traceparent` (`00-<trace_id>-<span_id>-<flags>`), or null when malformed. */
export function parseTraceParent(value: string): { traceId: string; spanId: string; flags: string } | null {
  const m = RE_TRACEPARENT.exec(value.trim().toLowerCase());
  return m ? { traceId: m[1] ?? '', spanId: m[2] ?? '', flags: m[3] ?? '' } : null;
}

export function formatTraceParent(traceId: string, spanId: string, sampled = true): string {
  return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

// ---------------------------------------------------------------------------------------------
// Content fingerprints (§5.5)

/** Full SHA-256 (64 hex chars) of the UTF-8 text as is. The same helper `fingerprint.ts` uses. */
export function sha256Hex(text: string): string {
  return sha256(text);
}

// ---------------------------------------------------------------------------------------------
// Normalized token accounting (§8)

/** Provenance of a figure the provider did not report. It is not zero. */
export const NOT_REPORTED = 'not_reported';

/**
 * One figure of the canonical usage: its value in tokens and where it comes from, as a dotted
 * path into the raw usage prefixed by the provider (`claude:result.usage.input_tokens`,
 * `codex:turn.completed.usage.input_tokens-cached_input_tokens`), or `not_reported` when null.
 */
export type TokenFigure = { value: number | null; provenance: string };

export type NormalizedUsage = {
  /** Input tokens that did not come from the cache. */
  uncachedInput: TokenFigure;
  cacheRead: TokenFigure;
  cacheWrite: TokenFigure;
  output: TokenFigure;
  /** Output tokens spent reasoning (part of `output`). */
  reasoning: TokenFigure;
  /** `uncachedInput + cacheRead + cacheWrite` (null counts as 0); null when all three are null. */
  inputTotal: number | null;
  /** `cacheRead / inputTotal`; null when either is null or the total is 0. */
  cacheRatio: number | null;
  /** Only Claude declares it, cumulative per session (`claude:result.total_cost_usd:cumulative`). */
  declaredCostUsd: { value: number | null; provenance: string };
  turns: number | null;
  /** The provider's usage as it came, untouched. */
  raw: unknown;
};

const notReported: TokenFigure = { value: null, provenance: NOT_REPORTED };

type Obj = Record<string, unknown>;

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A finite number at `path` (dotted) inside `o`, or null when absent or not a number. */
function numberAt(o: Obj | null, path: string): number | null {
  let cur: unknown = o;
  for (const key of path.split('.')) {
    if (!isObject(cur)) return null;
    cur = cur[key];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : null;
}

function figure(o: Obj | null, path: string, provenance: string): TokenFigure {
  const value = numberAt(o, path);
  return value === null ? notReported : { value, provenance };
}

/** `total - cached` when both are reported; `total` alone when the cache is not reported. */
function uncachedFrom(o: Obj | null, totalPath: string, cachedPath: string, prefix: string): TokenFigure {
  const total = numberAt(o, totalPath);
  if (total === null) return notReported;
  const cached = numberAt(o, cachedPath);
  return cached === null
    ? { value: total, provenance: `${prefix}${totalPath}` }
    : { value: total - cached, provenance: `${prefix}${totalPath}-${cachedPath}` };
}

/**
 * Splits the raw into the usage figures and their envelope: adapters may hand the usage object
 * itself or the line that carries it (Claude's `result`, Codex's `turn.completed`, an OpenAI
 * completion), whose `usage` member holds the figures.
 */
function unwrap(raw: unknown): { figures: Obj | null; envelope: Obj | null } {
  if (!isObject(raw)) return { figures: null, envelope: null };
  if (isObject(raw.usage)) return { figures: raw.usage, envelope: raw };
  return { figures: raw, envelope: raw };
}

type Figures = Omit<NormalizedUsage, 'inputTotal' | 'cacheRatio' | 'raw'>;

function derive(base: Figures, raw: unknown): NormalizedUsage {
  const parts = [base.uncachedInput.value, base.cacheRead.value, base.cacheWrite.value];
  const inputTotal = parts.every((v) => v === null) ? null : parts.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const cacheRead = base.cacheRead.value;
  const cacheRatio = inputTotal === null || inputTotal === 0 || cacheRead === null ? null : cacheRead / inputTotal;
  return { ...base, inputTotal, cacheRatio, raw };
}

function normalizeClaude(raw: unknown): NormalizedUsage {
  const { figures: u, envelope } = unwrap(raw);
  const p = 'claude:result.usage.';
  return derive(
    {
      uncachedInput: figure(u, 'input_tokens', `${p}input_tokens`),
      cacheRead: figure(u, 'cache_read_input_tokens', `${p}cache_read_input_tokens`),
      cacheWrite: figure(u, 'cache_creation_input_tokens', `${p}cache_creation_input_tokens`),
      output: figure(u, 'output_tokens', `${p}output_tokens`),
      reasoning: figure(u, 'output_tokens_details.thinking_tokens', `${p}output_tokens_details.thinking_tokens`),
      declaredCostUsd: figure(envelope, 'total_cost_usd', 'claude:result.total_cost_usd:cumulative'),
      turns: numberAt(envelope, 'num_turns'),
    },
    raw,
  );
}

function normalizeCodex(raw: unknown): NormalizedUsage {
  const { figures: u } = unwrap(raw);
  const p = 'codex:turn.completed.usage.';
  return derive(
    {
      uncachedInput: uncachedFrom(u, 'input_tokens', 'cached_input_tokens', p),
      cacheRead: figure(u, 'cached_input_tokens', `${p}cached_input_tokens`),
      cacheWrite: figure(u, 'cache_write_input_tokens', `${p}cache_write_input_tokens`),
      output: figure(u, 'output_tokens', `${p}output_tokens`),
      reasoning: figure(u, 'reasoning_output_tokens', `${p}reasoning_output_tokens`),
      declaredCostUsd: notReported,
      turns: null,
    },
    raw,
  );
}

/** OpenAI-compatible `usage` (OpenCode and any endpoint that speaks it); `provider` prefixes the provenance. */
function normalizeOpenAi(provider: string, raw: unknown): NormalizedUsage {
  const { figures: u } = unwrap(raw);
  const p = `${provider}:usage.`;
  return derive(
    {
      uncachedInput: uncachedFrom(u, 'prompt_tokens', 'prompt_tokens_details.cached_tokens', p),
      cacheRead: figure(u, 'prompt_tokens_details.cached_tokens', `${p}prompt_tokens_details.cached_tokens`),
      cacheWrite: notReported,
      output: figure(u, 'completion_tokens', `${p}completion_tokens`),
      reasoning: figure(u, 'completion_tokens_details.reasoning_tokens', `${p}completion_tokens_details.reasoning_tokens`),
      declaredCostUsd: notReported,
      turns: null,
    },
    raw,
  );
}

/** The simulated provider reports the domain `Usage` shape, its figures measured in characters. */
function normalizeSimulated(raw: unknown): NormalizedUsage {
  const { figures: u } = unwrap(raw);
  const p = 'simulated:';
  return derive(
    {
      uncachedInput: uncachedFrom(u, 'inputTokens', 'cachedInputTokens', p),
      cacheRead: figure(u, 'cachedInputTokens', `${p}cachedInputTokens`),
      cacheWrite: notReported,
      output: figure(u, 'outputTokens', `${p}outputTokens`),
      reasoning: figure(u, 'reasoningTokens', `${p}reasoningTokens`),
      declaredCostUsd: figure(u, 'declaredCostUsd', `${p}declaredCostUsd`),
      turns: numberAt(u, 'turns'),
    },
    raw,
  );
}

function allNotReported(raw: unknown): NormalizedUsage {
  return derive(
    {
      uncachedInput: notReported,
      cacheRead: notReported,
      cacheWrite: notReported,
      output: notReported,
      reasoning: notReported,
      declaredCostUsd: notReported,
      turns: null,
    },
    raw,
  );
}

/**
 * The canonical five figures from a provider's raw usage (the table of §8). `raw` is the usage
 * object as the adapter got it, or the line that carries it; callers extract it. It never throws:
 * anything that is not an object gives every figure `not_reported`. An unknown provider is read as
 * OpenAI-compatible when it reports `prompt_tokens`; otherwise nothing is assumed.
 */
export function normalizeUsage(provider: string, raw: unknown): NormalizedUsage {
  switch (provider) {
    case 'claude':
      return normalizeClaude(raw);
    case 'codex':
      return normalizeCodex(raw);
    case 'simulated':
      return normalizeSimulated(raw);
    default: {
      const { figures } = unwrap(raw);
      return figures !== null && 'prompt_tokens' in figures ? normalizeOpenAi(provider, raw) : allNotReported(raw);
    }
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return '"unserializable"';
  }
}

/**
 * The usage attributes of the provider-call span (§6.2). Figures the provider did not report are
 * left out rather than written as 0; the provenance and the raw usage always travel, as JSON.
 */
export function usageAttributes(u: NormalizedUsage): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const put = (name: string, value: number | null) => {
    if (value !== null) out[name] = value;
  };
  put(ATTR.genAiUsageInputTokens, u.inputTotal);
  put(ATTR.genAiUsageOutputTokens, u.output.value);
  put(ATTR.genAiUsageCacheReadInputTokens, u.cacheRead.value);
  put(ATTR.genAiUsageCacheWriteInputTokens, u.cacheWrite.value);
  put(ATTR.genAiUsageReasoningOutputTokens, u.reasoning.value);
  put(ATTR.usageUncachedInputTokens, u.uncachedInput.value);
  put(ATTR.usageDeclaredCostUsd, u.declaredCostUsd.value);
  put(ATTR.usageTurns, u.turns);
  out[ATTR.usageProvenance] = safeJson({
    uncachedInput: u.uncachedInput.provenance,
    cacheRead: u.cacheRead.provenance,
    cacheWrite: u.cacheWrite.provenance,
    output: u.output.provenance,
    reasoning: u.reasoning.provenance,
    declaredCostUsd: u.declaredCostUsd.provenance,
  });
  out[ATTR.usageRaw] = safeJson(u.raw);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Context manifest (§9.1): what each builder considered and what it did with it, in PROV terms.

export const FRAGMENT_DECISIONS = ['included', 'truncated', 'summarized', 'dropped'] as const;
export type FragmentDecision = (typeof FRAGMENT_DECISIONS)[number];

export type Fragment = {
  /** Order of consideration. */
  seq: number;
  /** 'messages', 'confirmed_decisions', 'untrusted_sources', 'knowledge', 'questions', 'purpose', 'design_stage'… */
  section: string;
  /** The authority entity it derives from. */
  source: { type: string; id: string; version: number | null; eventSeq: number | null };
  /** Hash of the text as it entered (or would have entered) the pack. */
  textHash: string;
  /** Final size. */
  chars: number;
  /** Size before trimming. */
  originalChars: number;
  decision: FragmentDecision;
  /** 'budget:messages', 'limit:60', 'excerpt:2000', 'relevance:0.31', 'below_threshold', 'state:discarded'… */
  reason: string;
  /** Relevance when there is one. */
  score: number | null;
  /** Position in the pack when it entered. */
  position: number | null;
};

export type Manifest = {
  /** Builder with version, e.g. 'exploration_chat@2'. */
  builder: string;
  graphVersion: number;
  budget: Record<string, number>;
  fragments: Fragment[];
  /** How many candidates were considered. */
  candidates: number;
};

export type ManifestSummary = {
  /** Characters of every fragment that entered the pack (included, truncated or summarized). */
  includedChars: number;
  droppedCount: number;
  /** Per section: fragments that entered, their characters, and fragments dropped. */
  bySection: Record<string, { included: number; chars: number; dropped: number }>;
};

/** Totals of a manifest: what entered, what fell out, and how much each section filled. */
export function manifestSummary(m: Manifest): ManifestSummary {
  const bySection: ManifestSummary['bySection'] = {};
  let includedChars = 0;
  let droppedCount = 0;
  for (const f of m.fragments) {
    const s = (bySection[f.section] ??= { included: 0, chars: 0, dropped: 0 });
    if (f.decision === 'dropped') {
      s.dropped += 1;
      droppedCount += 1;
    } else {
      s.included += 1;
      s.chars += f.chars;
      includedChars += f.chars;
    }
  }
  return { includedChars, droppedCount, bySection };
}
