// Effects of each action's validated output. They only run with valid output and inside
// the same transaction that completes the run: all or nothing, exactly once.

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
  // echo has no effects: its output stays in the run itself.
  echo: async () => undefined,
};

export function registerApplier<A extends AgentAction>(action: A, applier: Applier<A>): void {
  (APPLIERS as Record<string, unknown>)[action] = applier;
}
