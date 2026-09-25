// The web paints only with its design tokens (DESIGN.md §6, §6.7), and those tokens meet WCAG 2.2 AA
// in both themes: every text pair at 4.5:1 and every non-text pair (focus, control borders, status
// fills) at 3:1, with no rounding (R89, R90). It replaces the old design-system guard (D-017).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const web = fileURLToPath(new URL('../../src', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

const sources = files(web).map((path) => ({
  path: path.slice(web.length + 1).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));
/** Code without its comments: what a comment says about a class is not a class. */
const code = sources.map((s) => ({ ...s, text: s.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1') }));

const tokensCss = sources.find((s) => s.path === 'styles/tokens.css')?.text ?? '';
const themeCss = sources.find((s) => s.path === 'styles/theme.css')?.text ?? '';
const entryCss = sources.find((s) => s.path === 'styles.css')?.text ?? '';

// ── The tokens and their two values ──────────────────────────────────────────────────────────────

const pairs = new Map<string, { light: string; dark: string }>();
for (const m of tokensCss.matchAll(/--(c-[a-z0-9-]+):\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/gi)) {
  pairs.set(m[1] ?? '', { light: (m[2] ?? '').toLowerCase(), dark: (m[3] ?? '').toLowerCase() });
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const SURFACES = ['app', 'panel', 'sunken', 'hover'];
/** [foreground, background, minimum]: text 4.5, non-text 3. */
const CHECKS: [string, string, number][] = [
  ...['fg', 'fg-2', 'fg-3'].flatMap((fg) => SURFACES.map((bg) => [fg, bg, 4.5] as [string, string, number])),
  ['fg', 'selected', 4.5],
  ['fg-2', 'selected', 4.5],
  ['on-accent', 'accent', 4.5],
  ['on-accent', 'accent-hover', 4.5],
  ['on-danger', 'danger', 4.5],
  ['on-danger', 'danger-hover', 4.5],
  ['on-inverse', 'inverse', 4.5],
  ...['accent', 'info', 'success', 'warning', 'danger'].flatMap((t) => [
    [`${t}-text`, 'panel', 4.5] as [string, string, number],
    [`${t}-text`, 'app', 4.5] as [string, string, number],
    [`${t}-text`, `${t}-soft`, 4.5] as [string, string, number],
  ]),
  ['accent-text', 'selected', 4.5],
  ['fg', 'accent-soft', 4.5],
  ['fg', 'danger-soft', 4.5],
  ['fg', 'warning-soft', 4.5],
  ['fg', 'info-soft', 4.5],
  ['fg', 'success-soft', 4.5],
  // Non-text: the focus ring, the border that identifies an empty control, and status fills.
  ...['app', 'panel', 'sunken'].map((bg) => ['focus', bg, 3] as [string, string, number]),
  ['edge-control', 'panel', 3],
  ['edge-control', 'sunken', 3],
  ...['info', 'success', 'warning', 'danger', 'accent'].flatMap((t) => [
    [t, 'panel', 3] as [string, string, number],
    [t, 'app', 3] as [string, string, number],
  ]),
];

describe('the design tokens', () => {
  it('define a light and a dark value for every color the checks need', () => {
    const needed = new Set(CHECKS.flatMap(([a, b]) => [`c-${a}`, `c-${b}`]));
    expect([...needed].filter((t) => !pairs.has(t))).toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`meet WCAG 2.2 AA contrast in the ${theme} theme`, () => {
      const failing = CHECKS.flatMap(([fg, bg, min]) => {
        const a = pairs.get(`c-${fg}`)?.[theme];
        const b = pairs.get(`c-${bg}`)?.[theme];
        if (!a || !b) return [`${fg} on ${bg}: missing`];
        const r = ratio(a, b);
        return r >= min ? [] : [`${fg} ${a} on ${bg} ${b}: ${r.toFixed(2)} < ${min}`];
      });
      expect(failing).toEqual([]);
    });
  }
});

// ── Only the theme paints ────────────────────────────────────────────────────────────────────────

const themeNames = (css: string, prefix: string) =>
  new Set([...css.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+):`, 'g'))].map((m) => m[1] ?? ''));

const COLORS = new Set([...themeNames(themeCss, 'color'), 'transparent', 'current', 'inherit']);
const TEXT = new Set([...themeNames(themeCss, 'text')].filter((n) => !n.includes('--')));
const RADII = new Set([...themeNames(themeCss, 'radius'), 'full', 'none']);
const SHADOWS = new Set([...themeNames(themeCss, 'shadow'), 'none']);
const TOKENS = new Set([...tokensCss.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1] ?? ''));

function offenders(pattern: RegExp, allowed: (m: RegExpMatchArray) => boolean, among = code): string[] {
  return among.flatMap((s) =>
    [...s.text.matchAll(pattern)]
      // A CSS property (border-radius: …) is not a class.
      .filter((m) => !/^\s*:/.test(s.text.slice((m.index ?? 0) + m[0].length)))
      .filter((m) => !allowed(m))
      .map((m) => `${s.path}: ${m[0]}`),
  );
}

/** The code that writes classes: stylesheets are CSS on the tokens. */
const classes = code.filter((s) => !s.path.endsWith('.css'));

describe('the web paints only with its tokens', () => {
  it('loads only its own stylesheets: Tailwind, the tokens, the theme and the base rules', () => {
    const imports = [...entryCss.matchAll(/@import\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['tailwindcss', './styles/tokens.css', './styles/theme.css', './styles/base.css']);
  });

  it('has no raw colors in components: no hex, rgb or hsl outside the token file', () => {
    expect(offenders(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/g, () => false, classes)).toEqual([]);
  });

  it('uses only theme colors in its classes', () => {
    const colorless: Record<string, RegExp> = {
      text: /^(left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|xs|sm|base|md|lg|xl|2xl|3xl)$/,
      bg: /^(none|linear-to-[trbl]{1,2}|clip-.+|origin-.+|repeat.*|no-repeat|cover|contain|fixed|local|scroll)$/,
      border: /^([trblxyse]|[trblxyse]-\d+|\d+|solid|dashed|dotted|double|none|hidden|collapse|separate|spacing-.+)$/,
      outline: /^(none|hidden|dashed|dotted|double|solid|\d+|offset-.+)$/,
      ring: /^(\d+|inset|offset-.+)$/,
      from: /^\d+%$/,
      via: /^\d+%$/,
      to: /^\d+%$/,
      fill: /^none$/,
      stroke: /^\d+$/,
      divide: /^([xy]|[xy]-\d+|\d+|solid|dashed|dotted|reverse)$/,
      decoration: /^(solid|double|dotted|dashed|wavy|\d+|auto|from-font|clone|slice)$/,
      placeholder: /^$/,
    };
    const bad = offenders(
      /(?<![\w-])(text|bg|border(?:-[trblxyse])?|outline|ring|fill|stroke|from|via|to|placeholder|decoration|divide)-([a-z][a-z0-9-]*[a-z0-9]|\d+%?)(?:\/\d+)?(?![\w-])/g,
      (m) => {
        const prefix = (m[1] ?? '').replace(/^border-[trblxyse]$/, 'border');
        const name = m[2] ?? '';
        return COLORS.has(name) || (colorless[prefix]?.test(name) ?? false);
      },
      classes,
    );
    expect(bad).toEqual([]);
  });

  it('writes with the type scale only: no arbitrary sizes, leading or tracking', () => {
    expect(offenders(/(?<![\w-])text-\[[^\]]+\]/g, () => false, classes)).toEqual([]);
    expect(offenders(/(?<![\w-])(tracking|leading)-\[[^\]]+\]/g, () => false, classes)).toEqual([]);
    expect(TEXT.size).toBeGreaterThanOrEqual(8);
  });

  it('rounds and lifts only with the theme radii and shadows', () => {
    expect(
      offenders(
        /(?<![\w-])rounded(?:-(?:[trblse]{1,2}))?(?:-([a-z0-9[\]().-]+))?(?![\w-])/g,
        (m) => RADII.has(m[1] ?? '_bare'),
        classes,
      ),
    ).toEqual([]);
    expect(
      offenders(/(?<![\w-])(?:drop-)?shadow(?:-([a-z0-9[\]().,_-]+))?(?![\w-])/g, (m) => SHADOWS.has(m[1] ?? '_bare'), classes),
    ).toEqual([]);
  });

  it('refers only to tokens that exist', () => {
    expect(offenders(/var\(--([a-z0-9-]+)/g, (m) => TOKENS.has(m[1] ?? '') || (m[1] ?? '').startsWith('tw-'))).toEqual([]);
  });
});
