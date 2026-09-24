// Registro de flujos y conciliaciones que aportan otros módulos al motor. Es un módulo hoja
// (sin dependencias del bus ni del motor) para que registrar al importar no dependa del orden
// de evaluación de los módulos.

import type { Services } from '../services.ts';

export type WorkflowStarter = (id: string, projectId: string) => Promise<void>;
export type Reconciler = (s: Services) => Promise<void>;

export const starters: { update: WorkflowStarter; assessment: WorkflowStarter } = {
  update: async () => undefined,
  assessment: async () => undefined,
};

export const reconcilers: Reconciler[] = [];

export function registerUpdateStarter(f: WorkflowStarter): void {
  starters.update = f;
}

export function registerAssessmentStarter(f: WorkflowStarter): void {
  starters.assessment = f;
}

export function registerReconciler(c: Reconciler): void {
  reconcilers.push(c);
}

// Servicios del motor en marcha, para los flujos registrados por otros módulos.
let current: Services | null = null;

export function setEngineServices(s: Services | null): void {
  current = s;
}

export function engineServices(): Services {
  if (!current) throw new Error('El motor no está iniciado.');
  return current;
}
