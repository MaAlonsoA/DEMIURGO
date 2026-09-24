// Scripted classifier for tests: delegates to the simulated one and lets a test force responses
// per task (verdicts, categories or ideas) and count the calls.

import type { Classifier, ItemChoice, ChoiceResponse } from '@demiurgo/domain';
import { createSimulatedClassifier } from '../../src/classifier/simulated.ts';

type Task = 'verdict' | 'category' | 'idea';
type Script = (items: readonly ItemChoice[], baseline: ChoiceResponse[]) => ChoiceResponse[];

export type ScriptedClassifier = Classifier & {
  scripts: Partial<Record<Task, Script>>;
  calls: Record<Task | 'other', number>;
  reset(): void;
};

const taskOf = (i: ItemChoice): Task | 'other' => {
  const t = (i.state as { task?: string }).task;
  return t === 'verdict' || t === 'category' || t === 'idea' ? t : 'other';
};

export function createScriptedClassifier(): ScriptedClassifier {
  const base = createSimulatedClassifier();
  const c: ScriptedClassifier = {
    id: 'scripted@1',
    scripts: {},
    calls: { verdict: 0, category: 0, idea: 0, other: 0 },
    reset() {
      c.scripts = {};
      c.calls = { verdict: 0, category: 0, idea: 0, other: 0 };
    },
    async choice(items) {
      const task = items[0] ? taskOf(items[0]) : 'other';
      c.calls[task] += 1;
      const baseline = await base.choice(items);
      const script = task === 'other' ? undefined : c.scripts[task];
      return script ? script(items, baseline) : baseline;
    },
    score: (items) => base.score(items),
    noul: (items) => base.noul(items),
  };
  return c;
}

export const response = (id: string, choice: string, confidence: number, justification = 'test script'): ChoiceResponse => ({
  id,
  choice,
  distribution: { [choice]: confidence },
  confidence,
  justification,
});
