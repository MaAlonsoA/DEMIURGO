// Reacciones a los eventos de autoridad (aprobar una versión, aceptar una propuesta, aprobar
// la taxonomía). S2 registra aquí el encolado de «Actualizar conocimiento» (§7.3).

import type { ContextoComando } from '../bus/tipos.ts';

export type ObjetoDeAutoridad = { tipo: string; id: string; version: number | null };
export type Reaccion = (ctx: ContextoComando, objeto: ObjetoDeAutoridad) => Promise<void>;

const REACCIONES: Reaccion[] = [];

export function registrarReaccionDeAutoridad(r: Reaccion): void {
  REACCIONES.push(r);
}

/** Se llama dentro de la transacción del comando decisivo, después de aplicar su efecto. */
export async function alEventoDeAutoridad(ctx: ContextoComando, objeto: ObjetoDeAutoridad): Promise<void> {
  for (const r of REACCIONES) await r(ctx, objeto);
}
