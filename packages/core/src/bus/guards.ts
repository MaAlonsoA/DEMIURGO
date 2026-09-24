// Guard registry by name. Each guard declared in design/data/transitions.yaml
// has its implementation here (AC-NUC-001-03). A guard returns null when it holds, or the
// reason, in product language, when it doesn't.

import type { Guard } from './types.ts';

export const GUARDS: Record<string, Guard> = {};

/** Registers guards; called from each command module. */
export function registerGuards(guards: Record<string, Guard>): void {
  for (const [name, g] of Object.entries(guards)) {
    if (GUARDS[name]) throw new Error(`The "${name}" guard is already registered.`);
    GUARDS[name] = g;
  }
}

/** Guards for later increments: they always block until implemented. */
export function pendingGuard(increment: string): Guard {
  return () => `This condition is implemented in ${increment}.`;
}

/** Text of an unknown value: the trimmed string, or empty. */
export const trimmed = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Reads a field from the command data without assuming its shape. */
export function field(data: unknown, name: string): unknown {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[name] : undefined;
}

registerGuards({
  reason_present: ({ data }) => (trimmed(field(data, 'reason')) ? null : 'A reason is required.'),
  fdr_ready_to_build: pendingGuard('S3'),
  full_coverage: pendingGuard('S3'),
  gates_green: pendingGuard('S4'),
  covers_at_least_one_approved_ac: pendingGuard('S3'),
  attempts_remaining: pendingGuard('S4'),
  clarification_present: pendingGuard('S5'),
  red_test_on_base: pendingGuard('S3'),
  ac_manual: pendingGuard('S4'),
  test_map_accepted: pendingGuard('S3'),
});
