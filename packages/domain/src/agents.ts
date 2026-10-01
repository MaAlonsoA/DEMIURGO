// Agents and providers (System Two). A provider only produces a raw output; the system validates
// it against the action's schema and, if it fails, the run ends in `invalid_output` with no effect
// at all (I7).

import { TASK_SIZES } from './sizes.ts';
import { aspectSchema } from './aspects.ts';
import { VERSION_LIMITS } from './records.ts';
import { z } from 'zod';
import { DEFINITION_SECTION_TITLES, QUOTE_MAX } from './definition.ts';
import { designSystemSpec, designTokens } from './design-system.ts';
import { screenDesignSpec } from './screen-design.ts';

export const AGENT_ACTIONS = [
  'echo',
  'exploration_chat',
  'design_proposal',
  'coherence_review',
  'epic_plan',
  'feature_design',
  'task_plan',
  'design_directions',
  'design_system_plan',
  'screen_design',
  'pr_review',
  'task_forensics',
  'playbook_write',
  'known_error_curate',
] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

/** Closed failure kinds (docs/investigacion-stack-2026-09-24.md §8). */
export const FAILURE_KINDS = ['infra', 'timeout', 'invalid_output', 'agent_error', 'cancelled', 'stale_knowledge', 'quota'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

/** Words an engine uses when the subscription's usage limit, a rate limit or a quota stopped it. */
const QUOTA_WORDS = /usage limit|rate[ _-]?limit|quota|\b429\b|too many requests/i;

/** Whether an engine's error text says it hit a usage, rate or quota limit (`quota`, which falls back). */
export function isQuotaError(text: string | null | undefined): boolean {
  return !!text && QUOTA_WORDS.test(text);
}

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

/** The design records a conversation may still propose: the ones that are not delivery records (epic, feature, task). */
export const NON_DELIVERY_RECORD_TYPES = ['requirement', 'quality_requirement', 'threat_model', 'production_readiness', 'adr'] as const;

/** A text that becomes part of the project's record: always in English (only `reply` follows the person). */
const recordText = (max: number) => text(max).describe('In English.');

export const echoOutput = z.object({ reply: text(2000) }).strict();

/** The Behavior step (1-based) a criterion checks; null only for records without Behavior (tasks, epics). */
const stepRef = z
  .number()
  .int()
  .min(1)
  .nullable()
  .describe('The 1-based number of the Behavior step this criterion checks; null only for records without a Behavior section.');

export const proposedCriterion = z
  .object({
    title: recordText(160),
    statement: recordText(1500),
    verification: z.enum(['automatic', 'manual', 'release']),
    check: recordText(600),
    step: stepRef,
  })
  .strict();

/** A criterion written as Given/When/Then: the three parts stay apart so they can be checked and shown separately. */
export const gwtCriterion = z
  .object({
    title: recordText(160),
    given: recordText(500).describe('The precondition, one plain sentence, without the word "Given".'),
    when: recordText(500).describe('The action or event, one plain sentence, without the word "When".'),
    then: recordText(500).describe('The observable result, one plain sentence, without the word "Then".'),
    verification: z.enum(['automatic', 'manual', 'release']),
    check: recordText(600),
    step: z.number().int().min(1).describe('The 1-based number of the Behavior step this criterion checks.'),
  })
  .strict();

/** The composed sentence of a Given/When/Then criterion (what `statement` keeps for older readers). */
export function composeStatement(parts: { given: string; when: string; then: string }): string {
  const clean = (t: string) => t.trim().replace(/\.+$/, '');
  return `Given ${clean(parts.given)}, when ${clean(parts.when)}, then ${clean(parts.then)}.`;
}

/** A practice source an agent based a version on (unverified: the person checks it). */
export const practiceSource = z
  .object({
    title: z.string().trim().min(1).max(200),
    url: z.string().url().max(500),
    used_for: z.string().trim().min(1).max(300),
  })
  .strict();
export const practiceSources = z.array(practiceSource).max(12);

/** A predefined answer to a question and what choosing it implies for the design. */
// `exclusive`: in a multiple-choice question, choosing it clears the others (e.g. "None for now").
// `recommended`: the one option the agent advises (at most one per question); `downside`: its main cost.
export const questionOption = z
  .object({
    answer: recordText(300),
    implies: recordText(300),
    exclusive: z.boolean(),
    recommended: z.boolean().optional(),
    downside: recordText(300).optional(),
  })
  .strict();
const atMostOneRecommended = (options: { recommended?: boolean | undefined }[]) =>
  options.filter((o) => o.recommended).length <= 1;
const optionList = z.array(questionOption).max(4).refine(atMostOneRecommended, 'At most one option may be recommended.');

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
            options: optionList,
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
            options: optionList,
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
              aspect: aspectSchema.describe(
                "The part of the product this decision's own text is about; never the thread's, its parent's or the open stage's.",
              ),
              quotes: z
                .array(text(QUOTE_MAX))
                .max(3)
                .describe("The person's exact words in this thread the proposal rests on, copied verbatim in their language; empty when none."),
            })
            .strict(),
          z.object({ type: z.literal('exploration'), purpose: recordText(500) }).strict(),
          // Requirements, quality requirements, threat models, production readiness and ADRs. Epics, features and
          // tasks are drafted by their own agents (epic_plan, feature_design, task_plan), never in a conversation.
          z
            .object({
              type: z.literal('design_record'),
              record_type: z.enum(NON_DELIVERY_RECORD_TYPES),
              title: recordText(160),
              sections: z
                .array(z.object({ title: recordText(120), content: recordText(6000) }).strict())
                .min(1)
                .max(8),
              criteria: z.array(proposedCriterion).max(VERSION_LIMITS.criteria),
              quotes: z
                .array(text(QUOTE_MAX))
                .max(3)
                .describe("The person's exact words in this thread the proposal rests on, copied verbatim in their language; empty when none."),
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
          // The record the thread is about changes (sections and criteria) because the person decided so here.
          z
            .object({
              type: z.literal('record_change'),
              code: z
                .string()
                .regex(/^[A-Z]{3}-[A-Z]{3}-\d{3}$/)
                .describe('The record the thread is about (about_record), which has an approved version.'),
              sections: z
                .array(
                  z
                    .object({
                      section: recordText(120).describe("The title of one of the sections of that record's current version."),
                      content: recordText(6000).describe('The whole section as it should read after the change, in English.'),
                    })
                    .strict(),
                )
                .max(8)
                .describe('Only the sections that change, each whole; empty when only criteria change.'),
              criteria: z
                .array(
                  z
                    .object({
                      action: z.enum(['add', 'modify', 'drop']),
                      code: z
                        .string()
                        .regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/)
                        .nullable()
                        .describe('For modify and drop: the code of one of `about_record.criteria`; null for add.'),
                      title: recordText(160).nullable().describe('For add and modify: the whole new title; null for drop.'),
                      statement: recordText(1500).nullable().describe('For add and modify: the whole new statement (Given/when/then); null for drop.'),
                      verification: z.enum(['automatic', 'manual', 'release']).nullable().describe('For add and modify; null for drop.'),
                      check: recordText(600).nullable().describe('For add and modify: how it is checked; null for drop.'),
                      step: stepRef.describe('For add and modify of a feature criterion: the Behavior step it checks; null otherwise.'),
                    })
                    .strict(),
                )
                .max(VERSION_LIMITS.criteria)
                .describe('Only the criteria that change: added, modified (whole new content) or dropped; the rest are kept. Empty when only sections change.'),
              reason: recordText(1000),
              quotes: z
                .array(text(QUOTE_MAX))
                .min(1)
                .max(3)
                .describe("The person's exact words in this thread the change rests on, copied verbatim in their language."),
            })
            .strict(),
          // The list of features of the epic the thread is about changes because the person decided so here.
          z
            .object({
              type: z.literal('feature_plan'),
              epic: z
                .string()
                .regex(/^EPC-[A-Z]{3}-\d{3}$/)
                .describe('The epic the thread is about (about_record), draft or approved.'),
              action: z.enum(['add', 'drop', 'move']),
              code: z
                .string()
                .regex(/^FDR-[A-Z]{3}-\d{3}$/)
                .nullable()
                .describe(
                  'For drop and move: the code of the feature, one of `about_record.features`; null for add. A drop only applies to a feature that is still `planned`.',
                ),
              name: recordText(120).nullable().describe('For add: the short name of the new feature; null otherwise.'),
              summary: recordText(300)
                .nullable()
                .describe('For add: one sentence of what the new feature lets the person do; null otherwise.'),
              position: z
                .number()
                .int()
                .positive()
                .nullable()
                .describe(
                  'For add: the place in the list (1 is the first), null to put it last; for move: the new place; null for drop.',
                ),
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
    // Whether the thread has enough to draft an epic, a feature or its tasks: the person presses "Draft"
    // and a dedicated agent writes it. Null when it is not ready.
    ready_to_draft: z
      .object({
        kind: z.enum(['epic', 'feature', 'tasks', 'design_directions']),
        why: recordText(300).describe('One sentence on why the thread has enough to draft it now.'),
      })
      .strict()
      .nullable()
      .default(null),
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
        criteria: z.array(proposedCriterion).min(1).max(VERSION_LIMITS.criteria),
      })
      .strict(),
  })
  .strict();

