// Agents and providers (System Two). A provider only produces a raw output; the system validates
// it against the action's schema and, if it fails, the run ends in `invalid_output` with no effect
// at all (I7).

import { z } from 'zod';
import { DEFINITION_SECTION_TITLES, QUOTE_MAX } from './definition.ts';

export const AGENT_ACTIONS = ['echo', 'exploration_chat', 'design_proposal'] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

/** Closed failure kinds (docs/investigacion-stack-2026-09-24.md §8). */
export const FAILURE_KINDS = ['infra', 'timeout', 'invalid_output', 'agent_error', 'cancelled', 'stale_knowledge'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  declaredCostUsd?: number;
  /** Input tokens read from the provider's cache (part of `inputTokens`). */
  cachedInputTokens?: number;
  /** Output tokens spent reasoning (part of `outputTokens`). */
  reasoningTokens?: number;
  turns?: number;
  /** Where each figure comes from in the provider's output, or `not_reported`. */
  provenance?: Readonly<Record<string, string>>;
};

/**
 * What an adapter knows about the call beyond the product's `Usage`, for the observability engine
 * (docs/superpowers/specs/2026-09-26-motor-observabilidad-design.md §7.6). Every field is optional
 * and none of them changes the run's behaviour: they are evidence, not input to any decision.
 */
export type AgentResultDetails = {
  /** Version the CLI reported (e.g. `claude_code_version`, `codex --version`). */
  cliVersion?: string;
  /** argv of the child process, without its environment. */
  cliCommand?: readonly string[];
  cliCwd?: string;
  /** Exit code of the child process; null when it ended by signal. */
  exitCode?: number | null;
  /** Whole stderr; the span carries only its hash and the text travels apart. */
  stderr?: string;
  /** Time the provider reports its own API took, when it reports it. */
  durationApiMs?: number;
  /** Time to first token, when the provider reports it. */
  ttftMs?: number;
  stopReason?: string;
  /** The provider's usage object as it came, before any normalization. */
  rawUsage?: unknown;
  /** The CLI's transcript file after the call, when the adapter located it. */
  transcriptPath?: string;
  /** Attempts made by the adapter (e.g. OpenCode retries) with their reasons. */
  attempts?: readonly unknown[];
  /** Anything else the adapter wants kept (Claude's `modelUsage`, Codex's raw `-o` file…). */
  extra?: Readonly<Record<string, unknown>>;
};

/** `sessionId`: the provider's conversation id, when it ran with a session. `details`: evidence only. */
export type AgentResult =
  | {
      state: 'ok';
      rawOutput: unknown;
      usage: Usage;
      rawEvents: string;
      provider: string;
      model: string;
      sessionId?: string;
      details?: AgentResultDetails;
    }
  | {
      state: 'error';
      failureKind: Exclude<FailureKind, 'invalid_output'>;
      message: string;
      usage?: Usage;
      rawEvents: string;
      provider: string;
      model: string;
      sessionId?: string;
      details?: AgentResultDetails;
    };

// Provider port (ADR-AGE-001 v2): each engine (Claude, Codex, OpenCode, simulated) behind the same
// interface. A DEMIURGO agent (AGENT.md + skills) runs on whichever provider the person assigned.

