import { describe, expect, it } from 'vitest';
import { type ScreenDesignSpec, missingComponents, missingComponentsReason, screenDesignProblems } from '../src/screen-design.ts';

const html = (t: string) => `<main style="color: var(--text-primary)">${t}</main>`;
const screen = (id: string, steps: number[], components: string[] = ['Button']) => ({
  id,
  name: id,
  purpose: 'Purpose',
  steps,
  components,
  states: { empty: html('empty'), loading: html('loading'), error: html('error'), data: html('data') },
});
const spec = (over: Partial<ScreenDesignSpec> = {}): ScreenDesignSpec => ({
  feature: { code: 'FDR-REC-001', version: 1 },
  no_ui: null,
  screens: [screen('list', [1, 2]), screen('detail', [3])],
  flow: [{ from: 'list', to: 'detail', trigger: 'Open a recipe', step: 3 }],
  ...over,
});

describe('screenDesignProblems', () => {
  it('accepts screens that serve every step', () => {
    expect(screenDesignProblems(spec(), 3)).toEqual([]);
  });
  it('names the steps no screen serves', () => {
    expect(screenDesignProblems(spec(), 4).join(' ')).toMatch(/step 4 is not served/);
  });
  it('a feature with no interface says so and has no screens', () => {
    expect(screenDesignProblems(spec({ no_ui: { reason: 'It is a batch job.' }, screens: [], flow: [] }), 3)).toEqual([]);
    expect(screenDesignProblems(spec({ no_ui: { reason: 'x' } }), 3).join(' ')).toMatch(/exclusive/);
  });
  it('rejects scripts, external URLs and empty states', () => {
    const bad = spec();
    bad.screens[0]!.states.data = '<script>alert(1)</script>';
    bad.screens[0]!.states.error = '<img src="https://example.com/a.png">';
    bad.screens[0]!.states.empty = ' ';
    const text = screenDesignProblems(bad, 3).join(' | ');
    expect(text).toMatch(/no <script>/);
    expect(text).toMatch(/no external URL/);
    expect(text).toMatch(/no empty state/);
  });
  it('ids are unique and the flow only goes through known ids', () => {
    const bad = spec({ screens: [screen('a', [1, 2, 3]), screen('a', [1])], flow: [{ from: 'a', to: 'zzz', trigger: 't', step: null }] });
    const text = screenDesignProblems(bad, 3).join(' | ');
    expect(text).toMatch(/"a" is repeated/);
    expect(text).toMatch(/"zzz"/);
  });
  it('without the feature steps known it skips only their coverage', () => {
    expect(screenDesignProblems(spec(), null)).toEqual([]);
  });
});

describe('missingComponents', () => {
  it('lists once each the components the design system lacks', () => {
    const s = spec({ screens: [screen('a', [1], ['Button', 'Card']), screen('b', [2, 3], ['Card', 'Table'])] });
    expect(missingComponents(s, ['Button'])).toEqual(['Card', 'Table']);
    expect(missingComponents(s, ['Button', 'Card', 'Table'])).toEqual([]);
    expect(missingComponentsReason(['Card', 'Table'])).toBe('Add Card, Table to the design system first.');
    expect(missingComponentsReason([])).toBeNull();
  });
});