/** A feature the epic lists (or a split produces): a short name and one sentence of what it lets the person do. */
const plannedFeatureOutput = z.object({ name: recordText(120), summary: recordText(300) }).strict();

const recordRef = z.object({ code: z.string().regex(/^[A-Z]{3}-[A-Z]{3}-\d{3}$/), version: z.number().int().positive() }).strict();

/** epic_plan: a dedicated agent drafts the epic of a thread from the whole conversation. */
export const epicPlanOutput = z
  .object({
    reply: text(2000).describe("One to three sentences in the person's language: what the draft covers and what to look at first."),
    epic: z
      .object({
        title: recordText(160),
        domain: z
          .string()
          .regex(/^[a-z][a-z_]*$/)
          .describe("The epic's short name in snake_case (its first three letters make the code, e.g. guided_design → EPC-GUI-001, FDR-GUI-001)."),
        goal: recordText(1000).describe('One clause naming the outcome of the product definition it serves.'),
        out_of_scope: recordText(3000).describe('What the epic deliberately leaves out: what the product definition leaves out or what later epics take.'),
        done_when: recordText(1500).describe('A short paragraph: when the epic counts as done.'),
        criteria: z
          .array(gwtCriterion.omit({ step: true }))
          .min(1)
          .max(VERSION_LIMITS.criteria)
          .describe('Given/When/Then criteria that check the whole walk of the epic, not one feature.'),
        features: z
          .array(plannedFeatureOutput)
          .min(1)
          .max(20)
          .describe('The epic\'s features in order, the thinnest end-to-end walk first.'),
      })
      .strict(),
    sources: practiceSources,
  })
  .strict();

