import { describe, expect, it } from 'vitest';
import { canonicalPrettyJson, type DesignManifest, designGuard } from '../src/design-guard.ts';
import { sha256Hex } from '../src/observe.ts';

const tokens = { color: { bg: { $value: { light: '#ffffff', dark: '#000000' }, $type: 'color' } }, space: { 1: { $value: '4px', $type: 'dimension' } } };
const manifest = (over: Partial<DesignManifest> = {}): DesignManifest => ({
  version: 'DSY-001@1',
  paths: { system: 'src/design-system/' },
  components: [
    { name: 'Button', variants: ['primary'], states: ['default'] },
    { name: 'SidePanel', variants: [], states: ['default'] },
  ],
  tokens_hash: sha256Hex(canonicalPrettyJson(tokens)),
  base: { kind: 'scratch' },
  ...over,
});
const system = [
  { path: 'src/design-system/Button.tsx', content: 'export const Button = () => <button style={{ color: "#fff" }} />;' },
  { path: 'src/design-system/SidePanel.tsx', content: 'export const SidePanel = () => <dialog />;' },
];
const run = (files: { path: string; content: string }[], m = manifest()) => designGuard([...system, ...files], m, tokens);
const rules = (r: ReturnType<typeof run>) => r.violations.map((v) => v.rule);

describe('designGuard', () => {
  it('passes a project that only uses tokens and the system components', () => {
    const r = run([
      { path: 'src/App.tsx', content: "import { Button } from './design-system/Button';\nexport const App = () => <Button />;\n" },
      { path: 'src/app.css', content: '.a { color: var(--color-bg); transition: opacity var(--duration-fast) var(--easing-standard); border-radius: 0; box-shadow: none; font-size: inherit; }\n#main { margin: 0 }\n' },
    ]);
    expect(r).toEqual({ ok: true, violations: [] });
  });

  it('rule 1: raw colors, durations, easings, font sizes, radii and shadows are violations, with their line', () => {
    const css = [
      '.a { color: #ff0000; }',
      '.b { background: rgba(0, 0, 0, .5); }',
      '.c { transition: opacity 200ms ease; }',
      '.d { animation: spin 1.5s cubic-bezier(.2,0,.4,1); }',
      '.e { font-size: 14px; border-radius: 8px; box-shadow: 0 1px 2px #0003; }',
    ].join('\n');
    const r = run([{ path: 'src/app.css', content: css }]);
    const msgs = r.violations.filter((v) => v.rule === 1).map((v) => `${v.line}:${v.message}`);
    expect(r.ok).toBe(false);
    expect(msgs.some((m) => m.startsWith('1:') && m.includes('#ff0000'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('2:') && m.includes('rgba('))).toBe(true);
    expect(msgs.some((m) => m.startsWith('3:') && m.includes('200ms'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('4:') && m.includes('cubic-bezier'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('4:') && m.includes('1.5s'))).toBe(true);
    expect(msgs.filter((m) => m.startsWith('5:'))).toHaveLength(4);
  });

  it('rule 1: JSX style objects are checked and ids, hrefs, var() and theme classes are not', () => {
    const tsx = [
      'export const X = () => (',
      '  <div className="bg-surface" style={{ fontSize: 14, borderRadius: "6px", color: "var(--c)" }}>',
      '    <a href="#add">skip</a>',
      '  </div>',
      ');',
    ].join('\n');
    const r = run([{ path: 'src/X.tsx', content: tsx }]);
    expect(r.violations.map((v) => v.line)).toEqual([2, 2]);
    expect(rules(r)).toEqual([1, 1]);
  });

  it('rule 1 does not apply inside paths.system, tests, design/ or node_modules', () => {
    const r = run([
      { path: 'src/x.test.tsx', content: '<button style="color:#fff" />' },
      { path: 'design/tasks/x.md', content: 'color: #fff' },
      { path: 'node_modules/lib/a.css', content: 'a { color: #fff }' },
    ]);
    expect(r.ok).toBe(true);
  });

  it('rule 2: raw elements outside the system are violations, components named like them are not', () => {
    const r = run([{ path: 'src/Form.tsx', content: 'export const F = () => (<form><input type="text" /><Button /><button>ok</button><textarea /></form>);' }]);
    expect(r.violations.map((v) => v.message.slice(0, 11))).toEqual(['Raw <input>', 'Raw <button', 'Raw <textar']);
    expect(rules(run([{ path: 'index.html', content: '<select></select>' }]))).toEqual([2]);
  });

  it('rule 2: foreign UI libraries are violations unless the manifest names one as the base', () => {
    const files = [{ path: 'src/A.tsx', content: "import { Button } from '@mui/material';\nimport x from 'antd/es/button';\nimport { useState } from 'react';\n" }];
    expect(rules(run(files))).toEqual([2, 2]);
    expect(rules(run(files, manifest({ base: { kind: 'public', name: 'Material UI' } })))).toEqual([2]);
  });

  it('rule 3: a component in the system that is not in the manifest is a violation with the fixed message', () => {
    const r = run([{ path: 'src/design-system/DetailsPanel.tsx', content: 'export const DetailsPanel = () => null;' }]);
    expect(r.violations).toEqual([
      { rule: 3, path: 'src/design-system/DetailsPanel.tsx', line: 1, message: 'DetailsPanel is not in the approved design system: propose adding it in DEMIURGO' },
    ]);
  });

  it('rule 3: an approved component with no file yet is fine; index, tests and stories are ignored', () => {
    const r = designGuard(
      [
        { path: 'src/design-system/Button.tsx', content: '' },
        { path: 'src/design-system/index.ts', content: '' },
        { path: 'src/design-system/Button.test.tsx', content: '<button />' },
        { path: 'src/design-system/Button.stories.tsx', content: '' },
      ],
      manifest(),
      tokens,
    );
    expect(r.ok).toBe(true);
  });

  it('rule 4: a tokens.json in the system with another hash is a violation; the same tokens re-formatted pass', () => {
    const changed = { ...tokens, space: { 1: { $value: '8px', $type: 'dimension' } } };
    const bad = run([{ path: 'src/design-system/tokens.json', content: JSON.stringify(changed) }]);
    expect(rules(bad)).toEqual([4]);
    const same = run([{ path: 'src/design-system/tokens.json', content: JSON.stringify(tokens) }]);
    expect(same.ok).toBe(true);
    expect(designGuard(system, manifest(), changed).violations.map((v) => v.rule)).toEqual([4]);
  });

  it('fixture, two side panels: one in the system and another built in the app code are caught by rules 1, 2 and 3', () => {
    // The second panel in app code, with raw elements and values (rules 1 and 2).
    const inApp = run([
      { path: 'src/components/Drawer.tsx', content: 'export const Drawer = () => <dialog style={{ boxShadow: "0 2px 8px #0004" }}><button>x</button></dialog>;' },
    ]);
    expect(inApp.ok).toBe(false);
    expect(new Set(rules(inApp))).toEqual(new Set([1, 2]));
    // The second panel inside the system without the manifest listing it (rule 3).
    const inSystem = run([{ path: 'src/design-system/Drawer.tsx', content: 'export const Drawer = () => <div />;' }]);
    expect(inSystem.violations).toEqual([
      { rule: 3, path: 'src/design-system/Drawer.tsx', line: 1, message: 'Drawer is not in the approved design system: propose adding it in DEMIURGO' },
    ]);
  });
});
