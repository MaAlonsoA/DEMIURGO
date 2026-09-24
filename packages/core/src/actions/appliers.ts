// Efectos de la salida validada de cada acción. Solo se ejecutan con salida válida y dentro
// de la misma transacción que completa la ejecución: o todo o nada, una sola vez.

import type { AgentAction, ActionOutput } from '@demiurgo/domain';
import type { Request, Result } from '../bus/types.ts';
import type { Row } from '../db/schema.ts';
import type { Tx } from '../db/connection.ts';

export type ApplierInput<A extends AgentAction> = {
  trx: Tx;
  execute: (p: Request) => Promise<Result>;
  run: Row<'ai_runs'>;
  output: ActionOutput<A>;
};

type Applier<A extends AgentAction> = (e: ApplierInput<A>) => Promise<void>;

export const APPLIERS: { [A in AgentAction]?: Applier<A> } = {
  // eco no tiene efectos: la salida queda en la propia ejecución.
  echo: async () => undefined,
};

export function registerApplier<A extends AgentAction>(action: A, applier: Applier<A>): void {
  (APPLIERS as Record<string, unknown>)[action] = applier;
}
