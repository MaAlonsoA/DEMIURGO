import { describe, expect, it } from 'vitest';
import { explorationChatOutput, jsonSchemaOf } from '../src/agents.ts';
import { MAX_QUESTIONS_NEEDING_OPTIONS, normalizeOutput, questionsNeedingOptions, runSchemaOf } from '../src/run-schema.ts';

const id = (n: number) => `01a0da20-eae6-7fc6-ac24-3b9e6bdb03d${n}`;
const q = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  state: 'pending',
  has_options: false,
  shown: true,
  ...over,
});

type Asked = {
  type: string;
  required: string[];
  properties: Record<string, { properties: Record<string, unknown>; required: string[] }>;
};
const asked = (schema: Record<string, unknown>) => (schema.properties as { question_options: Asked }).question_options;

describe('the output schema of a run', () => {
  it('asks the options of the pending questions without them: those in view first, then the reserve, up to the limit', () => {
    const content = {
      questions: [
        q(1, { shown: false }),
        q(2),
        q(3, { has_options: true }),
        q(4, { state: 'confirmed' }),
        q(5, { shown: false }),
        q(6),
        q(7, { shown: false }),
      ],
    };
    expect(questionsNeedingOptions(content)).toEqual([id(2), id(6), id(1), id(5)].slice(0, MAX_QUESTIONS_NEEDING_OPTIONS));
  });

  it('turns question_options into one required entry per question, without question_id and with at least 2 options', () => {
    const schema = runSchemaOf('exploration_chat', { questions: [q(1), q(2, { shown: false })] });
    const a = asked(schema);
    expect(a.type).toBe('object');
    expect(a.required).toEqual([id(1), id(2)]);
    const entry = a.properties[id(1)];
    expect(entry?.required).toEqual(['options', 'multiple', 'question', 'reason']);
    expect(entry?.properties).not.toHaveProperty('question_id');
    expect(entry?.properties.options).toMatchObject({ type: 'array', minItems: 2, maxItems: 4 });
    // The rest of the schema is the action's.
    const { question_options: _, ...rest } = schema.properties as Record<string, unknown>;
    const { question_options: __, ...base } = jsonSchemaOf('exploration_chat').properties as Record<string, unknown>;
    expect(rest).toEqual(base);
  });

  it("keeps the action's schema when no question needs options, and for other actions", () => {
    expect(runSchemaOf('exploration_chat', { questions: [q(1, { has_options: true })] })).toEqual(
      jsonSchemaOf('exploration_chat'),
    );
    expect(runSchemaOf('echo', { questions: [q(1)] })).toEqual(jsonSchemaOf('echo'));
  });

  it("brings the options by id back to the action's list, which its schema accepts", () => {
    const options = [
      { answer: 'Only me', implies: 'Single user.', exclusive: false },
      { answer: 'A team', implies: 'Accounts from the start.', exclusive: false },
    ];
    const raw = {
      reply: 'Hi.',
      purpose: null,
      observations: [],
      questions: [],
      question_options: { [id(1)]: { options, multiple: false, question: '¿Quién?', reason: null } },
      inferences: [],
      proposals: [],
    };
    const out = normalizeOutput('exploration_chat', raw);
    expect(out).toMatchObject({
      question_options: [{ question_id: id(1), options, multiple: false, question: '¿Quién?', reason: null }],
    });
    expect(explorationChatOutput.safeParse(out).success).toBe(true);
    // A list stays as it is.
    const list = { ...raw, question_options: [] };
    expect(normalizeOutput('exploration_chat', list)).toBe(list);
  });
});
