import { describe, expect, it } from 'vitest';
import { itemsForVerdicts } from '../src/knowledge-inputs.ts';
import { validateResponses, separatedEffects } from '../src/benchmark-policy.ts';
import { classificationMetrics, pairedInterval, planSampleSize } from '../src/benchmark-metrics.ts';
import { pilotScenarios, validateDataset } from '../../core/src/benchmark/dataset.ts';

const answer = (id: string, choice: string, confidence = 0.95) => ({
  id,
  choice,
  confidence,
  distribution: {},
  justification: 'Evidence.',
});

describe('Knowledge benchmark contracts', () => {
  it('keeps 40 proposed scenarios in disjoint families and requires full graph adjudication', () => {
    const scenarios = pilotScenarios();
    expect(scenarios).toHaveLength(40);
    expect(scenarios.filter((s) => s.partition === 'dev')).toHaveLength(24);
    expect(validateDataset(scenarios, [])).toEqual([]);
    expect(validateDataset(scenarios, [], true).length).toBeGreaterThan(0);
    const changed = structuredClone(scenarios);
    changed[0]!.partition = 'validation';
    expect(validateDataset(changed, []).join(' ')).toContain('crosses partitions');
  });
  it('does not hide missing, duplicate, unknown or invalid answers behind a valid label', () => {
    const item = { id: 'n', state: '', question: '?', options: ['keep', 'other'] };
    expect(validateResponses([item], []).errors).toHaveLength(1);
    expect(validateResponses([item], [answer('n', 'keep'), answer('n', 'keep')]).errors.length).toBeGreaterThan(0);
    expect(validateResponses([item], [answer('alien', 'keep')]).errors.length).toBeGreaterThan(0);
    expect(validateResponses([item], [answer('n', 'no')]).valid).toHaveLength(0);
    expect(validateResponses([item], [answer('n', 'keep', Number.NaN)]).valid).toHaveLength(0);
  });
  it('rejects contradictory dimensions and abstains even for uncertain negative answers', () => {
    expect(
      separatedEffects('change', { relation: 'unrelated', compatibility: 'direct_conflict', action: 'none' }, 1).invalid,
    ).toBe(true);
    expect(separatedEffects('idea', { relation: 'unrelated', compatibility: 'compatible' }, 0.1).effects).toEqual(['pending']);
    expect(separatedEffects('idea', { relation: 'related', compatibility: 'direct_conflict' }, 1).effects).toEqual(['conflict']);
    expect(
      separatedEffects('change', { relation: 'related', compatibility: 'direct_conflict', action: 'replace' }, 1).effects,
    ).toContain('review');
  });
  it('uses shared definitions without annotation fields', () => {
    const scenario = pilotScenarios()[0]!;
    const item = itemsForVerdicts(scenario.change, [{ ...scenario.graph.nodes[0]!, reason: 'all' }], true)[0]!;
    expect(item.rubricVersion).toBeDefined();
    expect(item.optionDescriptions?.invalidate).toContain('replace');
    expect(JSON.stringify(item)).not.toContain('adjudication');
  });
  it('checks known metrics and resamples families with all repetitions together', () => {
    const m = classificationMetrics(
      ['yes', 'no'],
      [
        { expected: 'yes', actual: 'yes', confidence: 0.8 },
        { expected: 'no', actual: 'yes', confidence: 0.8 },
      ],
    );
    expect(m.accuracy).toBe(0.5);
    expect(m.ece).toBeCloseTo(0.3);
    const interval = pairedInterval(
      [
        { family: 'a', baseline: 1, candidate: 0 },
        { family: 'b', baseline: 1, candidate: 0 },
      ],
      42,
      1000,
    );
    expect(interval).toMatchObject({ delta: -1, lower: -1, upper: -1, families: 2 });
    const clustered = [
      { family: 'a', baseline: 1, candidate: 0 },
      { family: 'b', baseline: 0, candidate: 1 },
    ];
    expect(pairedInterval([...clustered, ...clustered], 42, 1000)).toEqual(pairedInterval(clustered, 42, 1000));
    expect(pairedInterval([clustered[0]!], 42, 1000).upper).toBeNull();
    expect(m.macroF1).toBeCloseTo(1 / 3);
    expect(m.matrix).toMatchObject({ yes: { yes: 1 }, no: { yes: 1 } });
    expect(planSampleSize(0, 0.01, 1)).toMatchObject({ status: 'insufficient_evidence' });
    expect(planSampleSize(0.2, 0.02, 2).scenarios).toBeGreaterThan(1000);
  });
});
