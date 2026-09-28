import { describe, expect, it } from 'vitest';
import { fingerprint, type ChoiceResponse, type Classifier, type ItemChoice, selectCandidates, buildPlan } from '../src/index.ts';
import { pilotScenarios, proposedAnnotations, validateDataset, type Annotation } from '../../core/src/benchmark/dataset.ts';
import { defaultConfig, executeBenchmark, replayRun, prepareInputs, type Config } from '../../core/src/benchmark/runner.ts';
import { compareReports, reportRun } from '../../core/src/benchmark/report.ts';

// These synthetic human records are test fixtures only. They are never written to the pilot set.
function fixture(index = 0) {
  const scenario = pilotScenarios()[index]!;
  const annotation: Annotation = {
    ...proposedAnnotations([scenario])[0]!,
    source: 'human',
    reviewer: 'human:test-fixture',
    status: 'corrected',
    fullGraphReviewed: true,
    blindJudgment: 'fixture-only',
    reviewedAt: '2026-09-28T00:00:00Z',
  };
  return { scenario, annotation };
}
const response = (i: ItemChoice, choice: string, confidence = 0.95): ChoiceResponse => ({
  id: i.id,
  choice,
  confidence,
  distribution: { [choice]: confidence },
  justification: 'Test fixture.',
});
function classifier(fn: (items: readonly ItemChoice[]) => ChoiceResponse[] | Promise<ChoiceResponse[]>): Classifier {
  return { id: 'fixture', choice: async (items) => fn(items), score: async () => [], noul: async () => [] };
}
const provenance = { commit: 'fixture', dirty: false, sourceHash: 'fixture' };
function config(extra: Partial<Config> = {}): Config {
  return { ...defaultConfig, repetitions: 1, categories: 'adjudicated', ...extra };
}

