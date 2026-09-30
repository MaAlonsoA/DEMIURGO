// The screen design of a feature (SCR): the machine-readable part of a version (`record_versions.spec`)
// and the checks that block it. All pure. The practice: the design goes one step ahead of delivery
// (Cagan and Patton, SVPG), the feature's main flow becomes a wireflow (Nielsen Norman Group), and each
// screen is drawn in its states (empty, loading, error, with data) with the project's design system.

import { z } from 'zod';

const stateHtml = z.string().max(60_000);

export const screenSpec = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use a kebab-case id'),
  name: z.string().min(1).max(200),
  purpose: z.string().min(1).max(2000),
  /** The Behavior steps of the feature (1-based) this screen serves. */
  steps: z.array(z.number().int().positive()).max(40),
  /** Names of the design-system components it uses (PascalCase). */
  components: z.array(z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Use a PascalCase component name')).max(60),
  /** Each state as self-contained HTML that uses the design tokens as CSS variables. */
  states: z.object({ empty: stateHtml, loading: stateHtml, error: stateHtml, data: stateHtml }).strict(),
});
export type ScreenSpec = z.infer<typeof screenSpec>;

export const screenTransition = z.object({
  from: z.string(),
  to: z.string(),
  trigger: z.string().min(1).max(500),
  step: z.number().int().positive().nullable(),
});
export type ScreenTransition = z.infer<typeof screenTransition>;

export const screenDesignSpec = z.object({
  feature: z.object({ code: z.string().regex(/^[A-Z]{3}-[A-Z]{3}-\d{3}$/), version: z.number().int().positive() }).strict(),
  /** A feature with no interface says so and why. */
  no_ui: z.object({ reason: z.string().min(1).max(2000) }).strict().nullable(),
  screens: z.array(screenSpec).max(40),
  flow: z.array(screenTransition).max(200),
});
export type ScreenDesignSpec = z.infer<typeof screenDesignSpec>;

/** The sections of a screen design, in order (RECORD_TEMPLATES.screen_design). */
export const SCREEN_DESIGN_SECTION_TITLES = ['Flow', 'Screens', 'States', 'Components'] as const;

export const SCREEN_STATES = ['empty', 'loading', 'error', 'data'] as const;

/**
 * Blocking problems, each phrased so an agent can fix the spec. `fdrSteps` is the number of Behavior
 * steps of the feature version it rests on; null when it is not known yet (the step coverage and range
 * are then left to the check that knows it).
 */
export function screenDesignProblems(spec: ScreenDesignSpec, fdrSteps: number | null): string[] {
  const out: string[] = [];
  if (spec.no_ui && spec.screens.length > 0) out.push('`no_ui` and `screens` are exclusive: a feature with no interface has no screens.');
  if (spec.no_ui && spec.flow.length > 0) out.push('A feature with no interface has no flow.');
  const ids = spec.screens.map((s) => s.id);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) out.push(`The screen id "${id}" is repeated: ids are unique.`);
  const known = new Set(ids);
  for (const t of spec.flow) {
    for (const end of [t.from, t.to]) if (!known.has(end)) out.push(`The flow goes through "${end}", which is not a screen id.`);
  }
  for (const s of spec.screens) {
    for (const state of SCREEN_STATES) {
      const html = s.states[state];
      if (html.trim() === '') out.push(`Screen "${s.id}" has no ${state} state: draw all four (empty, loading, error, data).`);
      else out.push(...htmlProblems(`Screen "${s.id}", ${state} state`, html));
    }
    if (fdrSteps !== null) {
      const bad = s.steps.filter((n) => n < 1 || n > fdrSteps);
      if (bad.length > 0) out.push(`Screen "${s.id}" serves step ${bad.join(', ')}, but the feature has ${fdrSteps} steps.`);
    }
  }
  for (const t of spec.flow) if (fdrSteps !== null && t.step !== null && (t.step < 1 || t.step > fdrSteps))
    out.push(`A flow transition names step ${t.step}, but the feature has ${fdrSteps} steps.`);
  if (!spec.no_ui) {
    if (spec.screens.length === 0) out.push('Draw the screens, or say `no_ui` and why.');
    if (fdrSteps !== null) {
      const served = new Set(spec.screens.flatMap((s) => s.steps));
      const missing = Array.from({ length: fdrSteps }, (_, i) => i + 1).filter((n) => !served.has(n));
      if (spec.screens.length > 0 && missing.length > 0)
        out.push(`Behavior ${missing.length === 1 ? 'step' : 'steps'} ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not served by any screen.`);
    }
  }
  return out;
}

/** A state is self-contained: no scripts, no event handlers and nothing loaded from outside. */
function htmlProblems(where: string, html: string): string[] {
  const out: string[] = [];
  if (/<script/i.test(html)) out.push(`${where}: no <script> (the preview runs no code).`);
  if (/\son[a-z]+\s*=/i.test(html)) out.push(`${where}: no inline event handlers.`);
  if (/https?:\/\//i.test(html) || /(?:src|href)\s*=\s*["']?\s*\/\//i.test(html) || /url\(\s*["']?\s*\/\//i.test(html))
    out.push(`${where}: no external URL (it must be self-contained).`);
  return out;
}

/** The components the screens use that the approved design system does not have (sorted, once each). */
export function missingComponents(spec: ScreenDesignSpec, dsyComponentNames: readonly string[]): string[] {
  const have = new Set(dsyComponentNames);
  return [...new Set(spec.screens.flatMap((s) => s.components))].filter((c) => !have.has(c)).sort();
}

/** The reason an accept is refused while components are missing (null when none is). */
export function missingComponentsReason(missing: readonly string[]): string | null {
  return missing.length === 0 ? null : `Add ${missing.join(', ')} to the design system first.`;
}