/** The splitting patterns of SPIDR (Mike Cohn) and Richard Lawrence's story-splitting flowchart, closed to what the schema names. */
export const SPLIT_PATTERNS = ['spike', 'paths', 'interfaces', 'data', 'rules', 'other'] as const;

/** feature_design: a dedicated agent designs one planned feature, or says it must be split. */
export const featureDesignOutput = z
  .object({
    reply: text(2000).describe("One to three sentences in the person's language."),
    result: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('feature'),
          feature: z
            .object({
              title: recordText(160),
              goal: recordText(3000),
              scope: recordText(3000),
              out_of_scope: recordText(3000),
              steps: z
                .array(recordText(300))
                .min(1)
                .max(20)
                .describe('The main success scenario, one short line per step: what the person does and sees. No rules or edge cases.'),
              criteria: z.array(gwtCriterion).min(1).max(VERSION_LIMITS.criteria),
              size: z.enum(['XS', 'S', 'M', 'L']).describe('Relative T-shirt size against its sibling features; an XL is not a feature: split it.'),
              size_reason: recordText(300),
              needs: z
                .array(recordRef)
                .max(6)
                .describe('The approved features of the project (of any epic, or none) that must be built first, each with its current version; empty when none.'),
            })
            .strict(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('split'),
          reason: recordText(600).describe('Why it is too big to be one feature.'),
          pattern: z.enum(SPLIT_PATTERNS),
          features: z.array(plannedFeatureOutput).min(2).max(8).describe('The features that replace it, in order.'),
        })
        .strict(),
    ]),
    sources: practiceSources,
  })
  .strict();