describe('Isolated knowledge benchmark', () => {
  it('blocks live evaluation before human adjudication, without making a classifier call', async () => {
    const scenarios = pilotScenarios();
    let called = false;
    await expect(
      executeBenchmark(
        scenarios,
        proposedAnnotations(scenarios),
        config(),
        {
          primary: classifier(() => {
            called = true;
            return [];
          }),
        },
        provenance,
      ),
    ).rejects.toThrow('human');
    expect(called).toBe(false);
    const preview = JSON.stringify(prepareInputs(scenarios, config()));
    expect(preview).not.toContain('expected');
    expect(preview).not.toContain('explanation');
    expect(preview).not.toContain('reviewer');
  });
  it('records missing, duplicate and service errors as failures and replays them identically', async () => {
    const { scenario, annotation } = fixture();
    for (const mode of ['missing', 'duplicate', 'service']) {
      const run = await executeBenchmark(
        [scenario],
        [annotation],
        config(),
        {
          primary: classifier((items) => {
            if (mode === 'service') throw new Error('Offline fixture');
            return mode === 'missing' ? [] : [response(items[0]!, 'keep'), response(items[0]!, 'keep')];
          }),
        },
        provenance,
      );
      expect(run.status).toBe('failed');
      expect(run.errors.length).toBeGreaterThan(0);
      expect(run.events[0]!.outcomes.some((o) => o.invalid)).toBe(true);
      expect(replayRun([scenario], [annotation], run)).toEqual(run);
    }
  });
  it('measures omissions outside retrieval, including an excluded criterion', async () => {
    const { scenario, annotation } = fixture(20);
    const run = await executeBenchmark(
      [scenario],
      [annotation],
      config(),
      { primary: classifier((items) => items.map((i) => response(i, i.options.includes('keep') ? 'keep' : 'none'))) },
      provenance,
    );
    const report = reportRun([scenario], [annotation], run);
    expect(report.retrievalOmissions).toEqual(
      expect.arrayContaining([expect.objectContaining({ ref: scenario.graph.nodes[0]!.ref, reason: 'excluded_criterion' })]),
    );
    expect(report.product.omissionRate).toBe(1);
    expect(report.recommendation).toBe('insufficient_evidence');
  });
  it('routes uncertain keep and none to a person and does not credit generic uncertainty as conflict detection', async () => {
    const { scenario, annotation } = fixture(4);
    const run = await executeBenchmark(
      [scenario],
      [annotation],
      config({ retrieval: 'isolated' }),
      { primary: classifier((items) => items.map((i) => response(i, i.options.includes('keep') ? 'keep' : 'none', 0.1))) },
      provenance,
    );
    const report = reportRun([scenario], [annotation], run);
    expect(report.product.pending).toBe(20);
    expect(report.product.automaticCoverage).toBe(0);
    expect(report.product.errorAmongAutomaticEffects).toBeNull();
    expect(report.product.omissionRate).toBe(1);
    expect(report.product.unnecessaryReviewRate).toBeGreaterThan(0);
  });
  it('blinds the reviewer to Jev answers and revalidates reviewer confidence and errors', async () => {
    const { scenario, annotation } = fixture();
    const primaryInputs: ItemChoice[][] = [];
    const reviewerInputs: ItemChoice[][] = [];
    const run = await executeBenchmark(
      [scenario],
      [annotation],
      config({ engine: 'cascade', retrieval: 'isolated' }),
      {
        primary: classifier((items) => {
          primaryInputs.push([...items]);
          return items.map((i) => response(i, i.options[0]!, 0.65));
        }),
        reviewer: classifier((items) => {
          reviewerInputs.push([...items]);
          return items.map((i) => response(i, i.options[0]!, 0.6));
        }),
      },
      provenance,
    );
    expect(reviewerInputs).toEqual(primaryInputs);
    expect(run.events[0]!.outcomes.every((o) => o.abstained)).toBe(true);
    const failed = await executeBenchmark(
      [scenario],
      [annotation],
      config({ engine: 'cascade', retrieval: 'isolated' }),
      {
        primary: classifier((items) => items.map((i) => response(i, i.options[0]!, 0.65))),
        reviewer: classifier(() => {
          throw new Error('Reviewer offline');
        }),
      },
      provenance,
    );
    expect(failed.status).toBe('failed');
    expect(failed.events[0]!.outcomes.every((o) => o.abstained)).toBe(true);
  });
  it('retains B dimensions, rejects contradictions, and never translates B into A', async () => {
    const { scenario, annotation } = fixture();
    const run = await executeBenchmark(
      [scenario],
      [annotation],
      config({ contract: 'B', retrieval: 'isolated' }),
      {
        primary: classifier((items) =>
          items.map((i) =>
            response(i, i.id.endsWith('relation') ? 'unrelated' : i.id.endsWith('compatibility') ? 'direct_conflict' : 'none'),
          ),
        ),
      },
      provenance,
    );
    expect(run.status).toBe('failed');
    expect(run.events[0]!.outcomes.every((o) => o.invalid)).toBe(true);
    expect(run.events[0]!.outcomes[0]!.labels).not.toHaveProperty('A');
  });
  it('respects authority and resolves version precedence through domain code', async () => {
    const { scenario, annotation } = fixture(34);
    scenario.graph.nodes[1]!.type = 'criterion';
    scenario.graph.edges.push({
      type: 'contains',
      from: scenario.change.supersedes[0]!,
      to: scenario.graph.nodes[1]!.ref,
      validFrom: 1,
      validTo: null,
    });
    annotation.scenarioHash = fingerprint(scenario);
    const run = await executeBenchmark(
      [scenario],
      [annotation],
      config({ partition: 'validation', retrieval: 'exhaustive' }),
      {
        primary: classifier((items) =>
          items.map((i) => response(i, i.options.includes('invalidate') ? 'invalidate' : 'conflicts')),
        ),
      },
      provenance,
    );
    const outcomes = run.events[0]!.outcomes;
    expect(
      outcomes
        .filter((o) => o.task === 'change' && o.effects.includes('invalidate'))
        .every((o) => buildPlan(scenario.graph, scenario.change, {}, [], 2).invalidate.includes(o.ref)),
    ).toBe(true);
    expect(outcomes.filter((o) => o.task === 'idea').every((o) => !o.effects.includes('invalidate'))).toBe(true);
    expect(buildPlan(scenario.graph, scenario.change, {}, [], 2).invalidate).toContain(scenario.change.supersedes[0]);
  });
  it('does not mix independent projects into a batch and includes all five repetitions', async () => {
    const a = fixture();
    const b = fixture(2);
    const run = await executeBenchmark(
      [a.scenario, b.scenario],
      [a.annotation, b.annotation],
      config({ condition: 'operational', repetitions: 5 }),
      {
        primary: classifier((items) => {
          expect(new Set(items.map((i) => i.id.split('-')[1])).size).toBe(1);
          return items.map((i) => response(i, i.options.includes('keep') ? 'keep' : 'none'));
        }),
      },
      provenance,
    );
    expect(run.events).toHaveLength(10);
    expect(new Set(run.events.filter((e) => e.repetition === 0).map((e) => e.order)).size).toBe(2);
    const report = reportRun([a.scenario, b.scenario], [a.annotation, b.annotation], run);
    expect(compareReports(report, report).primary.omitted!.families).toBe(2);
  });
  it('rejects changed datasets and truncated or tampered traces', async () => {
    const { scenario, annotation } = fixture();
    const run = await executeBenchmark(
      [scenario],
      [annotation],
      config(),
      { primary: classifier((items) => items.map((i) => response(i, i.options[0]!))) },
      provenance,
    );
    expect(() => replayRun([scenario], [annotation], { ...run, events: [] })).toThrow('Incomplete');
    const corrupt = structuredClone(run);
    corrupt.events[0]!.calls[0]!.items[0]!.question = 'Injected replacement';
    expect(() => replayRun([scenario], [annotation], corrupt)).toThrow('inputs');
    expect(() => replayRun([scenario], [annotation], { ...run, datasetHash: 'changed' })).toThrow('fingerprints');
  });
  it('diagnoses truncation and the 12-candidate limit without changing production retrieval', () => {
    const { scenario } = fixture(22);
    expect(
      selectCandidates(scenario.graph, scenario.change, { area: 'recovery' }).find((c) => c.ref.endsWith('001@1'))?.text,
    ).toHaveLength(1500);
    const large = structuredClone(scenario.graph);
    const n = large.nodes[0]!;
    for (let i = 0; i < 15; i++) large.nodes.push({ ...n, ref: `EXTRA-${i}@1` });
    expect(selectCandidates(large, scenario.change, { area: 'recovery' })).toHaveLength(12);
  });
  it('rejects stale, partial and fake-human annotations and validates evidence quotes', () => {
    const { scenario, annotation } = fixture();
    expect(validateDataset([scenario], [{ ...annotation, fullGraphReviewed: false }], true).length).toBeGreaterThan(0);
    expect(validateDataset([scenario], [{ ...annotation, pairs: annotation.pairs.slice(1) }], true).join(' ')).toContain(
      'full graph',
    );
    expect(validateDataset([scenario], [{ ...annotation, scenarioHash: fingerprint('changed') }], true).join(' ')).toContain(
      'stale',
    );
    const bad = structuredClone(annotation);
    bad.pairs[0]!.evidence = ['A quote that is absent'];
    expect(validateDataset([scenario], [bad], true).join(' ')).toContain('verbatim');
  });
});
