// Agent port (System Two). An agent only produces a raw output; the system validates it
// against the common schema and, if it fails, the run ends in `invalid_output`
// with no effect at all (I7).

import { z } from 'zod';

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

export type AgentRequest = {
  runId: string;
  action: AgentAction;
  method: { version: string; text: string };
  /** JSON Schema generated from the action's Zod schema. */
  outputSchema: Record<string, unknown>;
  context: { hash: string; content: unknown };
  budget: { timeMs: number; maxUsd?: number };
  model?: string;
  signal?: AbortSignal;
};

/** `sessionId`: the provider's conversation id, when it ran with a session. */
export type AgentResult =
  | { state: 'ok'; rawOutput: unknown; usage: Usage; rawEvents: string; provider: string; model: string; sessionId?: string }
  | {
      state: 'error';
      failureKind: Exclude<FailureKind, 'invalid_output'>;
      message: string;
      usage?: Usage;
      rawEvents: string;
      provider: string;
      model: string;
      sessionId?: string;
    };

export interface AgentPort {
  readonly provider: string;
  execute(request: AgentRequest): Promise<AgentResult>;
}

// Provider port (ADR-AGE-001 v2): each engine (Claude, Codex, OpenCode, simulated) behind the same
// interface. A DEMIURGO agent (AGENT.md + skills) runs on whichever provider the person assigned.

export const PROVIDER_IDS = ['claude', 'codex', 'opencode', 'simulated'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Normalized kinds of the events a provider streams while it works. */
export const PROVIDER_EVENT_KINDS = ['started', 'thinking', 'message', 'usage', 'result', 'error'] as const;
export type ProviderEventKind = (typeof PROVIDER_EVENT_KINDS)[number];

/** One event of the provider's stream: its normalized kind and the raw line it came from. */
export type ProviderEvent = { kind: ProviderEventKind; raw: string; tokens?: number };

/** Conversation with the provider: none, a new one, or one resumed by its id (in its stable folder). */
export type SessionRequest =
  | { mode: 'none' }
  | { mode: 'fresh'; directory: string }
  | { mode: 'resumed'; directory: string; id: string };

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

export const echoOutput = z.object({ reply: text(2000) }).strict();

export const explorationChatOutput = z
  .object({
    reply: text(6000),
    observations: z.array(z.object({ type: z.enum(['claim', 'hypothesis', 'unknown']), text: text(1000) }).strict()).max(10),
    questions: z
      .array(z.object({ question: text(500), reason: text(500), impact: z.enum(['high', 'medium', 'low']) }).strict())
      .max(5),
    inferences: z
      .array(z.object({ question_id: z.string().uuid(), conclusion: text(1500), reasoning: text(1500) }).strict())
      .max(5),
    proposals: z
      .array(
        z.discriminatedUnion('type', [
          z
            .object({
              type: z.literal('decision'),
              title: text(160),
              context: text(3000),
              decision: text(3000),
              consequences: text(3000),
            })
            .strict(),
          z.object({ type: z.literal('exploration'), purpose: text(500) }).strict(),
        ]),
      )
      .max(5),
  })
  .strict();

export const proposedCriterion = z
  .object({
    title: text(160),
    statement: text(1500),
    verification: z.enum(['automatic', 'manual']),
    check: text(600),
  })
  .strict();

export const designProposalOutput = z
  .object({
    fdr: z
      .object({
        title: text(160),
        goal: text(3000),
        scope: text(3000),
        out_of_scope: text(3000),
        behavior: text(6000),
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
  return z.toJSONSchema(OUTPUT_SCHEMAS[action], { target: 'draft-7' });
}