/** task_plan: a dedicated agent breaks an approved feature into tasks. */
export const taskPlanOutput = z
  .object({
    reply: text(2000).describe("One to three sentences in the person's language."),
    tasks: z
      .array(
        z
          .object({
            title: recordText(160),
            goal: recordText(1500),
            scope: recordText(1500),
            covers: z
              .array(z.string().regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/))
              .min(1)
              .max(VERSION_LIMITS.criteria)
              .describe("The codes of the feature's criteria this task implements."),
            size: z.enum(TASK_SIZES),
            size_reason: recordText(300),
            split: recordText(600).nullable().describe('For an XL task: how it could be split; null otherwise.'),
            walking_skeleton: z.boolean().describe("True only for the project's very first task, when the context says `first_feature`."),
            depends_on: z
              .array(z.number().int().min(1).max(19))
              .max(19)
              .describe('The 1-based positions of EARLIER tasks in this list that must be done before this one starts; empty when none.'),
            depends_on_existing: z
              .array(z.string().regex(/^TSK-[A-Z]{3}-\d{3}$/))
              .max(6)
              .default([])
              .describe(
                'Codes of tasks that ALREADY exist (of this feature or another; see `existing_tasks` and `built_state`) that must be done before this one starts, because it extends what they built; empty when none.',
              ),
            waits_for_features: z
              .array(z.string().regex(/^FDR-[A-Z]{3}-\d{3}$/))
              .max(6)
              .describe(
                'Codes of OTHER features (`other_features`) that must be fully built before this task can start, because a criterion it covers can only be checked once they exist; empty when none.',
              ),
          })
          .strict(),
      )
      .min(0)
      .max(20)
      .describe('In the order they are built. May be empty when the request only re-assigns criteria between existing tasks.'),
    task_changes: z
      .array(
        z
          .object({
            code: z.string().regex(/^TSK-[A-Z]{3}-\d{3}$/).describe('An existing task of `existing_tasks` that is not merged (`changeable`).'),
            covers: z
              .array(z.string().regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/))
              .min(1)
              .max(VERSION_LIMITS.criteria)
              .describe("The task's WHOLE new list of covered criteria."),
            scope: recordText(1500).describe("The task's new Scope text, saying what changed (e.g. which criterion moved out and where)."),
            goal: recordText(1500).nullable().describe("The task's new Goal text; null to keep it."),
          })
          .strict(),
      )
      .max(10)
      .describe(
        "Changes to existing tasks that are not merged, only when the person's `request` asks to re-assign criteria; empty otherwise.",
      ),
    sources: practiceSources,
  })
  .strict();

/**
 * design_directions: two or three visual directions for a design system, each with a style tile
 * (Samantha Warren): a self-contained page with type, colors, a button and an input in their states and
 * a small CSS animation. Nothing is proposed: the person picks one in the thread.
 */
export const DIRECTION_TILE_MAX = 30_000;
export const designDirectionsOutput = z
  .object({
    reply: text(2000).describe("One to three sentences in the person's language."),
    directions: z
      .array(
        z
          .object({
            name: recordText(60).describe('A short, distinct name.'),
            why: recordText(600).describe("Why this direction fits what the person said: who it is for and what it should convey."),
            tokens: designTokens.pick({ color: true, typography: true, motion: true }),
            tile_html: text(DIRECTION_TILE_MAX).describe(
              'A style tile: one self-contained HTML page with inline CSS, no scripts and no external URLs.',
            ),
          })
          .strict(),
      )
      .min(2)
      .max(3),
    sources: practiceSources,
  })
  .strict();

