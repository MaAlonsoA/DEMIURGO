import { describe, expect, it } from 'vitest';
import { detectLanguage, looksEnglish, replyLanguage } from '../src/text.ts';

describe('record language', () => {
  it('recognizes Spanish and English prose', () => {
    expect(detectLanguage('La persona puede revocar en cualquier momento el token de un agente externo.')).toBe('es');
    expect(detectLanguage('¿Quién usará el producto primero y qué necesita hacer?')).toBe('es');
    expect(detectLanguage('The person can revoke the token of an external agent at any time.')).toBe('en');
    expect(detectLanguage('Who will use the product first, and what do they need to do?')).toBe('en');
  });

  it('returns null for texts too short or too technical to tell', () => {
    expect(detectLanguage('OAuth')).toBeNull();
    expect(detectLanguage('POST /api/runs 409')).toBeNull();
    expect(detectLanguage('')).toBeNull();
  });

  it('only flags texts that are clearly not in English', () => {
    expect(looksEnglish('Revocar tokens de agente desde el panel de la persona')).toBe(false);
    expect(looksEnglish('Revoke agent tokens from the person panel')).toBe(true);
    expect(looksEnglish('Kysely')).toBe(true);
  });
});

describe('reply language', () => {
  const en = "Bug found using the app: picking the product 'Yogur griego ligero' prefills protein 5.80000019073486, so saving fails and the person must retype the values.";
  it('follows the latest own text of the person, not the names of records or product data', () => {
    expect(replyLanguage([{ author: 'human:admin', text: en }])).toBe('en');
  });
  it('ignores agent messages and skips human messages that do not tell', () => {
    expect(
      replyLanguage([
        { author: 'human:admin', text: 'La persona puede revocar en cualquier momento el token de un agente.' },
        { author: 'agent:run:1', text: 'The person can revoke the token of an agent at any time.' },
        { author: 'human:admin', text: 'ok' },
      ]),
    ).toBe('es');
  });
  it('is null when the person has not written', () => {
    expect(replyLanguage([{ author: 'agent:run:1', text: 'Hola, ¿qué quieres diseñar?' }])).toBeNull();
  });
});
