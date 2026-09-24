// Registro de manejadores por comando. Cada módulo de comandos se registra al importarse.

import type { NombreComando } from '@demiurgo/domain';
import type { Manejador } from './tipos.ts';

export const MANEJADORES: Partial<Record<NombreComando, Manejador>> = {};

export function registrarManejadores(manejadores: { [C in NombreComando]?: Manejador<never> }): void {
  for (const [comando, m] of Object.entries(manejadores)) {
    const c = comando as NombreComando;
    if (MANEJADORES[c]) throw new Error(`El comando «${c}» ya tiene manejador.`);
    MANEJADORES[c] = m as unknown as Manejador;
  }
}

/** Ayuda de tipos: infiere D desde el esquema. */
export function manejador<D>(m: Manejador<D>): Manejador<never> {
  return m as unknown as Manejador<never>;
}
