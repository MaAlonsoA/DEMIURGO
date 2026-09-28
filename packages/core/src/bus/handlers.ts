// Handler registry by command. Each command module registers itself when imported.

import type { CommandName } from '@demiurgo/domain';
import type { Services } from '../services.ts';
import type { Handler, Request } from './types.ts';

export const HANDLERS: Partial<Record<CommandName, Handler>> = {};

/**
 * Work a command needs before its transaction opens (a model call never holds one open): it returns
 * the request to execute. Only for a command that enters on its own, not for nested ones.
 */
export type Preparer = (services: Services, request: Request) => Promise<Request>;

export const PREPARERS: Partial<Record<CommandName, Preparer>> = {};

export function registerPreparers(preparers: { [C in CommandName]?: Preparer }): void {
  for (const [command, f] of Object.entries(preparers)) {
    const c = command as CommandName;
    if (PREPARERS[c]) throw new Error(`The "${c}" command already has a preparer.`);
    PREPARERS[c] = f;
  }
}

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
