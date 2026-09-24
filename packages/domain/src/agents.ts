// Puerto de agentes (System Two). Un agente solo produce una salida cruda; el sistema la
// valida con el esquema común y, si no cumple, la ejecución acaba en `invalid_output`
// sin ningún efecto (I7).

import { z } from 'zod';

export const AGENT_ACTIONS = ['echo', 'exploration_chat', 'design_proposal'] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

/** Tipos de fallo cerrados (docs/investigacion-stack-2026-09-24.md §8). */
export const FAILURE_KINDS = ['infra', 'timeout', 'invalid_output', 'agent_error', 'cancelled', 'stale_knowledge'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  declaredCostUsd?: number;
};

export type AgentRequest = {
  runId: string;
  action: AgentAction;
  method: { version: string; text: string };
  /** JSON Schema generado desde el esquema Zod de la acción. */
  outputSchema: Record<string, unknown>;
  context: { hash: string; content: unknown };
  budget: { timeMs: number; maxUsd?: number };
  model?: string;
  signal?: AbortSignal;
};

export type AgentResult =
  | { state: 'ok'; rawOutput: unknown; usage: Usage; rawEvents: string; provider: string; model: string }
  | {
      state: 'error';
      failureKind: Exclude<FailureKind, 'invalid_output'>;
      message: string;
      usage?: Usage;
      rawEvents: string;
      provider: string;
      model: string;
    };

export interface AgentPort {
  readonly provider: string;
  execute(request: AgentRequest): Promise<AgentResult>;
}

// Esquemas de salida por acción: la única fuente del contrato (Zod → JSON Schema).

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
  // draft-07: es el borrador que valida la CLI de Claude (2.1.281); así el esquema viaja tal cual.
  return z.toJSONSchema(OUTPUT_SCHEMAS[action], { target: 'draft-7' });
}
