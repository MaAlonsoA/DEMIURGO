// The output schema of one run (V2.2): the action's schema, narrowed with what its context pack
// needs. In a conversation, `question_options` becomes one required entry per pending question that
// still has no options (the ones in view first, then the reserve in the order they will come up), so
// every provider, strict modes included, has to give them all and each question comes up with its
// likely answers. The output is brought back to the action's shape before Zod judges it against the
// action's full schema: a provider that ignores the narrowing only leaves those questions without
// options, the reply is kept.

import { z } from 'zod';
import { type AgentAction, conversationOption, jsonSchemaOf } from './agents.ts';

/** At most this many questions get their options asked in one run: a whole stage, so Day 1 offers them all. */
export const MAX_QUESTIONS_NEEDING_OPTIONS = 8;

type AnyObject = Record<string, unknown>;
const isObject = (v: unknown): v is AnyObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The pending questions of a conversation pack that have no options yet: in view first, then the reserve. */
export function questionsNeedingOptions(content: unknown): string[] {
  const questions = isObject(content) && Array.isArray(content.questions) ? content.questions.filter(isObject) : [];
  const needing = questions.filter((q) => q.state === 'pending' && q.has_options === false && typeof q.id === 'string');
  return [...needing.filter((q) => q.shown !== false), ...needing.filter((q) => q.shown === false)]
    .slice(0, MAX_QUESTIONS_NEEDING_OPTIONS)
    .map((q) => q.id as string);
}

/**
 * In a side conversation about one question (Go deeper), the answer it leads to is required, as an
 * option or null, so every provider gives it.
 */
function withConversationOption(schema: Record<string, unknown>, content: unknown): Record<string, unknown> {
  if (!isObject(content) || typeof content.question_in_progress !== 'string') return schema;
  const { $schema: _, ...option } = z.toJSONSchema(conversationOption.nullable(), { target: 'draft-7' }) as AnyObject;
  return {
    ...schema,
    properties: { ...(schema.properties as AnyObject), conversation_option: option },
    required: [...((schema.required as string[]) ?? []), 'conversation_option'],
  };
}

/** The JSON Schema the provider gets for this run. */
export function runSchemaOf(action: AgentAction, content: unknown): Record<string, unknown> {
  if (action !== 'exploration_chat') return jsonSchemaOf(action);
  const schema = withConversationOption(jsonSchemaOf(action), content);
  const ids = questionsNeedingOptions(content);
  if (ids.length === 0) return schema;
  const properties = schema.properties as AnyObject;
  const base = properties.question_options as { items: { properties: AnyObject; required: string[] } };
  const { question_id: _, ...entry } = base.items.properties;
  const options = { ...(entry.options as AnyObject), minItems: 2 };
  const item = {
    ...base.items,
    properties: { ...entry, options },
    required: base.items.required.filter((k) => k !== 'question_id'),
  };
  return {
    ...schema,
    properties: {
      ...properties,
      question_options: {
        type: 'object',
        properties: Object.fromEntries(ids.map((id) => [id, item])),
        required: ids,
        additionalProperties: false,
      },
    },
  };
}

/** The run's output in the action's shape: `question_options` by id goes back to a list. */
export function normalizeOutput(action: AgentAction, raw: unknown): unknown {
  if (action !== 'exploration_chat' || !isObject(raw) || !isObject(raw.question_options)) return raw;
  return {
    ...raw,
    question_options: Object.entries(raw.question_options).map(([id, v]) => (isObject(v) ? { question_id: id, ...v } : v)),
  };
}
