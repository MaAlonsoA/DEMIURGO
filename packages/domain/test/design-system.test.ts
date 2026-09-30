import { describe, expect, it } from 'vitest';
import { designSystemProblems, designSystemSpec, designSystemWarnings, type DesignSystemSpec } from '../src/design-system.ts';

const tok = <T, K extends string>(v: T, type: K) => ({ $value: v, $type: type });
const curve = tok([0.2, 0, 0.38, 0.9] as [number, number, number, number], 'cubicBezier' as const);
const STATES = ['default', 'hover', 'focus', 'pressed', 'disabled'];

function valid(): DesignSystemSpec {
  return designSystemSpec.parse({
    base: { kind: 'scratch' },
    principles: ['Sober and document-like'],
    tokens: {
      color: {
        'text-primary': tok({ light: '#111111', dark: '#f5f5f5' }, 'color'),
        'bg-app': tok({ light: '#ffffff', dark: '#101010' }, 'color'),
        'surface-panel': tok({ light: '#f4f4f4', dark: '#1a1a1a' }, 'color'),
      },
      typography: {
        family: { sans: tok('Inter, sans-serif', 'fontFamily') },
        size: { base: tok('16px', 'dimension') },
        lineHeight: { base: tok(1.5, 'number') },
      },
      space: { 1: tok('4px', 'dimension') },
      radius: { sm: tok('4px', 'dimension') },
      shadow: { sm: tok('0 1px 2px rgba(0,0,0,.2)', 'shadow') },
      motion: {
        duration: { fast: tok('100ms', 'duration'), base: tok('200ms', 'duration'), slow: tok('400ms', 'duration') },
        easing: { standard: curve, entrance: curve, exit: curve },
        scheme: 'productive',
        reduced: 'Replace movement with an instant change or a fade under 100ms.',
      },
    },
    components: [
      { name: 'Button', purpose: 'Act', interactive: true, variants: ['primary'], states: STATES, accessibility: 'Native button', specimen_html: '<button>Ok</button>' },
      { name: 'Card', purpose: 'Group', interactive: false, variants: [], states: [], accessibility: 'None', specimen_html: '<div>Card</div>' },
    ],
    patterns: [{ name: 'Form row', purpose: 'Label and input', uses: ['Button'] }],
    paths: {},
  });
}

describe('design system checks', () => {
  it('accepts a valid spec, with the default path', () => {
    const s = valid();
    expect(designSystemProblems(s)).toEqual([]);
    expect(s.paths.system).toBe('src/design-system/');
  });

  it('warns below 12 components and not at 12', () => {
    const s = valid();
    expect(designSystemWarnings(s)).toHaveLength(1);
    s.components = Array.from({ length: 12 }, (_, i) => ({ ...s.components[1]!, name: `C${i}` }));
    expect(designSystemWarnings(s)).toEqual([]);
  });

  it('flags a missing token group', () => {
    const s = valid();
    (s.tokens as Partial<typeof s.tokens>).shadow = {};
    expect(designSystemProblems(s).join('\n')).toContain('"shadow"');
    const s2 = valid();
    delete (s2.tokens.motion as Partial<typeof s2.tokens.motion>).duration;
    expect(designSystemProblems(s2).join('\n')).toContain('"motion.duration"');
  });

  it('flags low contrast in each theme', () => {
    const s = valid();
    s.tokens.color['text-primary'] = tok({ light: '#111111', dark: '#222222' }, 'color');
    const p = designSystemProblems(s);
    expect(p.some((x) => x.includes('dark theme') && x.includes('"text-primary"'))).toBe(true);
    expect(p.some((x) => x.includes('light theme'))).toBe(false);
    s.tokens.color['text-primary'] = tok({ light: '#eeeeee', dark: '#f5f5f5' }, 'color');
    expect(designSystemProblems(s).some((x) => x.includes('light theme'))).toBe(true);
  });

  it('needs a text and a background token to check contrast', () => {
    const s = valid();
    s.tokens.color = { accent: tok({ light: '#0055ff', dark: '#88aaff' }, 'color') };
    expect(designSystemProblems(s).join('\n')).toContain('at least one text token');
  });

  it('flags an interactive component without all states', () => {
    const s = valid();
    s.components[0]!.states = ['default', 'hover'];
    expect(designSystemProblems(s).join('\n')).toContain('lacks the states: focus, pressed, disabled');
  });

  it('flags an empty specimen', () => {
    const s = valid();
    s.components[1]!.specimen_html = '  ';
    expect(designSystemProblems(s).join('\n')).toContain('"Card" has an empty specimen_html');
  });

  it('flags a pattern using an unknown component', () => {
    const s = valid();
    s.patterns[0]!.uses = ['Ghost'];
    expect(designSystemProblems(s).join('\n')).toContain('uses "Ghost"');
  });

  it('flags duplicate component names', () => {
    const s = valid();
    s.components.push({ ...s.components[1]! });
    expect(designSystemProblems(s).join('\n')).toContain('"Card" appears more than once');
  });

  it('flags an empty reduced-motion rule', () => {
    const s = valid();
    s.tokens.motion.reduced = ' ';
    expect(designSystemProblems(s).join('\n')).toContain('"motion.reduced" is empty');
  });

  it('rejects a bad color or component name in the schema', () => {
    const s = valid();
    expect(designSystemSpec.safeParse({ ...s, components: [{ ...s.components[0], name: 'button' }] }).success).toBe(false);
    expect(designSystemSpec.safeParse({ ...s, tokens: { ...s.tokens, color: { x: tok({ light: 'red', dark: '#000000' }, 'color') } } }).success).toBe(false);
  });
});
