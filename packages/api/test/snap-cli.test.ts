// `pnpm snap`: the dev snapshots from the terminal, refused without the flag or while the API is connected.

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { dropSnapshot, listSnapshots, snapshotTarget } from '@demiurgo/core';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { useEphemeralDatabase } from '../../core/test/support/ephemeral-db.ts';

const SCRIPT = fileURLToPath(new URL('../src/snap.ts', import.meta.url));
const base = useEphemeralDatabase();

type Result = { code: number; stdout: string; stderr: string };

async function snap(args: string[], flag = '1'): Promise<Result> {
  const env = { ...process.env, DEMIURGO_DATABASE_URL: base().url, DEMIURGO_DEV_TOOLS: flag };
  try {
    const r = await promisify(execFile)(process.execPath, [SCRIPT, ...args], { env });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const r = e as { code: number; stdout: string; stderr: string };
    return { code: r.code, stdout: r.stdout, stderr: r.stderr };
  }
}

afterAll(async () => {
  const target = snapshotTarget(base().url);
  for (const s of await listSnapshots(target)) await dropSnapshot(target, s.name);
});

describe('pnpm snap', () => {
  it('refuses to run without DEMIURGO_DEV_TOOLS=1', async () => {
    const r = await snap(['list'], '0');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/DEMIURGO_DEV_TOOLS=1/);
  });

  it('saves, lists and restores by label', async () => {
    const saved = await snap(['save', 'cli one']);
    expect(saved.code).toBe(0);
    expect(saved.stdout).toMatch(/Saved dmg_snap_\d{8}_\d{6}_cli_one/);
    expect((await snap(['list'])).stdout).toMatch(/cli one/);
    const restored = await snap(['restore', 'cli one']);
    expect(restored.code).toBe(0);
    expect(restored.stdout).toMatch(/Restored dmg_snap_\d{8}_\d{6}_cli_one/);
  });

  it('refuses while another client is connected, and --force cuts it off', async () => {
    const other = new Client({ connectionString: base().url, application_name: 'the-api' });
    other.on('error', () => undefined);
    await other.connect();
    try {
      const refused = await snap(['save', 'busy']);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toMatch(/in use/);
      expect(refused.stderr).toMatch(/the-api/);
      const forced = await snap(['save', 'busy', '--force']);
      expect(forced.code).toBe(0);
      await expect(other.query('select 1')).rejects.toThrow(/terminat|not queryable/i);
    } finally {
      await other.end().catch(() => undefined);
    }
  });
});
