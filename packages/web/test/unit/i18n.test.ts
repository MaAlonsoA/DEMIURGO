import { describe, expect, it } from 'vitest';
import { messages } from '../../src/i18n/define.ts';
import { browserLocale, isLocale } from '../../src/i18n/locale.ts';
import { withTranslation } from '../../src/i18n/reading.tsx';

describe('reading translations in the web', () => {
  it('puts each translated text at its path and leaves codes and the original alone', () => {
    const payload = {
      type: 'design_record',
      title: 'Revoke agent tokens',
      sections: [{ title: 'Goal', content: 'The person can revoke a token.' }],
      criteria: [{ title: 'Revocation', verification: 'automatic' }],
    };
    const shown = withTranslation(payload, {
      title: 'Revocar tokens de agente',
      'sections.0.content': 'La persona puede revocar un token.',
      'criteria.0.title': 'Revocación',
      'missing.0.path': 'nada',
    });
    expect(shown).toEqual({
      type: 'design_record',
      title: 'Revocar tokens de agente',
      sections: [{ title: 'Goal', content: 'La persona puede revocar un token.' }],
      criteria: [{ title: 'Revocación', verification: 'automatic' }],
    });
    expect(payload.title).toBe('Revoke agent tokens');
    expect(withTranslation(payload, null)).toBe(payload);
  });
});

describe('interface languages', () => {
  it('knows English and Spanish; the browser decides between them, English by default', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(['en', 'es']).toContain(browserLocale());
  });

  it('a catalog keeps the same keys in both languages', () => {
    const c = messages({ hi: 'Hello', n: (n: number) => `${n} items` }, { hi: 'Hola', n: (n: number) => `${n} elementos` });
    expect(c.es.hi).toBe('Hola');
    expect(c.en.n(2)).toBe('2 items');
    expect(Object.keys(c.es)).toEqual(Object.keys(c.en));
  });
});