/** design_system_plan: a dedicated agent writes the whole design system record from the thread and the chosen direction. */
export const designSystemPlanOutput = z
  .object({
    reply: text(2000).describe("One to three sentences in the person's language."),
    result: z
      .object({
        title: recordText(200),
        sections: z
          .object({
            Principles: recordText(10_000),
            'Visual direction': recordText(10_000),
            Tokens: recordText(10_000),
            Components: recordText(10_000),
            Patterns: recordText(10_000),
            Motion: recordText(10_000),
            Accessibility: recordText(10_000),
            Governance: recordText(10_000),
          })
          .strict(),
        spec: designSystemSpec,
        change_note: recordText(2000).nullable().describe('When the system already has an approved version: what changes and why; null otherwise.'),
      })
      .strict(),
    sources: practiceSources,
  })
  .strict();

/** screen_design: a dedicated agent designs the screens of an approved feature with the project's approved design system. */
export const screenDesignOutput = z
  .object({
    reply: text(2000).describe("One to three sentences in the person's language."),
    result: z
      .object({
        title: recordText(200),
        sections: z
          .object({
            Flow: recordText(10_000),
            Screens: recordText(10_000),
            States: recordText(10_000),
            Components: recordText(10_000),
          })
          .strict(),
        spec: screenDesignSpec,
        change_note: recordText(2000).nullable().describe('When the feature already has a screen design: what changes and why; null otherwise.'),
      })
      .strict(),
    sources: practiceSources,
  })
  .strict();

/** pr_review: the verdict of the reviewer agent on a build request's pull request. */
export const PR_REVIEW_MAX_COMMENTS = 40;
export const prReviewOutput = z
  .object({
    verdict: z.enum(['approve', 'request_changes']),
    summary: text(1500).describe('What the change does and why the verdict, in a few sentences.'),
    comments: z
      .array(
        z
          .object({
            path: z.string().trim().min(1).max(500),
            line: z.number().int().positive().nullable().describe('The line in the new file, or null for the whole file.'),
            severity: z
              .enum(['blocking', 'fix', 'nit', 'question'])
              .describe('blocking: must change and needs a new review. fix: a minor change that must be made before merging and needs no new review (the builder applies it, you still approve). nit: optional. question: a doubt to answer.'),
            body: text(1500),
            needs_person: z
              .boolean()
              .describe('True only when resolving this comment needs something only a person can provide: a deployed environment, a manual audit, credentials or access, or a decision about scope or the criterion itself. False for anything the builder can change in code or tests.'),
          })
          .strict(),
      )
      .max(PR_REVIEW_MAX_COMMENTS),
    criteria: z
      .array(
        z
          .object({
            code: z.string().regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/),
            test_name: z.string().trim().min(1).max(500).nullable().describe('The title of the automated test that checks it, or null when there is none.'),
            covered: z.boolean(),
            note: text(500),
          })
          .strict(),
      )
      .describe('Exactly the criteria the task covers, one entry each.'),
    sources: practiceSources,
  })
  .strict();

/** Dimensions of a root cause or an improvement of a task forensic: where in DEMIURGO's system the cause lives (never a person, never «the model»). */
export const FORENSIC_DIMENSIONS = ['rules', 'prompt', 'context', 'graph', 'jev', 'process', 'engine', 'environment', 'other'] as const;
export const FORENSIC_OUTCOMES = ['clean', 'rework', 'failed', 'abandoned', 'in_progress'] as const;
export const FORENSIC_VERDICTS = ['worked', 'contributed_to_error', 'could_have_prevented', 'missing', 'not_applicable'] as const;
const forensicEvidence = text(500).describe('The evidence cited: step ids, review comment, task version n, escape or test names. Never a claim without one.');
const forensicPhase = z
  .string()
  .regex(/^P(0|1[0-3]|[1-9])$/)
  .describe('The design phase: P1 definition, P2 quality, P3 principles and decisions, P4 design system, P5 epics, features and criteria, P6 screens, P7 tasks, P9 building, P10 review, P13 use.');
const forensicClass = z
  .string()
  .regex(/^(E\d{2}|[a-z][a-z0-9_]*|other:[a-z0-9_-]+)$/)
  .describe('An escape rule code (E01…E17) when the problem matches one; else a build failure class (usage_limit, login, timeout, out_of_memory, cancelled, infra, tdd_red, provider_error, harness, other); else `other:<slug>`.');
