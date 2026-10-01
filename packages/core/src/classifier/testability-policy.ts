// What Jev's answers on a criterion mean for the person (H97). Pure, so the pages and the tests can
// read it without the request code.

// Policy thresholds. They are OUR CONVENTION, not a TypeSafe or industry standard: TypeSafe's
// confidence guidance says thresholds depend on the cost of being wrong and must be tuned on the
// project's own data (docs.typesafe.ai/confidence). Tuned on 35 criteria of «Comidas y entrenos»
// (4 that cost review loops, 31 that built fine) in an A/B audit of 01-10-2026, with
// packages/core/scripts/eval-testability.ts: a criterion is flagged when `needs_outside_ci >= 0.5` or
// `needs_unbuilt_feature >= 0.5`. `can_check_in_ci` is no longer asked: it only repeated the
// first question. A wrong flag only shows a warning; nothing is blocked.
export const UNTESTABLE_OUTSIDE_MIN = 0.5;
export const WAITS_FOR_FEATURE_MIN = 0.5;

/** What checking a criterion needs: the answer of the Choice stored with each opinion. */
export const NEEDS_KINDS = ['ci_automated', 'needs_production', 'needs_person', 'needs_unbuilt_part'] as const;
export type NeedsKind = (typeof NEEDS_KINDS)[number];
export const isNeedsKind = (v: unknown): v is NeedsKind => typeof v === 'string' && (NEEDS_KINDS as readonly string[]).includes(v);

export type TestabilityProbabilities = { needs_outside_ci: number; needs_unbuilt_feature: number };
export type TestabilityVerdict = 'ok' | 'untestable' | 'waits_for_feature';

/** The warning a criterion earns from Jev's probabilities. */
export function testabilityVerdict(p: TestabilityProbabilities): TestabilityVerdict {
  if (p.needs_outside_ci >= UNTESTABLE_OUTSIDE_MIN) return 'untestable';
  if (p.needs_unbuilt_feature >= WAITS_FOR_FEATURE_MIN) return 'waits_for_feature';
  return 'ok';
}

/** How sure the warning is, for the line the person reads. */
export function testabilityStrength(p: TestabilityProbabilities, verdict: TestabilityVerdict): number {
  if (verdict === 'untestable') return p.needs_outside_ci;
  if (verdict === 'waits_for_feature') return p.needs_unbuilt_feature;
  return 0;
}
