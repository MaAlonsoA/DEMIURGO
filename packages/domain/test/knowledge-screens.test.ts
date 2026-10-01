// H48: screen designs of different features are compared only on a screen both name.

import { describe, expect, it } from 'vitest';
import { type Change, type Graph, type Node, screenIds, selectCandidates } from '../src/knowledge.ts';

const screen = (ref: string, feature: string, screens: string, extra = ''): Node => ({
  ref,
  type: 'screen_design',
  label: `Screen design ${ref}`,
  text: `Flow: the person opens the day and uses the buttons.\nScreens: ${screens}\nStates: Loading: buttons disabled. ${extra}`,
  categories: {},
  epistemic: 'confirmed',
  authority: true,
  origin: { type: 'record_version', id: ref, version: 1 },
  from: 1,
  until: null,
});

const changeOf = (n: Node, feature: string): Change => ({
  main: { ...n },
  companions: [],
  edges: [{ type: 'based_on', from: n.ref, to: `${feature}@1` }],
  supersedes: [],
});

const graphOf = (nodes: Node[], features: Record<string, string>): Graph => ({
  version: 1,
  nodes,
  edges: Object.entries(features).map(([from, to]) => ({ type: 'based_on', from, to: `${to}@1`, validFrom: 1, validTo: null })),
});

describe('screen design candidates (H48)', () => {
  const strength = screen('SCR-WOR-006@1', 'FDR-WOR-002', "Session screen (session): tonal 'Add strength session' buttons. Set sheet (set-sheet): filled Save.");
  const access = screen('SCR-MYA-005@1', 'FDR-MYA-002', 'Sign-in (sign-in): Continue is disabled while loading. Day view (signed-in-day): sign-out.');

  it('reads the screen ids of the Screens section only', () => {
    expect([...screenIds(access.text)]).toEqual(['sign-in', 'signed-in-day']);
    expect(screenIds('no sections here').size).toBe(0);
  });

  it('does not compare screens of different features that share no screen', () => {
    const g = graphOf([strength, access], { 'SCR-WOR-006@1': 'FDR-WOR-002', 'SCR-MYA-005@1': 'FDR-MYA-002' });
    const refs = selectCandidates(g, changeOf(access, 'FDR-MYA-002'), {}).map((c) => c.ref);
    expect(refs).not.toContain('SCR-WOR-006@1');
  });

  it('compares them on a shared screen, such as the day detail', () => {
    const a = screen('SCR-WOR-016@2', 'FDR-WOR-005', "Day's detail (day-detail): lists cardio rows. Cardio entry (cardio-entry): sheet.");
    const b = screen('SCR-WOR-017@1', 'FDR-WOR-006', "Day's detail (day-detail): has a Today tab. Copy editor (copy-editor): form.");
    const g = graphOf([a, b], { 'SCR-WOR-016@2': 'FDR-WOR-005', 'SCR-WOR-017@1': 'FDR-WOR-006' });
    const found = selectCandidates(g, changeOf(a, 'FDR-WOR-005'), {}).find((c) => c.ref === b.ref);
    expect(found?.reason).toContain('day-detail');
  });

  it('compares screens of the same feature whole', () => {
    const a = screen('SCR-X-001@1', 'FDR-X-001', 'One (one): first. ');
    const b = screen('SCR-X-002@1', 'FDR-X-001', 'Two (two): second. ');
    const g = graphOf([a, b], { 'SCR-X-001@1': 'FDR-X-001', 'SCR-X-002@1': 'FDR-X-001' });
    expect(selectCandidates(g, changeOf(a, 'FDR-X-001'), {}).map((c) => c.ref)).toContain(b.ref);
  });
});
