// The design handoff: the designer (the person, in Claude Design) hands the designed screens to development.
// The form's draft becomes the screen design spec and its four sections (English prose, deterministic),
// and the domain's pure checks run on it in the browser, the same ones the server runs (409/422 there).

import {
  SCREEN_STATES,
  type ScreenDesignSpec,
  missingComponents,
  screenDesignProblems,
  screenDesignSpec,
} from '@demiurgo/domain/screen-design';

export type DraftState = Record<(typeof SCREEN_STATES)[number], string>;
export type DraftScreen = {
  /** Local key: stable while the name is being typed. The spec's id is the kebab-case of the name. */
  key: string;
  name: string;
  purpose: string;
  steps: number[];
  components: string[];
  states: DraftState;
};
export type DraftTransition = { from: string; to: string; trigger: string; step: string };
export type Draft = { noUi: boolean; reason: string; screens: DraftScreen[]; flow: DraftTransition[] };

export const emptyScreen = (key: string): DraftScreen => ({
  key,
  name: '',
  purpose: '',
  steps: [],
  components: [],
  states: { empty: '', loading: '', error: '', data: '' },
});

export function kebab(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The form prefilled from an existing spec (a new version starts from the current one). */
export function draftOf(spec: ScreenDesignSpec | null): Draft {
  if (!spec) return { noUi: false, reason: '', screens: [emptyScreen('s1')], flow: [] };
  return {
    noUi: spec.no_ui !== null,
    reason: spec.no_ui?.reason ?? '',
    screens: spec.screens.map((s) => ({ key: s.id, name: s.name, purpose: s.purpose, steps: [...s.steps], components: [...s.components], states: { ...s.states } })),
    flow: spec.flow.map((f) => ({ from: f.from, to: f.to, trigger: f.trigger, step: f.step === null ? '' : String(f.step) })),
  };
}

export function specOf(draft: Draft, feature: { code: string; version: number }): ScreenDesignSpec {
  if (draft.noUi) return { feature, no_ui: { reason: draft.reason.trim() }, screens: [], flow: [] };
  const idOf = new Map(draft.screens.map((s, i) => [s.key, kebab(s.name) || `screen-${i + 1}`]));
  return {
    feature,
    no_ui: null,
    screens: draft.screens.map((s) => ({
      id: idOf.get(s.key) ?? s.key,
      name: s.name.trim(),
      purpose: s.purpose.trim(),
      steps: [...s.steps].sort((a, b) => a - b),
      components: [...s.components],
      states: { ...s.states },
    })),
    flow: draft.flow
      .filter((f) => f.from && f.to)
      .map((f) => ({ from: idOf.get(f.from) ?? f.from, to: idOf.get(f.to) ?? f.to, trigger: f.trigger.trim(), step: f.step ? Number(f.step) : null })),
  };
}

/** The sections of the record, in English prose, built only from what the form says. */
export function sectionsOf(spec: ScreenDesignSpec): { title: string; content: string }[] {
  const name = (id: string) => spec.screens.find((s) => s.id === id)?.name ?? id;
  if (spec.no_ui) {
    const line = `This feature has no interface. ${spec.no_ui.reason}`;
    return ['Flow', 'Screens', 'States', 'Components'].map((title) => ({ title, content: title === 'Flow' || title === 'Screens' ? line : 'None.' }));
  }
  const flow =
    spec.flow.length === 0
      ? 'A single screen, so no transitions.'
      : spec.flow.map((f, i) => `${i + 1}. ${name(f.from)} to ${name(f.to)}: ${f.trigger}${f.step ? ` (step ${f.step})` : ''}.`).join('\n');
  const screens = spec.screens.map((s) => `- ${s.name}: ${s.purpose}`).join('\n');
  const states = spec.screens.map((s) => `- ${s.name}: empty, loading, error, with data.`).join('\n');
  const used = [...new Set(spec.screens.flatMap((s) => s.components))];
  return [
    { title: 'Flow', content: flow },
    { title: 'Screens', content: screens },
    { title: 'States', content: states },
    { title: 'Components', content: used.length > 0 ? used.join(', ') : 'None.' },
  ];
}

/** Every problem the domain finds, live: the shape, the four states, the steps served, the components the system lacks. */
export function checkSpec(spec: ScreenDesignSpec, fdrSteps: number, dsyComponents: readonly string[]) {
  const shape = screenDesignSpec.safeParse(spec);
  const problems = shape.success
    ? screenDesignProblems(spec, fdrSteps)
    : shape.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  return { problems, missing: missingComponents(spec, dsyComponents) };
}