export const PROVIDER_IDS = ['claude', 'codex', 'opencode', 'simulated'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Normalized kinds of the events a provider streams while it works. */
export const PROVIDER_EVENT_KINDS = ['started', 'thinking', 'message', 'usage', 'result', 'error'] as const;
export type ProviderEventKind = (typeof PROVIDER_EVENT_KINDS)[number];

/** One event of the provider's stream: its normalized kind and the raw line it came from. */
export type ProviderEvent = { kind: ProviderEventKind; raw: string; tokens?: number };

/**
 * Conversation with the provider: none, a new one, or one resumed by its id (in its stable folder).
 * A fresh session may carry the `id` DEMIURGO decided (adapters that can fix the id, like Claude's
 * `--session-id`, use it as is; the rest generate their own and return it) and a visible `name` for
 * the CLI's own session listing (§5.4).
 */
export type SessionRequest =
  | { mode: 'none' }
  | { mode: 'fresh'; directory: string; id?: string; name?: string }
  | { mode: 'resumed'; directory: string; id: string };

/**
 * What the child CLI needs to join its own telemetry to DEMIURGO's trace (spec §7.6): the
 * traceparent of the provider-call span, the resource attributes that identify the call, and the
 * collector. Only present while observation is on; adapters pass it per call, never inherited.
 */
export type ProviderTrace = {
  traceParent: string;
  resourceAttributes: Readonly<Record<string, string>>;
  otlpEndpoint: string | null;
  environment: string;
};

export type ProviderInvocation = {
  system: string;
  input: string;
  /** JSON Schema generated from the action's Zod schema. */
  schema: Record<string, unknown>;
  model: string;
  effort: string | null;
  session: SessionRequest;
  timeMs: number;
  signal?: AbortSignal;
  onEvent?: (event: ProviderEvent) => void;
  /** Only the simulated provider reads it: the task it simulates. */
  task?: { action: string; context: { hash: string; content: unknown } };
  /** Telemetry for the child CLI, when observation is on. */
  trace?: ProviderTrace;
};

export type ProviderModel = {
  id: string;
  label: string;
  /** Empty when the model has no reasoning levels to choose from. */
  efforts: readonly string[];
  defaultEffort: string | null;
};

/** What discovery finds, without spending quota. */
export type ProviderCatalog = {
  provider: ProviderId;
  label: string;
  installed: boolean;
  version: string | null;
  /** Signed in, or the local endpoint answers. */
  ready: boolean;
  message: string | null;
  /** Whether it can resume a conversation. */
  sessions: boolean;
  models: readonly ProviderModel[];
  /**
   * False when the provider answered but its models (or their efforts) couldn't be listed this
   * time: that says nothing about what it offers, so the last models found are kept.
   */
  listed?: boolean;
};

export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  readonly sessions: boolean;
  discover(): Promise<ProviderCatalog>;
  run(invocation: ProviderInvocation): Promise<AgentResult>;
}

// Output schemas by action: the single source of truth for the contract (Zod → JSON Schema).

const text = (max: number) => z.string().trim().min(1).max(max);

/** A text that becomes part of the project's record: always in English (only `reply` follows the person). */
const recordText = (max: number) => text(max).describe('In English.');

export const echoOutput = z.object({ reply: text(2000) }).strict();

export const proposedCriterion = z
  .object({
    title: recordText(160),
    statement: recordText(1500),
    verification: z.enum(['automatic', 'manual']),
    check: recordText(600),
  })
  .strict();

/** A predefined answer to a question and what choosing it implies for the design. */
// `exclusive`: in a multiple-choice question, choosing it clears the others (e.g. "None for now").
export const questionOption = z.object({ answer: recordText(300), implies: recordText(300), exclusive: z.boolean() }).strict();

/**
 * The answer a side conversation about one question (Go deeper) leads to, worded as one more option:
 * the idea the person and the agent arrived at, not a copy of a reply. Null while it isn't clear.
 */
export const conversationOption = z
  .object({
    answer: recordText(600).describe(
      'In English: the answer as the person would pick it, self-contained, with everything the conversation added.',
    ),
    implies: recordText(600).describe('In English: what choosing it implies for the design.'),
  })
  .strict();

