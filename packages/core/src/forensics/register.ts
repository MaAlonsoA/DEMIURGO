// Level-triggered sweep of the automatic task forensics (forensics/auto.ts): every 60 s, like the harness post-mortems.

import { registerReconciler } from '../engine/registry.ts';
import { FORENSICS_SWEEP_MS, sweepForensics } from './auto.ts';

let enabled = false;

/**
 * Turns the sweep on for this process. Only the API server calls it (api/src/main.ts): the CLI and the tests start the
 * same engine and must not spend quota nor start analyses on their own (the tests call `sweepForensics` directly).
 */
export function enableAutoForensics(): void {
  enabled = true;
}

registerReconciler(async (s) => {
  if (!enabled) return;
  let ticking = false;
  // unref: a short-lived process (the CLI) must not wait for the interval to exit. No overlap: a slow tick skips the next.
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    void sweepForensics(s)
      .catch((e: unknown) => s.logger.error('The forensics sweep failed', { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        ticking = false;
      });
  }, FORENSICS_SWEEP_MS).unref();
}, 'forensics-sweep');
