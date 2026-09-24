// Context pack builders by action. They gather from authority what each
// builder declares and return a deterministic pack: same scope and same graph → same hash.

import { type AgentAction, DomainError } from '@demiurgo/domain';
import type { Tx } from '../db/connection.ts';
import type { PackData } from '../commands/packs.ts';

export type Scope = { type: string; id?: string | undefined; version?: number | undefined };

export type Builder = (a: {
  trx: Tx;
  projectId: string;
  scope: Scope;
  input: Record<string, unknown>;
  graphVersion: number;
}) => Promise<PackData>;

export const BUILDERS: Partial<Record<AgentAction, Builder>> = {
  async echo({ input, graphVersion }) {
    return {
      role: 'echo',
      constructor: 'echo@1',
      budget: { characters: 2000 },
      graph_version: graphVersion,
      dependencies: [],
      content: { input: { text: typeof input.text === 'string' ? input.text.slice(0, 2000) : '' } },
    };
  },
};

export function registerBuilder(action: AgentAction, r: Builder): void {
  BUILDERS[action] = r;
}

export async function buildContext(
  trx: Tx,
  projectId: string,
  action: AgentAction,
  scope: Scope,
  input: Record<string, unknown>,
  graphVersion: number,
): Promise<PackData> {
  const r = BUILDERS[action];
  if (!r) throw new DomainError('not_implemented', `No context builder for "${action}".`);
  return r({ trx, projectId, scope, input, graphVersion });
}
