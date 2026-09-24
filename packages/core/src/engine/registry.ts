// Registro de flujos y conciliaciones que aportan otros módulos al motor. Es un módulo hoja
// (sin dependencias del bus ni del motor) para que registrar al importar no dependa del orden
// de evaluación de los módulos.

import type { Servicios } from '../servicios.ts';

export type ArrancadorFlujo = (id: string, proyectoId: string) => Promise<void>;
export type Conciliador = (s: Servicios) => Promise<void>;

export const arrancadores: { actualizacion: ArrancadorFlujo; evaluacion: ArrancadorFlujo } = {
  actualizacion: async () => undefined,
  evaluacion: async () => undefined,
};

export const conciliadores: Conciliador[] = [];

export function registrarArranqueActualizacion(f: ArrancadorFlujo): void {
  arrancadores.actualizacion = f;
}

export function registrarArranqueEvaluacion(f: ArrancadorFlujo): void {
  arrancadores.evaluacion = f;
}

export function registrarConciliador(c: Conciliador): void {
  conciliadores.push(c);
}

// Servicios del motor en marcha, para los flujos registrados por otros módulos.
let actuales: Servicios | null = null;

export function fijarServiciosDelMotor(s: Servicios | null): void {
  actuales = s;
}

export function serviciosDelMotor(): Servicios {
  if (!actuales) throw new Error('El motor no está iniciado.');
  return actuales;
}
