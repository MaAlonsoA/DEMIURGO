// The product definition composed from the stage's answers: one section per question, in the
// template's order, each one keeping the question it comes from; nothing is composed while an
// answer is still open, and a change names what changed and why.

import { describe, expect, it } from 'vitest';
import {
  DEFINITION_SECTIONS,
  type DefinitionQuestion,
  NOT_ASKED,
  answerBullets,
  answerItems,
  changeReasons,
  composeDefinition,
  definitionChangeNote,
  definitionChanges,
  findQuote,
  matchQuote,
} from '../src/definition.ts';
import { PAYLOADS } from '../src/proposals.ts';
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

describe('the reasons of a change note', () => {
  it('reads each changed section and why, as the note writes them', () => {
    const note = definitionChangeNote([
      { section: 'Constraints', why: 'We decided it runs in the browser.' },
      { section: 'Users', why: null },
    ]);
    expect(changeReasons(note)).toEqual([
      { section: 'Constraints', why: 'We decided it runs in the browser.' },
      { section: 'Users', why: 'its answer changed.' },
    ]);
    expect(changeReasons(null)).toEqual([]);
  });
});

describe('a change proposed in a thread', () => {
  it('names a section of the definition and rests on at least one quote of the person', () => {
    const base = {
      record: { code: 'DEF-PRO-001', version: 1 },
      section: 'Constraints',
      content: 'A web app.',
      reason: 'Decided in the thread.',
    };
    const evidence = [{ message_id: '01a0e9f8-8c0f-7c9d-9646-2f0c7b018a53', quote: 'a web app' }];
    expect(PAYLOADS.definition_change.safeParse({ ...base, evidence }).success).toBe(true);
    expect(PAYLOADS.definition_change.safeParse({ ...base, evidence: [] }).success).toBe(false);
    expect(PAYLOADS.definition_change.safeParse({ ...base, section: 'Pricing', evidence }).success).toBe(false);
  });
});

describe('the person’s words a quote rests on', () => {
  const said =
    'Quiero que, cuando surja una idea nueva, vea antes de aceptarla a qué piezas del diseño y del código afecta.\n' +
    '- Todo se hace desde la web.';

  it('finds a quote copied with a word changed, and keeps the person’s words, not the copy', () => {
    expect(
      matchQuote('Cuando surja una idea nueva vea antes de aceptarla a que partes del diseño y del codigo afecta', said),
    ).toEqual({
      text: 'cuando surja una idea nueva, vea antes de aceptarla a qué piezas del diseño y del código afecta.',
      changes: 1,
    });
    expect(matchQuote('todo se hace desde la web', said)?.text).toBe('Todo se hace desde la web.');
  });

  it('does not take a paraphrase or a made-up quote for the person’s words', () => {
    expect(matchQuote('antes de aceptar una idea quiero saber qué rompe en el código', said)).toBeNull();
    expect(matchQuote('todo desde el móvil', said)).toBeNull();
  });

  it('has no length limit of its own: a long quote counts if it is in what they wrote', () => {
    const long = `${'Una frase larga que la persona escribió. '.repeat(20)}Fin.`;
    expect(matchQuote(long, `Antes. ${long} Después.`)?.text).toBe(long.trim());
    expect(PAYLOADS.definition_change.shape.evidence.element.shape.quote.safeParse(long).success).toBe(true);
  });

  it('says in which message it is, choosing the one it matches best', () => {
    const messages = [
      { id: 'a', body: 'Todo se hace desde el móvil.' },
      { id: 'b', body: 'Todo se hace desde la web.' },
    ];
    expect(findQuote('todo se hace desde la web', messages)).toEqual({ message_id: 'b', quote: 'Todo se hace desde la web.' });
    expect(findQuote('nada de esto', messages)).toBeNull();
  });
});

describe('list answers in the definition', () => {
  const list = 'Know how many books I read\nSee the count each month';
  const withAnswer = (key: string, conclusion: string) => everyAnswer().map((q) => (q.key === key ? { ...q, conclusion } : q));

  it('keeps the items of a list question as separate bullets', () => {
    const d = composeDefinition(withAnswer('outcomes', list));
    expect(d?.sections.find((s) => s.title === 'Outcomes')?.content).toBe('- Know how many books I read\n- See the count each month');
    expect(answerBullets('A · B')).toBe('- A\n- B');
    expect(answerItems('- A\n* B\n\n')).toEqual(['A', 'B']);
  });
  it('leaves a single item and a single-answer question as written', () => {
    expect(composeDefinition(withAnswer('outcomes', 'Only one.'))?.sections[1]?.content).toBe('Only one.');
    expect(composeDefinition(withAnswer('purpose', list))?.sections[0]?.content).toBe(list);
  });
  it('does not call a section changed when only its list formatting differs', () => {
    const plain = [{ title: 'Outcomes', content: list }];
    const bullets = [{ title: 'Outcomes', content: answerBullets(list) }];
    expect(definitionChanges(plain, bullets)).toEqual([]);
  });
});
