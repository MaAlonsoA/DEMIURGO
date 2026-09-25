// Context pack builders by action. They gather from authority what each
// builder declares and return a deterministic pack: same scope and same graph → same hash.
// Next to the pack, every builder returns its manifest (observability §9): what it weighed and
// what it did with each candidate. The manifest never enters the hash.

import { type AgentAction, DomainError, type Manifest } from '@demiurgo/domain';
import type { Tx } from '../db/connection.ts';
import type { PackData } from '../commands/packs.ts';
import { ManifestBuilder, inputSource } from './manifest.ts';

export type Scope = { type: string; id?: string | undefined; version?: number | undefined };

export type Built = { pack: PackData; manifest: Manifest };

export type Builder = (a: {
  trx: Tx;
  projectId: string;
  scope: Scope;
  input: Record<string, unknown>;
  graphVersion: number;
}) => Promise<Built>;

const ECHO_CHARS = 2000;

export const BUILDERS: Partial<Record<AgentAction, Builder>> = {
  async echo({ input, graphVersion }) {
    const budget = { characters: ECHO_CHARS };
    const original = typeof input.text === 'string' ? input.text : '';
    const text = original.slice(0, ECHO_CHARS);
    const manifest = new ManifestBuilder('echo@1', graphVersion, budget);
    manifest.entered({
      section: 'input',
      source: inputSource('text'),
      text,
      originalChars: original.length,
      reason: original.length > text.length ? `excerpt:${ECHO_CHARS}` : 'input',
    });
    return {
      pack: {
        role: 'echo',
        constructor: 'echo@1',
        budget,
        graph_version: graphVersion,
        dependencies: [],
        content: { input: { text } },
      },
      manifest: manifest.build(),
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
): Promise<Built> {
  const r = BUILDERS[action];
  if (!r) throw new DomainError('not_implemented', `No context builder for "${action}".`);
  return r({ trx, projectId, scope, input, graphVersion });
}
