import { describe, expect, it } from 'vitest';
import { workKind } from '../../src/screens/build/technical.ts';

describe('workKind', () => {
  it('a task with a feature is feature work', () => {
    expect(workKind({ feature: { code: 'FDR-A-001', title: 'A' }, technical: null })).toBe('feature');
  });
  it('a task based on a decision, a quality requirement or the definition is technical work', () => {
    expect(workKind({ feature: null, technical: { code: 'ADR-CI-001', title: 'CI', type: 'adr' } })).toBe('technical');
  });
  it('a task based on nothing is unbased, and an older payload without technical still reads', () => {
    expect(workKind({ feature: null, technical: null })).toBe('unbased');
    expect(workKind({ feature: null })).toBe('unbased');
  });
});