const forensicCost = z
  .object({ attempts: z.number().int().nonnegative().optional(), minutes: z.number().nonnegative().optional(), usd: z.number().nonnegative().optional() })
  .strict();

/** The statuses of an entry of the known-error vault (a Known Error Database in the sense of ITIL Problem Management). */
export const KNOWN_ERROR_STATUSES = ['open', 'fix_claimed', 'validated', 'recurred'] as const;
export type KnownErrorStatus = (typeof KNOWN_ERROR_STATUSES)[number];
/** A code of the vault: `KE-001`… (three digits at least). */
export const KNOWN_ERROR_CODE = /^KE-\d{3,}$/;

/** A new entry of the vault as the agents describe it: what it is and how to recognise it in the evidence. */
export const newKnownErrorShape = z
  .object({
    title: text(160).describe('A short name of the defect of DEMIURGO.'),
    dimension: z.enum(FORENSIC_DIMENSIONS).describe('Where in the system the defect lives: rules, prompt, context, graph, jev, process, engine, environment or other.'),
    description: text(800).describe('What the defect is and why it happens: a system cause, never a person.'),
    signature: text(600).describe('How to recognise it in the evidence of a task: the step, message, rule or pattern that shows it.'),
    pieces: z.array(text(80)).max(12).describe('Ids of the checklist `catalog` where the defect lives (an empty list when no piece fits).'),
  })
  .strict();

const forensicWentWrong = z
  .object({
    what: text(600),
    evidence: forensicEvidence,
    phase: forensicPhase,
    error_class: forensicClass,
    cost: forensicCost,
    at: z.string().trim().max(40).nullable().describe('ISO timestamp when it happened, as the evidence gives it, or null when it does not say.'),
    known_error: z.string().regex(KNOWN_ERROR_CODE).nullable().describe('The code of the `known_errors` entry this is an occurrence of, or null when it matches none.'),
    new_error: newKnownErrorShape.nullable().describe('Required when `known_error` is null: the new defect to record in the vault. Null when `known_error` is set.'),
    recurrence_why: z
      .string()
      .trim()
      .max(600)
      .nullable()
      .describe('Required when it matches a known error whose fix was claimed or validated and the task ran with the fix: why the fix did not prevent it. Null otherwise.'),
  })
  .strict();

/** task_forensics: the blameless post-mortem of one task, with a checklist of every piece of DEMIURGO. */
export const taskForensicsOutput = z
  .object({
    summary: text(2000).describe('What the task was and what happened to it, in a few sentences.'),
    outcome: z.enum(FORENSIC_OUTCOMES),
    timeline: z
      .array(z.object({ at: text(40).describe('ISO timestamp, or the nearest the evidence gives.'), stage: text(60), what: text(400) }).strict())
      .max(60),
    went_well: z.array(z.object({ what: text(600), evidence: forensicEvidence }).strict()).max(30),
    went_wrong: z.array(forensicWentWrong).max(40),
    root_causes: z
      .array(
        z
          .object({
            cause: text(600),
            dimension: z.enum(FORENSIC_DIMENSIONS),
            where: text(300).describe('The piece, rule, prompt, graph link or judgment where the cause lives.'),
            why: text(600),
            evidence: forensicEvidence,
          })
          .strict(),
      )
      .max(30),
    improvements: z
      .array(
        z
          .object({
            change: text(600),
            dimension: z.enum(FORENSIC_DIMENSIONS),
            target: text(300).describe('What to change: a piece id of the checklist, a file, a prompt, a rule.'),
            expected_effect: text(400),
            source: text(300).describe('The real practice it follows (book with author, official guide) or «convención nuestra».'),
            priority: z.enum(['high', 'medium', 'low']),
            playbook_class: forensicClass,
          })
          .strict(),
      )
      .max(30),
    lessons: z.array(text(400)).max(15),
    checklist: z
      .array(
        z
          .object({
            piece_id: text(80).describe('An id of the checklist, exactly as listed in `catalog`.'),
            involved: z.enum(['yes', 'no', 'unknown']),
            verdict: z.enum(FORENSIC_VERDICTS),
            note: text(400),
            evidence: z.string().trim().max(500).describe('The evidence cited, or an empty string when the piece was not involved.'),
          })
          .strict(),
      )
      .describe('EXACTLY one entry for every piece of `catalog`: no piece left out, no id outside it.'),
  })
  .strict();

