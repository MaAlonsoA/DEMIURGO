// The design system record (DSY): the machine-readable part of a version (`record_versions.spec`)
// and the checks that block its approval. All pure. Tokens follow a subset of the W3C Design
// Tokens Format Module 2025.10: every token is `{ $value, $type, $description? }`, grouped.

import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb color');

function token<V extends z.ZodType>(value: V, type: string) {
  return z.object({ $value: value, $type: z.literal(type), $description: z.string().optional() });
}

// Our modelling choice: a color token carries both themes in one value, `$value: { light, dark }`,
// instead of two parallel groups `color.light` / `color.dark`. One name then always has both
// values, so a missing dark value is a schema error, not a silent gap. DTCG 2025.10 has no theming
// of its own (themes are left to tooling), so this is our convention.
const colorToken = token(z.object({ light: hex, dark: hex }), 'color');
const dimensionToken = token(z.string().min(1), 'dimension');
const fontFamilyToken = token(z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]), 'fontFamily');
const numberToken = token(z.number(), 'number');
const durationToken = token(z.string().regex(/^\d+(\.\d+)?m?s$/, 'Use a duration like 150ms'), 'duration');
// DTCG cubicBezier: [x1, y1, x2, y2], x in 0..1.
const cubicBezierToken = token(
  z.tuple([z.number().min(0).max(1), z.number(), z.number().min(0).max(1), z.number()]),
  'cubicBezier',
);
const shadowToken = token(z.string().min(1), 'shadow');

const group = <T extends z.ZodType>(t: T) => z.record(z.string().min(1), t);

export const designTokens = z.object({
  color: group(colorToken),
  typography: z.object({
    family: group(fontFamilyToken),
    size: group(dimensionToken),
    lineHeight: group(numberToken),
  }),
  space: group(dimensionToken),
  radius: group(dimensionToken),
  shadow: group(shadowToken),
  motion: z.object({
    // Durations as tokens: Material 3 motion tokens.
    duration: group(durationToken),
    // Standard, entrance and exit curves: IBM Carbon motion.
    easing: z.object({ standard: cubicBezierToken, entrance: cubicBezierToken, exit: cubicBezierToken }),
    // Productive (efficient, subtle) or expressive (more marked): IBM Carbon motion.
    scheme: z.enum(['productive', 'expressive']),
    // The rule for prefers-reduced-motion (WCAG 2.2, 2.3.3 Animation from Interactions).
    reduced: z.string(),
  }),
});
export type DesignTokens = z.infer<typeof designTokens>;

export const designComponent = z.object({
  name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Use a PascalCase name'),
  purpose: z.string().min(1),
  interactive: z.boolean(),
  variants: z.array(z.string()),
  states: z.array(z.string()),
  accessibility: z.string(),
  /** A specimen showing each state, rendered in an isolated preview. */
  specimen_html: z.string(),
});
export type DesignComponent = z.infer<typeof designComponent>;

export const designPattern = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  /** Names of the components it is made of. */
  uses: z.array(z.string()),
});
export type DesignPattern = z.infer<typeof designPattern>;

export const designSystemSpec = z.object({
  base: z.object({
    kind: z.enum(['public', 'scratch']),
    name: z.string().optional(),
    url: z.string().optional(),
    license: z.string().optional(),
  }),
  principles: z.array(z.string()),
  tokens: designTokens,
  components: z.array(designComponent),
  patterns: z.array(designPattern),
  // Where the system lives in the project's repo: our convention.
  paths: z.object({ system: z.string().default('src/design-system/') }),
});
export type DesignSystemSpec = z.infer<typeof designSystemSpec>;

// ── Checks ───────────────────────────────────────────────────────────────────────────────────────

// Material 3 (Component states) and our convention: an interactive component shows all of these.
export const REQUIRED_STATES = ['default', 'hover', 'focus', 'pressed', 'disabled'] as const;

// WCAG 2.2, 1.4.3 Contrast (Minimum), level AA: 4.5:1 for normal text.
export const TEXT_CONTRAST_MIN = 4.5;

