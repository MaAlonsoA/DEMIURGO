import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.ts';

const BASE = { DEMIURGO_DATABASE_URL: 'postgres://demiurgo:x@127.0.0.1:55432/demiurgo_dev' };

describe('configuration', () => {
  it('reads the English variables with their defaults', () => {
    const c = readConfig({ ...BASE, LOCALAPPDATA: '/local' });
    expect(c).toMatchObject({ port: 8100, devTools: false, agentSessionsDir: join('/local', 'Demiurgo', 'agent-sessions') });
  });

  it('AC-AGE-002-03 the old agent variables are an error: the engines are chosen in the web', () => {
    expect(() => readConfig({ ...BASE, DEMIURGO_AGENT: 'claude' })).toThrow(/DEMIURGO_AGENT no longer exist.*Models & providers/);
    expect(() => readConfig({ ...BASE, DEMIURGO_CLASSIFIER: 'reference', DEMIURGO_REVIEWER: 'none' })).toThrow(
      /DEMIURGO_CLASSIFIER, DEMIURGO_REVIEWER/,
    );
  });

  it('keeps the dev tools off unless DEMIURGO_DEV_TOOLS is 1', () => {
    expect(readConfig(BASE).devTools).toBe(false);
    expect(readConfig({ ...BASE, DEMIURGO_DEV_TOOLS: '1' }).devTools).toBe(true);
    expect(() => readConfig({ ...BASE, DEMIURGO_DEV_TOOLS: 'yes' })).toThrow(/DEMIURGO_DEV_TOOLS/);
  });

  it('AC-AGE-002-01 finds the OpenCode config where OpenCode keeps it, unless another is given', () => {
    const home = { ...BASE, USERPROFILE: '/users/ana' };
    expect(readConfig(home).openCodeConfig).toBe(join('/users/ana', '.config', 'opencode', 'opencode.json'));
    expect(readConfig({ ...home, XDG_CONFIG_HOME: '/cfg' }).openCodeConfig).toBe(join('/cfg', 'opencode', 'opencode.json'));
    expect(readConfig({ ...home, DEMIURGO_OPENCODE_CONFIG: '/oc.json' }).openCodeConfig).toBe('/oc.json');
  });

  it('observes over OTLP to the local collector by default, labelled as dev on this port', () => {
    expect(readConfig(BASE).observe).toEqual({
      mode: 'otlp',
      endpoint: 'http://127.0.0.1:4318',
      environment: 'dev',
      serviceVersion: 'unknown',
      instance: '8100',
    });
    expect(
      readConfig({
        ...BASE,
        DEMIURGO_OBSERVE: 'off',
        DEMIURGO_OTLP_ENDPOINT: 'http://collector:4318',
        DEMIURGO_ENVIRONMENT: 'qa',
        DEMIURGO_SERVICE_VERSION: 'abc123',
        DEMIURGO_PORT: '8101',
      }).observe,
    ).toEqual({ mode: 'off', endpoint: 'http://collector:4318', environment: 'qa', serviceVersion: 'abc123', instance: '8101' });
  });

  it('rejects an environment outside real, qa, dev and test, and an observe mode it does not know', () => {
    expect(() => readConfig({ ...BASE, DEMIURGO_ENVIRONMENT: 'prod' })).toThrow(/DEMIURGO_ENVIRONMENT/);
    expect(() => readConfig({ ...BASE, DEMIURGO_OBSERVE: 'memory' })).toThrow(/DEMIURGO_OBSERVE/);
  });

  it('rejects a variable that was renamed instead of silently ignoring it', () => {
    expect(() => readConfig({ ...BASE, DEMIURGO_PUERTO: '8200' })).toThrow(/DEMIURGO_PUERTO → DEMIURGO_PORT/);
  });
});
