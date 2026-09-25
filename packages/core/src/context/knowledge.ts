// Derived knowledge for context packs. Until S2 there is no graph: it contributes no nodes.

import type { ContextCandidateReason } from '@demiurgo/domain';
import type { Tx } from '../db/connection.ts';

export type ContextNode = { ref: string; type: string; title: string; text: string; reason: string };

/** A node the selector weighed, for the manifest (observability §9.2): with its score and fate. */
export type ConsideredNode = {
  ref: string;
  title: string;
  /** The text as it enters the pack when chosen (already cut). */
  text: string;
  originalChars: number;
  score: number;
  reason: ContextCandidateReason;
};

export type ContextKnowledge = {
  nodes: ContextNode[];
  dependencies: { type: string; id: string; version: number | null }[];
  /** Every candidate, chosen or not, in the order the selector weighed them. */
  considered: ConsideredNode[];
  graphVersion: number;
};

type Selector = (trx: Tx, projectId: string, queryText: string, budget: number) => Promise<ContextKnowledge>;

let selector: Selector = async () => ({ nodes: [], dependencies: [], considered: [], graphVersion: 0 });

export function registerKnowledgeSelector(s: Selector): void {
  selector = s;
}

export function knowledgeForContext(trx: Tx, projectId: string, queryText: string, budget: number): Promise<ContextKnowledge> {
  return selector(trx, projectId, queryText, budget);
}
