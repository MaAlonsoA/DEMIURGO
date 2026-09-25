// Registry of workflows and reconcilers that other modules contribute to the engine. It is a
// leaf module (no dependency on the bus or the engine) so that registering on import doesn't
// depend on module evaluation order.

import type { Services } from '../services.ts';

export type WorkflowStarter = (id: string, projectId: string) => Promise<void>;
export type Reconciler = (s: Services) => Promise<void>;

export const starters: { update: WorkflowStarter; assessment: WorkflowStarter } = {
  update: async () => undefined,
  assessment: async () => undefined,
};

/** Each reconciler with its name: the system interaction that wraps it at startup is named after it. */
export const reconcilers: { name: string; run: Reconciler }[] = [];

export function registerUpdateStarter(f: WorkflowStarter): void {
  starters.update = f;
}

export function registerAssessmentStarter(f: WorkflowStarter): void {
  starters.assessment = f;
}

export function registerReconciler(c: Reconciler, name = 'reconciler'): void {
  reconcilers.push({ name, run: c });
}

// Services of the running engine, for the workflows registered by other modules.
let current: Services | null = null;

export function setEngineServices(s: Services | null): void {
  current = s;
}

export function engineServices(): Services {
  if (!current) throw new Error('The engine has not started.');
  return current;
}
