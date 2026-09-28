// All rates are fractions, not percentages. Repetitions never become independent families.
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export function shuffled<T>(values: readonly T[], seed: number): T[] {
  const out = [...values];
  const next = random(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
export const average = (v: readonly number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
export function quantile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}
export type MetricCase = { expected: string; actual: string | null; confidence: number | null };
export function classificationMetrics(classes: readonly string[], rows: readonly MetricCase[]) {
  const matrix = Object.fromEntries(classes.map((c) => [c, Object.fromEntries([...classes, 'invalid'].map((v) => [v, 0]))]));
  for (const r of rows)
    if (matrix[r.expected]) matrix[r.expected]![r.actual ?? 'invalid'] = (matrix[r.expected]![r.actual ?? 'invalid'] ?? 0) + 1;
  const byClass = Object.fromEntries(
    classes.map((c) => {
      const support = rows.filter((r) => r.expected === c).length;
      const predicted = rows.filter((r) => r.actual === c).length;
      const hits = rows.filter((r) => r.expected === c && r.actual === c).length;
      const precision = predicted ? hits / predicted : 0;
      const recall = support ? hits / support : 0;
      return [
        c,
        { support, predicted, precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 },
      ];
    }),
  );
  const scored = rows.filter((r) => r.actual !== null && r.confidence !== null);
  const reliability = Array.from({ length: 10 }, (_, i) => {
    const bin = scored.filter((r) => Math.min(9, Math.floor(r.confidence! * 10)) === i);
    return {
      lower: i / 10,
      upper: (i + 1) / 10,
      count: bin.length,
      confidence: bin.length ? average(bin.map((r) => r.confidence!)) : null,
      accuracy: bin.length ? average(bin.map((r) => Number(r.expected === r.actual))) : null,
    };
  });
  return {
    total: rows.length,
    accuracy: rows.length ? average(rows.map((r) => Number(r.expected === r.actual))) : null,
    macroF1: average(
      Object.values(byClass)
        .filter((c) => c.support || c.predicted)
        .map((c) => c.f1),
    ),
    matrix,
    byClass,
    formatFailures: rows.filter((r) => r.actual === null).length,
    reliability,
    ece: scored.length
      ? reliability.reduce((sum, b) => sum + b.count * Math.abs((b.accuracy ?? 0) - (b.confidence ?? 0)), 0) / scored.length
      : null,
    coverageError: [0, 0.55, 0.8, 0.9, 0.95, 1].map((threshold) => {
      const covered = scored.filter((r) => r.confidence! >= threshold);
      return {
        threshold,
        coverage: rows.length ? covered.length / rows.length : 0,
        error: covered.length ? average(covered.map((r) => Number(r.actual !== r.expected))) : null,
      };
    }),
  };
}
export type PairedRow = { family: string; baseline: number; candidate: number };
/** Cluster bootstrap: first average all variants/repetitions inside a family, then resample families. */
export function pairedInterval(rows: readonly PairedRow[], seed = 42, iterations = 10000) {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const list = groups.get(r.family) ?? [];
    list.push(r.candidate - r.baseline);
    groups.set(r.family, list);
  }
  const values = [...groups.values()].map(average);
  const next = random(seed);
  const samples = Array.from({ length: iterations }, () =>
    average(values.map(() => values[Math.floor(next() * values.length)] ?? 0)),
  );
  return {
    delta: values.length ? average(values) : null,
    lower: values.length >= 2 ? quantile(samples, 0.025) : null,
    upper: values.length >= 2 ? quantile(samples, 0.975) : null,
    families: values.length,
    iterations,
    seed,
    weighting: 'equal-family means',
  };
}
/** Planning approximation only: paired binary variance, 80% power and two-sided 95% confidence. */
export function planSampleSize(discordance: number, targetImprovement: number, designEffect: number, margin = 0.02) {
  if (
    !(
      discordance > 0 &&
      discordance <= 1 &&
      targetImprovement > 0 &&
      targetImprovement <= discordance &&
      designEffect >= 1 &&
      margin > 0
    )
  )
    return { status: 'insufficient_evidence', scenarios: null };
  const factor = (1.959964 + 0.841621) ** 2 * designEffect;
  const superiority = Math.ceil((factor * Math.max(0, discordance - targetImprovement ** 2)) / targetImprovement ** 2);
  const nonInferiority = Math.ceil((factor * discordance) / margin ** 2);
  return {
    status: 'planning_estimate_requires_human_freeze',
    scenarios: Math.max(superiority, nonInferiority),
    superiority,
    nonInferiority,
    power: 0.8,
    margin,
    discordance,
    targetImprovement,
    designEffect,
  };
}
