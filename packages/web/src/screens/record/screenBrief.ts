// The brief for designing a feature's screens in Claude Design (claude.ai/design), built in the browser
// from the feature (goal, Behavior steps, acceptance criteria) and the project's approved design system
// (tokens and components with their states). It asks for the four states of every screen, using only
// those components, exported as self-contained HTML. Wireflow and states: VISION.md «Diseño de pantallas».

import type { DesignSystemSpec, Section } from '../../api/types.ts';
import { stepsOf } from '../../components/BehaviorSteps.tsx';

type BriefCriterion = { code: string; title: string; statement: string; step?: number | null };

export type ScreenBriefInput = {
  code: string;
  title: string;
  sections: readonly Section[];
  criteria: readonly BriefCriterion[];
  /** The approved design system; null when the project has none. */
  system: { code: string; version: number; spec: DesignSystemSpec } | null;
};

const section = (sections: readonly Section[], title: string) => sections.find((s) => s.title === title)?.content.trim() ?? '';

/** Flattens the token groups of a design system into `--name: value` lines the screens can use as CSS variables. */
export function tokenLines(spec: DesignSystemSpec): string[] {
  const t = spec.tokens;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(t.color)) lines.push(`--color-${k}: light ${v.$value.light} / dark ${v.$value.dark}`);
  for (const [k, v] of Object.entries(t.typography.family)) lines.push(`--font-${k}: ${[v.$value].flat().join(', ')}`);
  for (const [k, v] of Object.entries(t.typography.size)) lines.push(`--text-${k}: ${v.$value}`);
  for (const [k, v] of Object.entries(t.typography.lineHeight)) lines.push(`--leading-${k}: ${v.$value}`);
  for (const [k, v] of Object.entries(t.space)) lines.push(`--space-${k}: ${v.$value}`);
  for (const [k, v] of Object.entries(t.radius)) lines.push(`--radius-${k}: ${v.$value}`);
  for (const [k, v] of Object.entries(t.shadow)) lines.push(`--shadow-${k}: ${v.$value}`);
  return lines;
}

export function buildScreenBrief(input: ScreenBriefInput): string {
  const goal = section(input.sections, 'Goal');
  const behavior = section(input.sections, 'Behavior');
  const steps = stepsOf(behavior);
  const out: string[] = [];
  out.push(`# Design the screens of ${input.code} · ${input.title}`);
  out.push('');
  out.push('Design the screens of this feature in Claude Design. Follow the design system below to the letter.');
  if (goal) out.push('', '## Goal', '', goal);
  out.push('', '## Behavior: the steps the screens must serve', '');
  if (steps.length > 0) {
    for (const s of steps) {
      out.push(`${s.n}. ${s.title}`);
      for (const d of s.detail) out.push(`   - ${d}`);
    }
  } else out.push(behavior || '(no Behavior written)');
  if (input.criteria.length > 0) {
    out.push('', '## Acceptance criteria', '');
    for (const c of input.criteria) out.push(`- ${c.code}${c.step ? ` (step ${c.step})` : ''}: ${c.statement || c.title}`);
  }
  if (input.system) {
    const { spec } = input.system;
    out.push('', `## Design system (${input.system.code} v${input.system.version})`);
    if (spec.principles.length > 0) out.push('', 'Principles:', ...spec.principles.map((p) => `- ${p}`));
    out.push('', 'Tokens (use them as CSS variables; never raw values):', '', ...tokenLines(spec).map((l) => `- ${l}`));
    out.push('', 'Components (use only these, by name):', '');
    for (const c of spec.components) {
      const parts = [c.purpose];
      if (c.variants.length > 0) parts.push(`variants: ${c.variants.join(', ')}`);
      if (c.states.length > 0) parts.push(`states: ${c.states.join(', ')}`);
      out.push(`- ${c.name}: ${parts.join('; ')}`);
    }
  }
  out.push(
    '',
    '## What to deliver',
    '',
    '1. The flow: the screens and the transitions between them (what triggers each one and which step it serves).',
    '2. For every screen, its four states: empty, loading, error and with data.',
    '3. Use only the components and tokens above. If a screen needs a component that is not listed, name it instead of inventing a look.',
    '4. Export each state as self-contained HTML: inline CSS, no scripts, no external URLs.',
  );
  return out.join('\n');
}
