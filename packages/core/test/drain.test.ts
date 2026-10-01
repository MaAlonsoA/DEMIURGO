// Drain mode: the flag file, the queue that starts nothing while it is up, and `drain off` that resumes as before.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { human } from '@demiurgo/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { advanceBuildQueue, autoStatus, queueAutoOn } from '../src/build/auto.ts';
import { queueDecisionRows } from '../src/build/queue-decisions.ts';
import { buildQueue } from '../src/build/queue.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { clearDrain, drainFile, isDraining, readDrain, setDrain } from '../src/drain.ts';
import { useEnvironment } from './support/env.ts';

const dir = mkdtempSync(join(tmpdir(), 'dmg-drain-'));
const saved = process.env.DEMIURGO_DRAIN_FILE;
afterEach(() => {
  if (saved === undefined) delete process.env.DEMIURGO_DRAIN_FILE;
  else process.env.DEMIURGO_DRAIN_FILE = saved;
});

describe('the drain flag file', () => {
  it('is off without the file, on with it, and keeps the reason and the time', () => {
    const file = join(dir, 'flag-1');
    expect(readDrain(file)).toEqual({ draining: false, reason: null, since: null });
    const set = setDrain('restart', file, new Date('2026-10-01T10:00:00Z'));
    expect(set).toEqual({ draining: true, reason: 'restart', since: '2026-10-01T10:00:00.000Z' });
    expect(readDrain(file)).toEqual(set);
    clearDrain(file);
    expect(isDraining(file)).toBe(false);
    clearDrain(file); // idempotent
  });

  it('an odd file still drains (the safe side)', () => {
    const file = join(dir, 'flag-2');
    writeFileSync(file, 'not json');
    expect(readDrain(file)).toEqual({ draining: true, reason: null, since: null });
  });

  it('DEMIURGO_DRAIN_FILE overrides the default path, which is the repository root', () => {
    expect(drainFile()).toMatch(/\.demiurgo-drain$/);
    process.env.DEMIURGO_DRAIN_FILE = join(dir, 'flag-3');
    expect(drainFile()).toBe(join(dir, 'flag-3'));
  });
});

describe('advanceBuildQueue while draining', () => {
  const environment = useEnvironment({});

  it('starts nothing and records one `draining` plan, leaves the settings alone, and `drain off` resumes', async () => {
    process.env.DEMIURGO_DRAIN_FILE = join(dir, 'flag-4');
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: human('ana'), data: { name: 'Drain' } });
    await s.db.insertInto('build_queue_settings').values({ project_id: projectId, auto: true, set_by: 'human:ana' }).execute();

    setDrain('test');
    expect(await advanceBuildQueue(s, projectId, 'tick')).toEqual([]);
    expect(await advanceBuildQueue(s, projectId, 'tick')).toEqual([]);
    const rows = await queueDecisionRows(s.db, projectId);
    expect(rows.filter((r) => r.stopped_kind === 'draining')).toHaveLength(1);
    expect(await queueAutoOn(s.db, projectId)).toBe(true);
    expect(await autoStatus(s.db, projectId, await buildQueue(s.db, projectId))).toMatchObject({ on: true, draining: true });

    clearDrain();
    expect(await advanceBuildQueue(s, projectId, 'tick')).toEqual([]); // nothing ready, but it plans again
    expect(await queueAutoOn(s.db, projectId)).toBe(true);
    const status = await autoStatus(s.db, projectId, await buildQueue(s.db, projectId));
    expect(status.draining).toBeUndefined();
    expect(status.on).toBe(true);
  });
});
