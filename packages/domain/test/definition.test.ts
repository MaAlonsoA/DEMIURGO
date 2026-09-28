// The product definition composed from the stage's answers: one section per question, in the
// template's order, each one keeping the question it comes from; nothing is composed while an
// answer is still open, and a change names what changed and why.

import { describe, expect, it } from 'vitest';
import {
  DEFINITION_SECTIONS,
  type DefinitionQuestion,
  NOT_ASKED,
  composeDefinition,
  definitionChangeNote,
  definitionChanges,
} from '../src/definition.ts';
import { RECORD_TEMPLATES, templateGaps } from '../src/records.ts';
import { stageDefinition } from '../src/stages.ts';

const confirmed = (key: string, conclusion = `The answer about ${key}.`): DefinitionQuestion => ({
  id: `00000000-0000-4000-8000-${String(DEFINITION_SECTIONS.findIndex((s) => s.key === key) + 1).padStart(12, '0')}`,
  key,
  state: 'confirmed',
  conclusion,
  state_reason: null,
});

const everyAnswer = () => DEFINITION_SECTIONS.map((s) => confirmed(s.key));

describe('the product definition', () => {
  it('has one section per question of the product definition stage, in the template order', () => {
    expect(DEFINITION_SECTIONS.map((s) => s.title)).toEqual(RECORD_TEMPLATES.product_definition.sections);
    const keys = stageDefinition('requirements')?.questions.map((q) => q.key) ?? [];
    expect(DEFINITION_SECTIONS.map((s) => s.key).toSorted()).toEqual(keys.toSorted());
  });

  it('is composed from the confirmed answers, each section keeping its question', () => {
    const d = composeDefinition(everyAnswer());
    expect(d?.sections.map((s) => s.content)).toEqual(DEFINITION_SECTIONS.map((s) => `The answer about ${s.key}.`));
    expect(d?.sources.map((s) => [s.section, s.state])).toEqual(DEFINITION_SECTIONS.map((s) => [s.title, 'confirmed']));
    expect(d?.sources.every((s) => s.question_id !== null)).toBe(true);
    expect(templateGaps('product_definition', d?.sections ?? [])).toEqual([]);
  });

  it('is not composed while an answer is still open, assumed or postponed', () => {
    for (const state of ['pending', 'inferred', 'postponed']) {
      const questions = everyAnswer().map((q) => (q.key === 'problem' ? { ...q, state } : q));
      expect(composeDefinition(questions)).toBeNull();
    }
  });

  it('says a discarded question was left open, with its reason', () => {
    const questions = everyAnswer().map((q) =>
      q.key === 'principles' ? { ...q, state: 'discarded', conclusion: null, state_reason: 'Too early to say.' } : q,
    );
    const d = composeDefinition(questions);
    expect(d?.sections.find((s) => s.title === 'Principles')?.content).toBe('Left open: Too early to say.');
    expect(d?.sources.find((s) => s.section === 'Principles')?.state).toBe('discarded');
  });

  it('says which sections were never asked, for a stage opened before they existed', () => {
    const d = composeDefinition(everyAnswer().filter((q) => !['purpose', 'outcomes', 'principles'].includes(q.key)));
    expect(d?.sections.slice(0, 3).map((s) => s.content)).toEqual([NOT_ASKED, NOT_ASKED, NOT_ASKED]);
    expect(d?.sources.slice(0, 3).map((s) => [s.question_id, s.state])).toEqual([
      [null, 'missing'],
      [null, 'missing'],
      [null, 'missing'],
    ]);
  });

  it('names the sections that changed, and why', () => {
    const before = composeDefinition(everyAnswer())?.sections ?? [];
    const after = before.map((s) => (s.title === 'Constraints' ? { ...s, content: 'Runs on a Mac mini.' } : s));
    expect(definitionChanges(before, after)).toEqual(['Constraints']);
    expect(definitionChanges(before, before)).toEqual([]);
    expect(definitionChangeNote([{ section: 'Constraints', why: 'Records are kept in English.' }])).toBe(
      'Changed: Constraints.\n\nConstraints: Records are kept in English.',
    );
    expect(definitionChangeNote([{ section: 'Users', why: null }])).toBe('Changed: Users.\n\nUsers: its answer changed.');
  });
});
