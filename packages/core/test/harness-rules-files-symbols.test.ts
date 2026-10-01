// files.symbols (B07, pm-7): the symbols «Code to extend» listed against the definitions the merge touched.

import { describe, expect, it } from 'vitest';
import { filesSymbols, listedSymbolsOf } from '../src/harness/rules/files.ts';
import { inputs, mergedSteps, step } from './support/harness-inputs.ts';

const opinion = { id: 'co-1', build_request_id: 'r1', attempt: 1, path: 'src/lib/plan.ts', deterministic_score: 1, jev_p: 0.9, rank: 1 } as never;

const section = [
  '# Code to extend',
  'src/lib/plan.ts',
  '  function buildPlan(days)',
  '  component PlanView(props)',
  '  type Plan',
  '  const MAX_DAYS',
  'src/components/tag.module.css [style]',
  '  .chip',
  'src/ds/index.ts (barrel)',
].join('\n');

function run(symbols: Record<string, string[]> | undefined, listed: string | null) {
  const steps = mergedSteps('r1', ['src/lib/plan.ts', 'src/components/tag.module.css']);
  const footprint = (steps.find((s) => s.stage === 'merge')!.detail as { footprint: Record<string, unknown> }).footprint;
  if (symbols) footprint.symbols = symbols;
  const builder = listed === null ? [] : [step('r1', 1, 'builder', 'ok', { code_to_extend: { section: listed } }, 5)];
  return filesSymbols(inputs({ id: 'r1', steps: [...builder, ...steps], codeOpinions: [opinion] }));
}

describe('files.symbols', () => {
  it('parses the symbols listed per file, class names included', () => {
    const listed = listedSymbolsOf(section);
    expect(listed.get('src/lib/plan.ts')).toEqual(['buildPlan', 'PlanView', 'Plan', 'MAX_DAYS']);
    expect(listed.get('src/components/tag.module.css')).toEqual(['chip']);
    expect(listed.get('src/ds/index.ts')).toEqual([]);
  });

  it('scores the listed symbols against the touched definitions', () => {
    const [row] = run({ 'src/lib/plan.ts': ['buildPlan', 'saveReviewed'], 'src/components/tag.module.css': ['chip'] }, section);
    expect(row).toMatchObject({ finding: 'files.symbols', class: 'info', subject: 'TSK-A-001' });
    expect(row!.evidence).toMatchObject({ files: 2, listed: 5, touched: 3, hits: 2, precision: 0.4, recall: 0.667 });
  });

  it('emits the ground truth alone when the listed symbols were not stored, and nothing without footprint symbols', () => {
    expect(run({ 'src/lib/plan.ts': ['buildPlan'] }, null).map((r) => r.finding)).toEqual(['files.symbols_touched']);
    expect(run(undefined, section)).toEqual([]);
  });
});
