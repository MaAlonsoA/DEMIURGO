// Level-triggered safety net for the post-mortems (Kubernetes documentation, «Controllers»: a control loop keeps
// re-reading the state): every 60 s (our convention, as the build queue's) it computes the pending ones. A post-mortem
// lost to a restart is recovered, and a new rules version recomputes everything, without touching the build workflow.

import { registerReconciler } from '../engine/registry.ts';
import { runDueChecks } from './check.ts';
import { detectEscapes } from './escapes.ts';
import { computePendingPostmortems } from './postmortem.ts';

export const POSTMORTEM_RECONCILE_MS = 60_000;
/** Escapes (salud-del-harness §4) are recomputed per project at most hourly (our convention): they read the whole project. */
export const CHECK_RECONCILE_MS = 60_000;
export const ESCAPES_RECONCILE_MS = 3_600_000;

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

registerReconciler(async (s) => {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void s.db
      .selectFrom('projects')
      .select('id')
      .execute()
      .then(async (projects) => {
        for (const p of projects) await detectEscapes(s.db, p.id).catch(() => undefined);
      })
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  // unref: a short-lived process (the CLI) must not wait for the interval to exit. The first run waits one minute so a
  // restart does not pile it on top of start-up work.
  setTimeout(tick, 60_000).unref();
  setInterval(tick, ESCAPES_RECONCILE_MS).unref();
}, 'harness-escapes-reconcile');

// The periodic check (salud-del-harness §8): the same 60 s loop asks every project whether a check is due (24 hours or 5
// merged tasks since the last one) and runs it, serialized per project with the post-mortems.
registerReconciler(async (s) => {
  let ticking = false;
  // unref: a short-lived process (the CLI) must not wait for the interval to exit. No overlap: a slow tick skips the next.
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    void runDueChecks(s)
      .catch(() => undefined)
      .finally(() => {
        ticking = false;
      });
  }, CHECK_RECONCILE_MS).unref();
}, 'harness-check-reconcile');
