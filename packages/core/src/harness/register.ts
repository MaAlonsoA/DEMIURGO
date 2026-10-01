// Level-triggered safety net for the post-mortems (Kubernetes documentation, «Controllers»: a control loop keeps
// re-reading the state): every 60 s (our convention, as the build queue's) it computes the pending ones. A post-mortem
// lost to a restart is recovered, and a new rules version recomputes everything, without touching the build workflow.

import { registerReconciler } from '../engine/registry.ts';
import { computePendingPostmortems } from './postmortem.ts';

export const POSTMORTEM_RECONCILE_MS = 60_000;

registerReconciler(async (s) => {
  let ticking = false;
  // unref: a short-lived process (the CLI) must not wait for the interval to exit. No overlap: a slow tick skips the next.
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    void computePendingPostmortems(s)
      .catch(() => undefined)
      .finally(() => {
        ticking = false;
      });
  }, POSTMORTEM_RECONCILE_MS).unref();
}, 'harness-postmortem-reconcile');