// Ported from packages/web/test/unit/tokens.test.ts; formula from WCAG 2.2 (relative luminance).
function luminance(hexColor: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hexColor.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Which pairs are checked, by name (our convention): every color token named `text*` or `fg*`
// (first segment, split on - . _ or a capital) against every token named `bg*` or `surface*`, in
// both themes. Tokens for other roles (accent, border, on-accent…) are not paired here.
const first = (name: string) => name.split(/[-._]|(?=[A-Z])/)[0]?.toLowerCase() ?? '';
const isText = (name: string) => ['text', 'fg'].includes(first(name));
const isBackground = (name: string) => ['bg', 'surface'].includes(first(name));

/** Blocking problems, each phrased so an agent can fix the spec. */
export function designSystemProblems(spec: DesignSystemSpec): string[] {
  const out: string[] = [];
  const t = spec.tokens as Partial<DesignTokens> | undefined;
  const nonEmpty = (g: object | undefined) => g !== undefined && Object.keys(g).length > 0;

  const groups: [string, boolean][] = [
    ['color', nonEmpty(t?.color)],
    ['typography.family', nonEmpty(t?.typography?.family)],
    ['typography.size', nonEmpty(t?.typography?.size)],
    ['typography.lineHeight', nonEmpty(t?.typography?.lineHeight)],
    ['space', nonEmpty(t?.space)],
    ['radius', nonEmpty(t?.radius)],
    ['shadow', nonEmpty(t?.shadow)],
    ['motion.duration', nonEmpty(t?.motion?.duration)],
    ['motion.easing', Boolean(t?.motion?.easing?.standard && t.motion.easing.entrance && t.motion.easing.exit)],
    ['motion.scheme', Boolean(t?.motion?.scheme)],
  ];
  for (const [name, present] of groups) {
    if (!present) out.push(`Token group "${name}" is missing or empty: add it.`);
  }
  if (t?.motion?.easing !== undefined && !groups.find(([n]) => n === 'motion.easing')?.[1]) {
    out.push('Token group "motion.easing" needs the three curves standard, entrance and exit.');
  }
  if ((t?.motion?.reduced ?? '').trim() === '') {
    out.push('"motion.reduced" is empty: say what animations do under prefers-reduced-motion (WCAG 2.2, 2.3.3).');
  }

  const colors = Object.entries(t?.color ?? {});
  const texts = colors.filter(([n]) => isText(n));
  const backgrounds = colors.filter(([n]) => isBackground(n));
  if (nonEmpty(t?.color) && (texts.length === 0 || backgrounds.length === 0)) {
    out.push('Color needs at least one text token (named text* or fg*) and one background token (named bg* or surface*), so contrast can be checked.');
  }
  for (const [tn, tv] of texts) {
    for (const [bn, bv] of backgrounds) {
      for (const theme of ['light', 'dark'] as const) {
        const r = contrastRatio(tv.$value[theme], bv.$value[theme]);
        if (r < TEXT_CONTRAST_MIN) {
          out.push(
            `Contrast fails WCAG 2.2 AA in the ${theme} theme: "${tn}" (${tv.$value[theme]}) on "${bn}" (${bv.$value[theme]}) is ${r.toFixed(2)}:1, needs ${TEXT_CONTRAST_MIN}:1. Change one of the two colors.`,
          );
        }
      }
    }
  }

  const seen = new Set<string>();
  for (const c of spec.components) {
    if (seen.has(c.name)) out.push(`Component "${c.name}" appears more than once: names must be unique.`);
    seen.add(c.name);
    if (c.interactive) {
      const missing = REQUIRED_STATES.filter((s) => !c.states.includes(s));
      if (missing.length > 0) out.push(`Interactive component "${c.name}" lacks the states: ${missing.join(', ')}.`);
    }
    if (c.specimen_html.trim() === '') out.push(`Component "${c.name}" has an empty specimen_html: show each of its states.`);
  }
  for (const p of spec.patterns) {
    for (const u of p.uses) {
      if (!seen.has(u)) out.push(`Pattern "${p.name}" uses "${u}", which is not a component of the system: add it or change the pattern.`);
    }
  }
  return out;
}

// Nathan Curtis, "Starting a Design System" (EightShapes): a first version has a solid visual base
// and roughly 12 to 16 components. It is a warning, not a rule.
export const MVP_COMPONENTS_MIN = 12;

/** Non-blocking notes. */
export function designSystemWarnings(spec: DesignSystemSpec): string[] {
  const out: string[] = [];
  if (spec.components.length < MVP_COMPONENTS_MIN) {
    out.push(
      `It has ${spec.components.length} components; a first version usually has ${MVP_COMPONENTS_MIN} to 16 (Curtis, Starting a Design System). This is a warning, not a limit.`,
    );
  }
  return out;
}
