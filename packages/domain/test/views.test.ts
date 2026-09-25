import { describe, expect, it } from 'vitest';
import { areaOrder, behaviorSteps, criterionPath, relationOf } from '../src/views.ts';

describe('journey steps from Behavior', () => {
  it('AC-INT-002-05 the numbered points are the steps, in order, with their nested bullets as detail', () => {
    const behavior = [
      '1. **Sesión.**',
      '   - Sin sesión, cualquier ruta lleva a «Sign in».',
      '   - «Sign out» cierra la sesión.',
      '2. La persona abre una exploración con su intención.',
      '',
      '3. **Readiness.** Aparece solo sin motivos.',
    ].join('\n');
    expect(behaviorSteps(behavior)).toEqual([
      { n: 1, title: 'Sesión.', detail: ['Sin sesión, cualquier ruta lleva a «Sign in».', '«Sign out» cierra la sesión.'] },
      { n: 2, title: 'La persona abre una exploración con su intención.', detail: [] },
      { n: 3, title: 'Readiness.', detail: ['Aparece solo sin motivos.'] },
    ]);
  });

  it('AC-INT-002-05 a behavior without numbered points is one step per paragraph or bullet', () => {
    expect(behaviorSteps('La persona entra.\n\nVe su producto.')).toEqual([
      { n: 1, title: 'La persona entra.', detail: [] },
      { n: 2, title: 'Ve su producto.', detail: [] },
    ]);
    expect(behaviorSteps('- Primero esto.\n- Después aquello.')).toEqual([
      { n: 1, title: 'Primero esto.', detail: [] },
      { n: 2, title: 'Después aquello.', detail: [] },
    ]);
    expect(behaviorSteps('   ')).toEqual([]);
  });
});

describe('journey paths from criteria', () => {
  it('AC-INT-002-05 a Spanish criterion becomes «If … then …»', () => {
    expect(
      criterionPath(
        'Dada una ruta interna sin sesión, cuando la persona la abre, entonces ve «Sign in»; al entrar vuelve a esa ruta.',
      ),
    ).toEqual({
      given: 'una ruta interna sin sesión',
      when: 'la persona la abre',
      outcome: 've «Sign in»; al entrar vuelve a esa ruta.',
    });
  });

  it('AC-INT-002-05 an English criterion too, and one without that shape keeps its text as the outcome', () => {
    expect(criterionPath('Given an empty project, when the person completes the walk, then they see the result saved.')).toEqual({
      given: 'an empty project',
      when: 'the person completes the walk',
      outcome: 'they see the result saved.',
    });
    expect(
      criterionPath('Dado este ADR en estado propuesto, cuando la persona lo revisa, entonces lo acepta con el merge.'),
    ).toMatchObject({
      given: 'este ADR en estado propuesto',
    });
    expect(criterionPath('The page loads in under a second.')).toEqual({
      given: null,
      when: null,
      outcome: 'The page loads in under a second.',
    });
  });
});

describe('map relations from links', () => {
  it('AC-INT-002-02 each link type becomes the relation the map draws, and nothing else', () => {
    expect(relationOf('based_on', 'fdr', 'fdr')).toBe('needs');
    expect(relationOf('design_of', 'fdr', 'fdr')).toBe('needs');
    expect(relationOf('based_on', 'fdr', 'decision')).toBe('follows');
    expect(relationOf('based_on', 'adr', 'adr')).toBe('follows');
    expect(relationOf('design_of', 'fdr', 'decision')).toBe('follows');
    expect(relationOf('conflicts_with', 'fdr', 'decision')).toBe('conflicts');
    expect(relationOf('derived_from', 'fdr', 'fdr')).toBe('affects');
    expect(relationOf('covers', 'fdr', 'fdr')).toBeNull();
    expect(relationOf('origin', 'fdr', 'decision')).toBeNull();
  });
});

const r = (domain: string, type: string) => ({ domain, type });

describe('areas of the map', () => {
  it('AC-INT-002-01 from the most features to the fewest; on a tie, the most rules; then by name', () => {
    const records = [
      ...Array.from({ length: 11 }, () => r('rules-only', 'decision')),
      r('one-feature', 'fdr'),
      r('two-features', 'fdr'),
      r('two-features', 'fdr'),
      r('b-tie', 'fdr'),
      r('b-tie', 'adr'),
      r('a-tie', 'fdr'),
      r('a-tie', 'adr'),
    ];
    expect(areaOrder(records)).toEqual(['two-features', 'a-tie', 'b-tie', 'one-feature', 'rules-only']);
  });
});
