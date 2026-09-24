// Conocimiento derivado para los context packs. Hasta S2 no hay grafo: no aporta nodos.

import type { Tx } from '../db/conexion.ts';

export type NodoDeContexto = { ref: string; tipo: string; titulo: string; texto: string; motivo: string };
export type ConocimientoDeContexto = {
  nodos: NodoDeContexto[];
  dependencias: { tipo: string; id: string; version: number | null }[];
};

type Seleccionador = (trx: Tx, proyectoId: string, consulta: string, presupuesto: number) => Promise<ConocimientoDeContexto>;

let seleccionador: Seleccionador = async () => ({ nodos: [], dependencias: [] });

export function registrarSeleccionadorDeConocimiento(s: Seleccionador): void {
  seleccionador = s;
}

export function conocimientoParaContexto(
  trx: Tx,
  proyectoId: string,
  consulta: string,
  presupuesto: number,
): Promise<ConocimientoDeContexto> {
  return seleccionador(trx, proyectoId, consulta, presupuesto);
}
