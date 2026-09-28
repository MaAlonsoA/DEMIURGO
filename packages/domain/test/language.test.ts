import { describe, expect, it } from 'vitest';
import { detectLanguage, looksEnglish } from '../src/text.ts';

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
