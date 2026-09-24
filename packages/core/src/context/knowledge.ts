// Derived knowledge for context packs. Until S2 there is no graph: it contributes no nodes.

import type { Tx } from '../db/connection.ts';

export type ContextNode = { ref: string; type: string; title: string; text: string; reason: string };
export type ContextKnowledge = {
  nodes: ContextNode[];
  dependencies: { type: string; id: string; version: number | null }[];
};

type Selector = (trx: Tx, projectId: string, queryName: string, budget: number) => Promise<ContextKnowledge>;

let selector: Selector = async () => ({ nodes: [], dependencies: [] });

export function registerKnowledgeSelector(s: Selector): void {
  selector = s;
}

export function knowledgeForContext(trx: Tx, projectId: string, queryName: string, budget: number): Promise<ContextKnowledge> {
  return selector(trx, projectId, queryName, budget);
}
