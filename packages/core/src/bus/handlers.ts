// Registro de manejadores por comando. Cada módulo de comandos se registra al importarse.

import type { CommandName } from '@demiurgo/domain';
import type { Handler } from './types.ts';

export const HANDLERS: Partial<Record<CommandName, Handler>> = {};

export function registerHandlers(handlers: { [C in CommandName]?: Handler<never> }): void {
  for (const [command, m] of Object.entries(handlers)) {
    const c = command as CommandName;
    if (HANDLERS[c]) throw new Error(`El comando «${c}» ya tiene manejador.`);
    HANDLERS[c] = m as unknown as Handler;
  }
}

/** Ayuda de tipos: infiere D desde el esquema. */
export function handler<D>(m: Handler<D>): Handler<never> {
  return m as unknown as Handler<never>;
}
