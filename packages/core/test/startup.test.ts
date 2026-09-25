// Starting the core: what DBOS resumes and the reconcilers restart while the core is still starting
// (pending knowledge updates, idea assessments) already has every service, the classifier included.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.ts';
import { registerReconciler } from '../src/engine/registry.ts';
import { silentLogger } from '../src/services.ts';
import { type Core, startCore } from '../src/startup.ts';
import { useEphemeralDatabase } from './support/ephemeral-db.ts';

const base = useEphemeralDatabase();
let core: Core | undefined;
let duringStartup: string | undefined;

// Runs inside startEngine, like the reconciler that restarts pending knowledge updates.
registerReconciler(async (s) => {
  try {
    duringStartup = (await s.classifierFor(randomUUID())).id;
  } catch (e) {
    duringStartup = String(e);
  }
});

beforeAll(async () => {
  core = await startCore(
    readConfig({ DEMIURGO_DATABASE_URL: base().url, DEMIURGO_OPENCODE_CONFIG: 'missing-opencode.json', DEMIURGO_OBSERVE: 'off' }),
    silentLogger,
  );
});

afterAll(async () => {
  await core?.stop();
});

describe('core startup', () => {
  it('a reconciler that classifies while the core starts gets the classifier, not "the core has not started"', () => {
    // No engine assigned: the classifier exists and says so when it runs.
    expect(duringStartup).toBe('unassigned');
  });
});
