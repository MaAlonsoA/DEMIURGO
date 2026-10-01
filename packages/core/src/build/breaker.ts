// Retry breaker: an attempt that fails the same guard with the same finding again and again is not going to fix itself,
// so the automatic retries stop and the request goes to the person (`needs_you`). TSK-MYA-018 failed the duplicate-tests
// guard on 15 consecutive attempts without anyone being asked.
// Source for the practice: the circuit breaker stability pattern (Michael T. Nygard, «Release It!», 2nd ed.,
// «Stability Patterns»): after repeated failures of the same call, stop calling and surface it. The number of
// consecutive identical failures (3) is our convention.

/** Consecutive attempts failing one guard with one finding before the retries stop (our convention). */
export const BREAKER_ATTEMPTS = 3;

export type GuardFailure = { attempt: number; error: string };
export type Breaker = { guard: string; finding: string; attempts: number };

const GUARDS: readonly [RegExp, string][] = [
  [/ownership violation/i, 'ownership'],
  [/duplicate tests?\b/i, 'test-guard'],
  [/design-system violation/i, 'design-system'],
];

/** The guard(s) a design-stage error comes from; `design` when none is recognised. */
export function guardOf(error: string): string {
  const found = GUARDS.filter(([re]) => re.test(error)).map(([, name]) => name);
  return found.length > 0 ? found.join('+') : 'design';
}

/** The finding without what changes between identical failures: timestamps and line numbers. */
export function normaliseFinding(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, '')
    .replace(/\blines?\s+\d+(\s*[-–]\s*\d+)?/gi, 'line')
    .replace(/:\d+(:\d+)?(?=[\s|,;)\]]|$)/g, '')
    .replace(/\bL\d+(-L?\d+)?\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The breaker, when the `attempts` most recent attempts up to `current` (consecutive numbers) all failed with the same
 * normalised finding; null otherwise (a gap, a different finding or too few attempts keep it closed).
 */
export function tripped(failures: GuardFailure[], current: number, attempts = BREAKER_ATTEMPTS): Breaker | null {
  const findings: string[] = [];
  for (let a = current; a > current - attempts; a--) {
    const failure = failures.find((f) => f.attempt === a);
    const finding = failure ? normaliseFinding(failure.error) : '';
    if (!finding) return null;
    findings.push(finding);
  }
  if (new Set(findings).size !== 1) return null;
  const last = failures.find((f) => f.attempt === current) as GuardFailure;
  return { guard: guardOf(last.error), finding: findings[0] as string, attempts };
}
