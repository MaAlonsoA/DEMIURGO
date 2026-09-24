import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.ts';

const BASE = { DEMIURGO_DATABASE_URL: 'postgres://demiurgo:x@127.0.0.1:55432/demiurgo_dev' };

describe('configuration', () => {
  it('reads the English variables with their defaults', () => {
    const c = readConfig({ ...BASE, DEMIURGO_AGENT: 'claude', DEMIURGO_CLASSIFIER: 'reference' });
    expect(c).toMatchObject({ agent: 'claude', classifier: 'reference', reviewer: 'none', port: 8100 });
  });

  it('rejects a variable that was renamed instead of silently ignoring it', () => {
    expect(() => readConfig({ ...BASE, DEMIURGO_AGENTE: 'claude' })).toThrow(/DEMIURGO_AGENTE → DEMIURGO_AGENT/);
    expect(() => readConfig({ ...BASE, DEMIURGO_PUERTO: '8200' })).toThrow(/DEMIURGO_PUERTO → DEMIURGO_PORT/);
  });
});
