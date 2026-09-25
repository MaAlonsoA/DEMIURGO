// The web is built with the DEMIURGO design system (@demiurgo/design-system): every one of its
// components is in use, the stylesheet is loaded once, and the look comes only from its tokens and
// classes: no raw colors, no Tailwind colors, radii, shadows or font sizes of its own.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ds from '@demiurgo/design-system';
import { describe, expect, it } from 'vitest';

const web = fileURLToPath(new URL('../../src', import.meta.url));
const dsRoot = fileURLToPath(new URL('../../../design-system', import.meta.url));

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

const css = readFileSync(join(dsRoot, 'demiurgo.css'), 'utf8');
const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
const tokens = new Set([...rootBlock.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1] ?? ''));
const COLORS = [...tokens].filter((t) =>
  /^#|rgba?\(/.test(rootBlock.match(new RegExp(`--${t}:\\s*([^;]+);`))?.[1]?.trim() ?? ''),
);
const RADII = [...tokens].filter((t) => t.startsWith('radius-')).map((t) => t.slice('radius-'.length));

function offenders(pattern: RegExp, allowed: (match: RegExpMatchArray) => boolean, among = code): string[] {
  return among.flatMap((s) =>
    [...s.text.matchAll(pattern)]
      // A CSS property (border-radius: …) is not a class.
      .filter((m) => !/^\s*:/.test(s.text.slice((m.index ?? 0) + m[0].length)))
      .filter((m) => !allowed(m))
      .map((m) => `${s.path}: ${m[0]}`),
  );
}
/** The code that writes classes: the stylesheet itself is CSS, on the design system's variables. */
const classes = code.filter((s) => !s.path.endsWith('.css'));

describe('the web uses the whole DEMIURGO design system', () => {
  it('uses every component of the design system', () => {
    const components = Object.entries(ds)
      .filter(([name, value]) => typeof value === 'function' && /^[A-Z]/.test(name))
      .map(([name]) => name);
    expect(components).toHaveLength(22);
    const imported = new Set(
      code.flatMap((s) =>
        [...s.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@demiurgo\/design-system'/g)].flatMap((m) =>
          (m[1] ?? '')
            .split(',')
            .map((n) => n.trim())
            .filter((n) => n && !n.startsWith('type '))
            .map((n) => n.split(/\s+as\s+/)[0]?.trim() ?? ''),
        ),
      ),
    );
    expect(components.filter((c) => !imported.has(c))).toEqual([]);
  });

  it('loads its fonts and its stylesheet, with every token and dm-* class', () => {
    const styles = sources.find((s) => s.path === 'styles.css')?.text ?? '';
    expect(styles).toContain("@import '@demiurgo/design-system/fonts.css';");
    expect(styles).toMatch(/@import '@demiurgo\/design-system\/demiurgo\.css'/);
    expect(COLORS.length).toBeGreaterThan(30);
  });

  it('has no colors of its own: no hex, rgb or hsl values', () => {
    expect(offenders(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g, () => false)).toEqual([]);
  });

  it('paints only with the design system colors', () => {
    const colorless: Record<string, RegExp> = {
      text: /^(left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/,
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
    };
    const colors = new Set([...COLORS, 'transparent', 'current']);
    const bad = offenders(
      /(?<![\w-])(text|bg|border(?:-[trblxyse])?|outline|ring|fill|stroke|from|via|to|placeholder|decoration|divide)-([a-z][a-z0-9-]*[a-z0-9]|\d+%?)(?:\/\d+)?(?![\w-])/g,
      (m) => {
        const prefix = (m[1] ?? '').replace(/^border-[trblxyse]$/, 'border');
        const name = m[2] ?? '';
        return colors.has(name) || (colorless[prefix]?.test(name) ?? false);
      },
      classes,
    );
    expect(bad).toEqual([]);
  });

  it('writes with the design system type styles, not font sizes of its own', () => {
    expect(offenders(/(?<![\w-])text-(xs|sm|base|lg|[2-9]?xl|\[\d[^\]]*\])(?![\w-])/g, () => false, classes)).toEqual([]);
    expect(offenders(/(?<![\w-])(tracking|leading)-\[[^\]]+\]/g, () => false, classes)).toEqual([]);
  });

  it('rounds and lifts only with the design system radii and shadows', () => {
    const radius = new RegExp(`^(${[...RADII, 'full', 'none'].join('|')})$`);
    expect(
      offenders(
        /(?<![\w-])rounded(?:-(?:[trblse]{1,2}))?(?:-([a-z0-9[\]().-]+))?(?![\w-])/g,
        (m) => radius.test(m[1] ?? 'x'),
        classes,
      ),
    ).toEqual([]);
    expect(
      offenders(
        /(?<![\w-])(?:drop-)?shadow(?:-([a-z0-9[\]().,_-]+))?(?![\w-])/g,
        (m) => /^(raised|float|selected|halo-working|none)$/.test(m[1] ?? 'x'),
        classes,
      ),
    ).toEqual([]);
  });

  it('refers only to the design system tokens', () => {
    expect(offenders(/var\(--([a-z0-9-]+)/g, (m) => tokens.has(m[1] ?? '') || (m[1] ?? '').startsWith('tw-'))).toEqual([]);
  });
});