/** playbook_write: the playbook of one error class, aggregated from the forensics tagged with it. */
export const playbookWriteOutput = z
  .object({
    class_key: text(80).describe('Exactly the class_key of the input.'),
    title: text(200),
    what_it_is: text(1200),
    symptoms: z.array(text(300)).min(1).max(12),
    detection: text(1200).describe('How DEMIURGO spots it: which rule, check or finding.'),
    prevention: z.array(z.object({ dimension: z.enum(FORENSIC_DIMENSIONS), change: text(500) }).strict()).max(15),
    response: text(1200).describe('What to do when it happens.'),
    examples: z.array(text(40)).max(20).describe('Task codes.'),
    sources: z.array(text(300)).max(12).describe('Real practice sources, or «convención nuestra».'),
  })
  .strict();

/** known_error_curate: the vault built from every went_wrong item of a project's earlier forensics, deduplicated. */
export const knownErrorCurateOutput = z
  .object({
    entries: z
      .array(
        z
          .object({
            known_error: z.string().regex(KNOWN_ERROR_CODE).nullable().describe('An existing code of `known_errors` when the items are more occurrences of it (then the other fields are ignored), else null.'),
            title: text(160),
            description: text(800),
            error_class: forensicClass,
            phase: forensicPhase,
            dimension: z.enum(FORENSIC_DIMENSIONS),
            signature: text(600),
            pieces: z.array(text(80)).max(12),
            covers: z
              .array(z.object({ forensic: text(40).describe('The forensic id exactly as given in `items`.'), went_wrong_index: z.number().int().nonnegative() }).strict())
              .min(1)
              .max(200),
          })
          .strict(),
      )
      .max(120),
  })
  .strict();

/** The most findings a coherence review returns, and the longest quote of each side. */
export const COHERENCE_MAX_FINDINGS = 10;
export const COHERENCE_QUOTE_MAX = 120;

const recordCode = z.string().regex(/^[A-Z]{3}-[A-Z]{3}-\d{3}$/);

/** coherence_review (FDR-KNO-056): what reading a whole epic at once finds, each finding with its two quotes. */
export const coherenceOutput = z
  .object({
    findings: z
      .array(
        z
          .object({
            kind: z
              .enum(['contradiction', 'duplicate', 'already_designed'])
              .describe(
                'contradiction: two statements that cannot both be true. duplicate: two records that specify the same behaviour, data, command or screen, so building both would make two versions of it. already_designed: a feature of this epic designs a capability that a feature of another epic (or of none) already designed or built, e.g. the same access rule or the same screen.',
              ),
            record: recordCode.describe('The record to change, one of `records`.'),
            quote: text(COHERENCE_QUOTE_MAX).describe("A passage of that record's text, copied verbatim."),
            other: recordCode.describe('The other record, one of `records`, different from `record`.'),
            other_quote: text(COHERENCE_QUOTE_MAX).describe("A passage of the other record's text, copied verbatim."),
            explanation: recordText(600).describe('Why both cannot stand as they are, in one or two sentences.'),
            suggestion: recordText(300).describe('One line: what to change in `record`.'),
          })
          .strict(),
      )
      .max(COHERENCE_MAX_FINDINGS)
      .describe('Most serious first; empty when the records are coherent.'),
  })
  .strict();

export const OUTPUT_SCHEMAS = {
  echo: echoOutput,
  exploration_chat: explorationChatOutput,
  design_proposal: designProposalOutput,
  coherence_review: coherenceOutput,
  epic_plan: epicPlanOutput,
  feature_design: featureDesignOutput,
  task_plan: taskPlanOutput,
  design_directions: designDirectionsOutput,
  design_system_plan: designSystemPlanOutput,
  screen_design: screenDesignOutput,
  pr_review: prReviewOutput,
  task_forensics: taskForensicsOutput,
  playbook_write: playbookWriteOutput,
  known_error_curate: knownErrorCurateOutput,
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
