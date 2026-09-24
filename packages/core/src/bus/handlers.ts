// Handler registry by command. Each command module registers itself when imported.

import type { CommandName } from '@demiurgo/domain';
import type { Handler } from './types.ts';

export const HANDLERS: Partial<Record<CommandName, Handler>> = {};

export function registerHandlers(handlers: { [C in CommandName]?: Handler<never> }): void {
  for (const [command, m] of Object.entries(handlers)) {
    const c = command as CommandName;
    if (HANDLERS[c]) throw new Error(`The "${c}" command already has a handler.`);
    HANDLERS[c] = m as unknown as Handler;
  }
}

/** Type helper: infers D from the schema. */
export function handler<D>(m: Handler<D>): Handler<never> {
  return m as unknown as Handler<never>;
}
