// What Jev's three probabilities on a criterion mean for the person (H97). Pure, so the pages and the
// tests can read it without the request code.

// Policy thresholds. They are OUR CONVENTION, not a TypeSafe or industry standard: TypeSafe's
// confidence guidance says thresholds depend on the cost of being wrong and must be tuned on the
// project's own data (docs.typesafe.ai/confidence). Tuned on 16 criteria of «Comidas y entrenos» with
// packages/core/scripts/eval-testability.ts (01-10-2026): the 13 that built fine had can-check >= 0.76,
// outside <= 0.21 and unbuilt <= 0.19; the 3 that cost review loops had outside 0.90 / 0.59 (can-check
// 0.26) and unbuilt 0.68. 0.5 separates both groups on that small sample; retune as data grows.
// A wrong flag only shows a warning; nothing is blocked.
export const UNTESTABLE_OUTSIDE_MIN = 0.5;
export const UNTESTABLE_CAN_CHECK_MAX = 0.3;
export const WAITS_FOR_FEATURE_MIN = 0.5;

export type TestabilityProbabilities = { can_check_in_ci: number; needs_outside_ci: number; needs_unbuilt_feature: number };
export type TestabilityVerdict = 'ok' | 'untestable' | 'waits_for_feature';

/** The warning a criterion earns from Jev's probabilities. */
export function testabilityVerdict(p: TestabilityProbabilities): TestabilityVerdict {
  if (p.needs_outside_ci >= UNTESTABLE_OUTSIDE_MIN || p.can_check_in_ci <= UNTESTABLE_CAN_CHECK_MAX) return 'untestable';
  if (p.needs_unbuilt_feature >= WAITS_FOR_FEATURE_MIN) return 'waits_for_feature';
  return 'ok';
}

/** How sure the warning is, for the line the person reads. */
export function testabilityStrength(p: TestabilityProbabilities, verdict: TestabilityVerdict): number {
  if (verdict === 'untestable') return Math.max(p.needs_outside_ci, 1 - p.can_check_in_ci);
  if (verdict === 'waits_for_feature') return p.needs_unbuilt_feature;
  return 0;
}

