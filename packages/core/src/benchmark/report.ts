import { DIMENSIONS, VERDICTS, IDEA_FINDINGS } from '@demiurgo/domain';
import { average, classificationMetrics, pairedInterval, quantile } from '../../../domain/src/benchmark-metrics.ts';
import type { Annotation, Scenario } from './dataset.ts';
import { finalResponses, replayRun, type RunTrace } from './runner.ts';
import type { Effect } from '../../../domain/src/benchmark-policy.ts';

const relevant = (effects: readonly Effect[]): Effect[] => effects.filter((e) => !['preserve', 'pending'].includes(e));
const automatic = (effects: readonly Effect[]): Effect[] => effects.filter((e) => !['review', 'pending'].includes(e));
type SummaryRow = {
  structural: boolean;
  relevant: boolean;
  selected: boolean;
  abstained: boolean;
  ambiguous: boolean;
  relevantEffects: number;
  omittedEffects: number;
  automaticEffects: number;
  wrongAutomaticEffects: number;
  omitted: number;
  wrongAutomatic: number;
  unnecessaryReview: number;
  review: number;
  falseAlert: number;
};
function summarize(rows: SummaryRow[]) {
  const evaluated = rows.filter((p) => !p.structural);
  const relevantRows = evaluated.filter((p) => p.relevant);
  const sum = (field: 'relevantEffects' | 'omittedEffects' | 'automaticEffects' | 'wrongAutomaticEffects') =>
    evaluated.reduce((n, p) => n + p[field], 0);
  return {
    pairs: evaluated.length,
    relevantPairs: relevantRows.length,
    relevantEffects: sum('relevantEffects'),
    omittedEffects: sum('omittedEffects'),
    omissionRate: relevantRows.length ? average(relevantRows.map((p) => p.omitted)) : null,
    effectOmissionRate: sum('relevantEffects') ? sum('omittedEffects') / sum('relevantEffects') : null,
    relevantRecovery: relevantRows.length ? average(relevantRows.map((p) => Number(p.selected))) : null,
    wrongAutomaticRate: evaluated.length ? average(evaluated.map((p) => p.wrongAutomatic)) : null,
    automaticEffects: sum('automaticEffects'),
    errorAmongAutomaticEffects: sum('automaticEffects') ? sum('wrongAutomaticEffects') / sum('automaticEffects') : null,
    automaticCoverage: evaluated.length ? average(evaluated.map((p) => Number(p.automaticEffects > 0))) : null,
    unnecessaryReviewRate: evaluated.length ? average(evaluated.map((p) => p.unnecessaryReview)) : null,
    reviews: evaluated.reduce((n, p) => n + p.review, 0),
    falseAlerts: evaluated.reduce((n, p) => n + p.falseAlert, 0),
    pending: evaluated.filter((p) => p.abstained).length,
    ambiguous: evaluated.filter((p) => p.ambiguous).length,
    ambiguousAbstentions: evaluated.filter((p) => p.ambiguous && p.abstained).length,
  };
}
export function reportRun(scenarios: Scenario[], annotations: Annotation[], saved: RunTrace) {
  const run = replayRun(scenarios, annotations, saved);
  const pairs = run.events.flatMap((event) =>
    event.outcomes.map((outcome) => {
      const judgment = annotations
        .find((a) => a.scenario === event.scenario)!
        .pairs.find((p) => p.task === outcome.task && p.ref === outcome.ref)!;
      const structural = outcome.omissionReason === 'version_precedence';
      const expected = structural ? (['invalidate'] as Effect[]) : relevant(judgment.effects);
      const auto = outcome.selected ? automatic(outcome.effects) : [];
      const omissions = expected.filter((e) => !outcome.effects.includes(e));
      const wrong = auto.filter((e) => !judgment.effects.includes(e));
      const review = outcome.effects.some((e) => e === 'review' || e === 'pending');
      return {
        scenario: event.scenario,
        family: event.family,
        repetition: event.repetition,
        task: outcome.task,
        ref: outcome.ref,
        expectedEffects: judgment.effects,
        effects: outcome.effects,
        labels: outcome.labels,
        expectedLabels: judgment.labels,
        confidence: outcome.confidence,
        confidences: outcome.confidences,
        ambiguous: judgment.ambiguous,
        selected: outcome.selected,
        structural,
        invalid: outcome.invalid,
        abstained: outcome.abstained,
        relevant: expected.length > 0,
        relevantEffects: expected.length,
        omittedEffects: omissions.length,
        omitted: Number(omissions.length > 0),
        omissionReason: outcome.omissionReason,
        automaticEffects: auto.length,
        wrongAutomaticEffects: wrong.length,
        wrongAutomatic: Number(wrong.length > 0),
        review: Number(review),
        unnecessaryReview: Number(review && !judgment.effects.some((e) => e === 'review' || e === 'pending')),
        falseAlert: Number(
          outcome.effects.some((e) => ['conflict', 'assumption', 'duplicate'].includes(e) && !judgment.effects.includes(e)),
        ),
      };
    }),
  );
  const categoryRows = run.events.flatMap((event) => {
    if (!event.calls.some((call) => call.stage === 'category')) return [];
    const responses = finalResponses(event.calls, 'category');
    const scenario = scenarios.find((entry) => entry.id === event.scenario)!;
    const annotation = annotations.find((entry) => entry.scenario === event.scenario)!;
    return scenario.taxonomy.axes.map((axis) => ({
      scenario: event.scenario,
      repetition: event.repetition,
      axis: axis.code,
      expected: annotation.categories[axis.code]!,
      actual: responses.get(axis.code)?.choice ?? null,
      confidence: responses.get(axis.code)?.confidence ?? null,
      applied: event.categories[axis.code] !== undefined,
    }));
  });
  const classification = Object.fromEntries(
    (['change', 'idea'] as const).map((task) => [
      task,
      Object.fromEntries(
        (run.config.contract === 'B'
          ? task === 'change'
            ? ['relation', 'compatibility', 'action']
            : ['relation', 'compatibility']
          : ['A']
        ).map((dimension) => {
          const classes =
            dimension === 'A'
              ? task === 'change'
                ? VERDICTS
                : IDEA_FINDINGS
              : Object.keys(DIMENSIONS[dimension as keyof typeof DIMENSIONS]);
          const rows = pairs.filter((p) => p.task === task && p.selected && !p.ambiguous);
          return [
            dimension,
            classificationMetrics(
              classes,
              rows.map((p) => ({
                expected: p.expectedLabels[dimension]![0]!,
                actual: p.invalid ? null : (p.labels[dimension] ?? null),
                confidence: p.confidences[dimension] ?? null,
              })),
            ),
          ];
        }),
      ),
    ]),
  );
  const calls = run.events.flatMap((e) => e.calls);
  const telemetry = calls.flatMap((c) => c.telemetry) as {
    type?: string;
    provider?: string;
    result?: {
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        inputTokens?: number;
        outputTokens?: number;
        declaredCostUsd?: number;
      };
      details?: { attempts?: unknown[] };
    };
  }[];
  const observedCosts = telemetry
    .filter((t) => t.result?.usage?.declaredCostUsd !== undefined)
    .map((t) => t.result!.usage!.declaredCostUsd!);
  const results = telemetry.filter((t) => t.type === 'qwen_result' || t.type === 'jev_result');
  return {
    status: run.status,
    recommendation: 'insufficient_evidence',
    reason:
      run.config.partition === 'confirmatory'
        ? 'A frozen, independently adjudicated paired comparison is required.'
        : 'Pilot data cannot establish confirmatory superiority.',
    configurationId: run.configurationId,
    datasetHash: run.datasetHash,
    adjudicationHash: run.adjudicationHash,
    engine: run.config.engine,
    policy: run.config.policy,
    partition: run.config.partition,
    contract: run.config.contract,
    condition: run.config.condition,
    retrieval: run.config.retrieval,
    repetitions: run.config.repetitions,
    scenarios: new Set(run.events.map((e) => e.scenario)).size,
    families: new Set(run.events.map((e) => e.family)).size,
    classification,
    categoriesSource: run.config.categories,
    categoryMetrics: classificationMetrics(
      [...new Set(categoryRows.flatMap((row) => [row.expected, ...(row.actual ? [row.actual] : [])]))],
      categoryRows,
    ),
    categoryRows,
    pendingCategoryDecisions: categoryRows.filter((row) => !row.applied).length,
    contextLosses: pairs.filter((pair) => pair.omissionReason === 'text_truncated'),
    product: summarize(pairs),
    byTask: Object.fromEntries(['change', 'idea'].map((task) => [task, summarize(pairs.filter((p) => p.task === task))])),
    byTag: Object.fromEntries(
      [...new Set(scenarios.flatMap((s) => s.tags))].map((tag) => [
        tag,
        summarize(pairs.filter((p) => scenarios.find((s) => s.id === p.scenario)!.tags.includes(tag))),
      ]),
    ),
    retrievalOmissions: pairs
      .filter((p) => p.relevant && !p.selected && !p.structural)
      .map((p) => ({ scenario: p.scenario, repetition: p.repetition, task: p.task, ref: p.ref, reason: p.omissionReason })),
    operations: {
      logicalCalls: calls.length,
      llmRequests: telemetry.filter((t) => t.type === 'http_request').length || null,
      retries: telemetry.reduce((n, t) => n + Math.max(0, (t.result?.details?.attempts?.length ?? 1) - 1), 0),
      serviceOrFormatFailures: calls.filter((c) => c.errors.length).length,
      callLatencyMs: {
        p50: quantile(
          calls.map((c) => c.durationMs),
          0.5,
        ),
        p95: quantile(
          calls.map((c) => c.durationMs),
          0.95,
        ),
      },
      eventLatencyMs: {
        p50: quantile(
          run.events.map((e) => e.durationMs),
          0.5,
        ),
        p95: quantile(
          run.events.map((e) => e.durationMs),
          0.95,
        ),
      },
      inputTokens: results.reduce((n, t) => n + (t.result?.usage?.input_tokens ?? t.result?.usage?.inputTokens ?? 0), 0),
      outputTokens: results.reduce((n, t) => n + (t.result?.usage?.output_tokens ?? t.result?.usage?.outputTokens ?? 0), 0),
      observedCostUsd:
        results.length && observedCosts.length === results.length ? observedCosts.reduce((a, b) => a + b, 0) : null,
      costNote: 'Unknown cost is null, never zero. Local telemetry does not establish monetary cost.',
    },
    pairs,
  };
}
export type Report = ReturnType<typeof reportRun>;
const key = (p: Report['pairs'][number]) => `${p.scenario}:${p.repetition}:${p.task}:${p.ref}`;
export function compareReports(baseline: Report, candidate: Report, seed = 42) {
  if (
    baseline.datasetHash !== candidate.datasetHash ||
    baseline.adjudicationHash !== candidate.adjudicationHash ||
    baseline.partition !== candidate.partition ||
    baseline.condition !== candidate.condition ||
    baseline.retrieval !== candidate.retrieval ||
    baseline.categoriesSource !== candidate.categoriesSource ||
    baseline.repetitions !== candidate.repetitions
  )
    throw new Error('Reports are not a paired comparison under the same conditions.');
  const base = new Map(baseline.pairs.map((p) => [key(p), p]));
  if (base.size !== candidate.pairs.length || candidate.pairs.some((p) => !base.has(key(p))))
    throw new Error('Reports contain different cases.');
  const primary = Object.fromEntries(
    (['omitted', 'wrongAutomatic', 'unnecessaryReview'] as const).map((field) => [
      field,
      pairedInterval(
        candidate.pairs
          .filter((p) => !p.structural && (field !== 'omitted' || p.relevant))
          .map((p) => ({ family: p.family, baseline: base.get(key(p))![field], candidate: p[field] })),
        seed,
      ),
    ]),
  );
  const classifications = candidate.pairs.filter(
    (p) =>
      !p.ambiguous &&
      p.selected &&
      p.expectedLabels.A?.length === 1 &&
      base.get(key(p))?.selected &&
      p.labels.A &&
      base.get(key(p))?.labels.A,
  );
  let baselineOnly = 0;
  let candidateOnly = 0;
  for (const p of classifications) {
    const b = base.get(key(p))!;
    const bHit = b.labels.A === b.expectedLabels.A![0];
    const cHit = p.labels.A === p.expectedLabels.A![0];
    if (bHit && !cHit) baselineOnly++;
    if (!bHit && cHit) candidateOnly++;
  }
  return {
    recommendation: 'insufficient_evidence',
    primary,
    margin: 0.02,
    intervalMeaning: 'Candidate minus baseline; equal-family weighting; all variants and repetitions stay together.',
    eligibleForConfirmatoryDecision: false,
    reason:
      'No automatic freeze or pilot recommendation. Confirmatory protocol, sample size, complete traces and human adjudication must be checked first.',
    complete: baseline.status === 'complete' && candidate.status === 'complete',
    diagnosticMcNemar: {
      baselineOnly,
      candidateOnly,
      statistic:
        baselineOnly + candidateOnly
          ? Math.max(0, Math.abs(baselineOnly - candidateOnly) - 1) ** 2 / (baselineOnly + candidateOnly)
          : null,
      warning: 'Diagnostic only: pairs and repetitions are dependent; never used for the primary decision.',
    },
  };
}
