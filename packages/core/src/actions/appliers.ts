// Efectos de la salida validada de cada acción. Solo se ejecutan con salida válida y dentro
// de la misma transacción que completa la ejecución: o todo o nada, una sola vez.

import type { AccionAgente, SalidaAccion } from '@demiurgo/domain';
import type { Peticion, Resultado } from '../bus/tipos.ts';
import type { Fila } from '../db/esquema.ts';
import type { Tx } from '../db/conexion.ts';

export type EntradaAplicador<A extends AccionAgente> = {
  trx: Tx;
  ejecutar: (p: Peticion) => Promise<Resultado>;
  run: Fila<'ai_runs'>;
  salida: SalidaAccion<A>;
};

type Aplicador<A extends AccionAgente> = (e: EntradaAplicador<A>) => Promise<void>;

export const APLICADORES: { [A in AccionAgente]?: Aplicador<A> } = {
  // eco no tiene efectos: la salida queda en la propia ejecución.
  eco: async () => undefined,
};

export function registrarAplicador<A extends AccionAgente>(accion: A, aplicador: Aplicador<A>): void {
  (APLICADORES as Record<string, unknown>)[accion] = aplicador;
}
