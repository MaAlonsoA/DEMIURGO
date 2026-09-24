import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/api/dev.ts';
import { hasDevTools, onOpenDevPanel, openDevPanel, sizeOf, summaryOf } from '../../src/screens/dev/snapshots.ts';

const snapshot = (projects: Snapshot['projects']): Snapshot => ({
  name: 'dmg_snap_20260924_225426_after_day_1',
  label: 'after day 1',
  created_at: '2026-09-24T22:54:26.000Z',
  source: 'demiurgo_web_dev',
  migration: '0004',
  projects,
  size_bytes: 9_437_184,
});

describe('dev snapshots panel', () => {
  it('shows only when the session announces the dev tools', () => {
    expect(hasDevTools({ actor: 'human:dev', type: 'person', csrf: 'x', dev_tools: true })).toBe(true);
    expect(hasDevTools({ actor: 'human:dev', type: 'person', csrf: 'x' })).toBe(false);
    expect(hasDevTools(null)).toBe(false);
    expect(hasDevTools(undefined)).toBe(false);
  });

  it('sums up what a snapshot holds', () => {
    expect(summaryOf(snapshot([]))).toBe('No projects');
    expect(summaryOf(snapshot([{ name: 'Demiurgo', events: 11 }]))).toBe('Demiurgo · 11 events');
    expect(summaryOf(snapshot([{ name: 'Demiurgo', events: 1 }]))).toBe('Demiurgo · 1 event');
    expect(
      summaryOf(
        snapshot([
          { name: 'A', events: 3 },
          { name: 'B', events: 4 },
        ]),
      ),
    ).toBe('2 projects · 7 events');
    expect(sizeOf(9_437_184)).toBe('9.4 MB');
    expect(sizeOf(0)).toBe('0.0 MB');
  });

  it('opens from anywhere (the person menu) while the panel is mounted, and not after', () => {
    let opened = 0;
    const stop = onOpenDevPanel(() => {
      opened += 1;
    });
    openDevPanel();
    stop();
    openDevPanel();
    expect(opened).toBe(1);
  });
});
