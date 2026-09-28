import { describe, expect, it } from 'vitest';
import type { DefinitionVersion, ProductDefinition, Question } from '../../src/api/types.ts';
import { blockCalls, initialAnswer, LEFT_OPEN_REASON, missingAnswers, openItems } from '../../src/screens/onboarding/confirm.ts';
import {
  currentVersion,
  keyOfSection,
  previousVersion,
  reasonsOf,
  sectionChanges,
} from '../../src/screens/overview/definition.ts';

const version = (n: number, state: string, constraints: string): DefinitionVersion => ({
  id: `v${n}`,
  n,
  state,
  title: 'Product definition',
  sections: [
    { title: 'Purpose', content: 'When a trip is planned, members sign up.' },
    { title: 'Constraints', content: constraints },
  ],
  change_note: n > 1 ? 'Changed: Constraints.\n\nConstraints: Records are kept in English.' : null,
  author: 'human:ana',
  created_at: '2026-09-28T10:00:00Z',
  approved_at: '2026-09-28T10:00:00Z',
  approved_by: 'human:ana',
  proposal_id: null,
  sources: [],
});

const definition: ProductDefinition = {
  record: { id: 'r', code: 'PRD-PRO-001' },
  versions: [
    version(3, 'draft', 'Web.'),
    version(2, 'approved', 'A web app, in English.'),
    version(1, 'superseded', 'A web app.'),
  ],
  proposal: null,
};

describe('the product definition on the Product page', () => {
  it('shows the latest approved version, and compares it with the one before', () => {
    const current = currentVersion(definition);
    expect(current?.n).toBe(2);
    expect(current ? previousVersion(definition, current)?.n : null).toBe(1);
  });

  it('marks only the sections whose text changed, keeping what they said before', () => {
    const [v2, v1] = [definition.versions[1], definition.versions[2]];
    const changes = sectionChanges(v1?.sections ?? null, v2?.sections ?? []);
    expect(changes.map((c) => [c.title, c.changed, c.before])).toEqual([
      ['Purpose', false, 'When a trip is planned, members sign up.'],
      ['Constraints', true, 'A web app.'],
    ]);
    expect(sectionChanges(null, v2?.sections ?? []).every((c) => !c.changed)).toBe(true);
  });

  it('reads the reason of each changed section from the change note', () => {
    expect([...reasonsOf(definition.versions[1]?.change_note ?? null)]).toEqual([
      ['Constraints', 'Records are kept in English.'],
    ]);
    expect(reasonsOf(null).size).toBe(0);
  });

  it('names each section by its question', () => {
    expect(keyOfSection('First version')).toBe('features');
    expect(keyOfSection('Users')).toBe('stakeholders');
    expect(keyOfSection('Something else')).toBeNull();
  });
});

const question = (key: string, state: string, conclusion: string | null = null): Question => ({
  id: `q-${key}`,
  exploration_id: 't',
  question: `About ${key}?`,
  reason: null,
  impact: 'high',
  conclusion,
  reasoning: null,
  state,
  state_reason: null,
  raised_by: 'system:design@1',
  created_at: '2026-09-28T10:00:00Z',
  epistemic_status: 'pending',
  stage_id: 's',
  stage_key: key,
});

describe('Day 1: confirming the answers of the product definition at once', () => {
  const items = openItems(
    [
      question('constraints', 'pending'),
      question('purpose', 'inferred', 'When a trip is planned, members sign up.'),
      question('problem', 'confirmed', 'Done.'),
      question('stakeholders', 'inferred', 'Members and organizers.'),
    ],
    's',
  );

  it('lists the open questions in the order of the definition', () => {
    expect(items.map((q) => q.stage_key)).toEqual(['purpose', 'stakeholders', 'constraints']);
  });

  it('starts from what DEMIURGO read, and waits for an answer to what the idea does not say', () => {
    expect(items.map((q) => initialAnswer(q).text)).toEqual([
      'When a trip is planned, members sign up.',
      'Members and organizers.',
      '',
    ]);
    expect(missingAnswers(items, {})).toBe(1);
    expect(missingAnswers(items, { 'q-constraints': { text: '', open: true } })).toBe(0);
  });

  it('confirms what was read as it is, a correction with its words, an answer, and leaves open what the person chose', () => {
    expect(
      blockCalls(items, {
        'q-stakeholders': { text: 'Members, organizers and guests.', open: false },
        'q-constraints': { text: '', open: true },
      }),
    ).toEqual([
      { command: 'question.confirm', entityId: 'q-purpose', data: {} },
      { command: 'question.confirm', entityId: 'q-stakeholders', data: { conclusion: 'Members, organizers and guests.' } },
      { command: 'question.discard', entityId: 'q-constraints', data: { reason: LEFT_OPEN_REASON } },
    ]);
  });
});