export const explorationChatOutput = z
  .object({
    reply: text(6000),
    // The thread's purpose rewritten as a summary of what it has designed so far; null keeps it.
    purpose: recordText(1000).nullable(),
    observations: z
      .array(z.object({ type: z.enum(['claim', 'hypothesis', 'unknown']), text: recordText(1000) }).strict())
      .max(10),
    questions: z
      .array(
        z
          .object({
            question: recordText(500),
            reason: recordText(500),
            impact: z.enum(['high', 'medium', 'low']),
            // Whether the person may pick several options (e.g. what is out of scope).
            multiple: z.boolean(),
            // 2 to 4 likely answers the person can pick with one click; empty when none fits.
            options: z.array(questionOption).max(4),
          })
          .strict(),
      )
      .max(5),
    // Likely answers for questions already pending in the context pack (e.g. a stage's mandatory ones),
    // and their wording in the person's language when they were written in another (null keeps it).
    question_options: z
      .array(
        z
          .object({
            question_id: z.string().uuid(),
            options: z.array(questionOption).max(4),
            multiple: z.boolean(),
            question: recordText(500).nullable(),
            reason: recordText(500).nullable(),
          })
          .strict(),
      )
      .max(8),
    // Only asked for when the run answers a side conversation (`question_in_progress`): see run-schema.ts.
    conversation_option: conversationOption.nullable().optional(),
    inferences: z
      .array(
        z
          .object({
            question_id: z.string().uuid(),
            conclusion: recordText(1500),
            reasoning: recordText(1500),
            // The evidence: without a quote the server can find in the person's messages, there is no inference.
            quotes: z
              .array(text(QUOTE_MAX))
              .max(3)
              .describe("The person's exact words the conclusion rests on, copied verbatim in their language."),
          })
          .strict(),
      )
      .max(12),
    proposals: z
      .array(
        z.discriminatedUnion('type', [
          z
            .object({
              type: z.literal('decision'),
              title: recordText(160),
              context: recordText(3000),
              decision: recordText(3000),
              consequences: recordText(3000),
            })
            .strict(),
          z.object({ type: z.literal('exploration'), purpose: recordText(500) }).strict(),
          z
            .object({
              type: z.literal('design_record'),
              record_type: z.enum(['fdr', 'requirement', 'quality_requirement', 'threat_model', 'production_readiness', 'adr']),
              title: recordText(160),
              sections: z
                .array(z.object({ title: recordText(120), content: recordText(6000) }).strict())
                .min(1)
                .max(8),
              criteria: z.array(proposedCriterion).min(1).max(12),
            })
            .strict(),
          // A section of the approved product definition changes because the person decided so here.
          z
            .object({
              type: z.literal('definition_change'),
              section: z.enum(DEFINITION_SECTION_TITLES),
              content: recordText(3000).describe('The whole section as it should read after the change, in English.'),
              reason: recordText(1000),
              quotes: z
                .array(text(QUOTE_MAX))
                .min(1)
                .max(3)
                .describe("The person's exact words in this thread the change rests on, copied verbatim in their language."),
            })
            .strict(),
        ]),
      )
      .max(15),
  })
  .strict();

export const designProposalOutput = z
  .object({
    fdr: z
      .object({
        title: recordText(160),
        goal: recordText(3000),
        scope: recordText(3000),
        out_of_scope: recordText(3000),
        behavior: recordText(6000),
        criteria: z.array(proposedCriterion).min(1).max(12),
      })
      .strict(),
  })
  .strict();

export const OUTPUT_SCHEMAS = {
  echo: echoOutput,
  exploration_chat: explorationChatOutput,
  design_proposal: designProposalOutput,
} as const satisfies Record<AgentAction, z.ZodType>;

export type ActionOutput<A extends AgentAction> = z.infer<(typeof OUTPUT_SCHEMAS)[A]>;

export function jsonSchemaOf(action: AgentAction): Record<string, unknown> {
  // draft-07: the draft the Claude CLI (2.1.281) validates; this way the schema travels as is.
  const schema = z.toJSONSchema(OUTPUT_SCHEMAS[action], { target: 'draft-7' }) as Record<string, unknown>;
  // An optional field is never sent as is (strict providers need every property required): a run
  // adds the ones its context pack calls for (runSchemaOf).
  const properties = schema.properties as Record<string, unknown> | undefined;
  const required = (schema.required as string[] | undefined) ?? [];
  if (!properties) return schema;
  return { ...schema, properties: Object.fromEntries(Object.entries(properties).filter(([k]) => required.includes(k))) };
}
