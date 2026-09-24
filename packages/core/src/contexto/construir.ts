// Constructores de context packs por acción. Recopilan de la autoridad lo que declara cada
// constructor y devuelven un pack determinista: mismo alcance y mismo grafo → mismo hash.

import { type AccionAgente, ErrorDominio } from '@demiurgo/domain';
import type { Tx } from '../db/conexion.ts';
import type { DatosPack } from '../comandos/packs.ts';

export type Alcance = { tipo: string; id?: string | undefined; version?: number | undefined };

export type Recopilador = (a: {
  trx: Tx;
  proyectoId: string;
  alcance: Alcance;
  entrada: Record<string, unknown>;
  versionGrafo: number;
}) => Promise<DatosPack>;

export const CONSTRUCTORES: Partial<Record<AccionAgente, Recopilador>> = {
  async eco({ entrada, versionGrafo }) {
    return {
      rol: 'eco',
      constructor: 'eco@1',
      presupuesto: { caracteres: 2000 },
      version_grafo: versionGrafo,
      dependencias: [],
      contenido: { entrada: { texto: typeof entrada.texto === 'string' ? entrada.texto.slice(0, 2000) : '' } },
    };
  },
};

export function registrarConstructor(accion: AccionAgente, r: Recopilador): void {
  CONSTRUCTORES[accion] = r;
}

export async function construirContexto(
  trx: Tx,
  proyectoId: string,
  accion: AccionAgente,
  alcance: Alcance,
  entrada: Record<string, unknown>,
  versionGrafo: number,
): Promise<DatosPack> {
  const r = CONSTRUCTORES[accion];
  if (!r) throw new ErrorDominio('no_implementado', `No hay constructor de contexto para «${accion}».`);
  return r({ trx, proyectoId, alcance, entrada, versionGrafo });
}
