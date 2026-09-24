// Integrates knowledge with the rest of the core: selection for context packs, idea
// assessment after each agent batch, and its share of the inbox.

import { selectForContext } from '@demiurgo/domain';
import { registerInboxExtension } from '../queries/read.ts';
import { registerKnowledgeSelector } from '../context/knowledge.ts';
import { loadGraph } from './graph-pg.ts';

registerKnowledgeSelector(async (trx, projectId, queryName, budget) => {
  const g = await loadGraph(trx, projectId);
  const chosen = selectForContext(g, queryName, budget);
  return {
    nodes: chosen.map(({ node, reason }) => ({
      ref: node.ref,
      type: node.type,
      title: node.label,
      text: node.text.slice(0, 600),
      reason,
    })),
    dependencies: chosen.map(({ node }) => ({ type: 'knowledge_node', id: node.ref, version: g.version })),
  };
});

registerInboxExtension({
  async assessment(db, proposalId) {
    const e = await db
      .selectFrom('idea_assessments')
      .select(['findings', 'graph_version', 'classifier'])
      .where('proposal_id', '=', proposalId)
      .executeTakeFirst();
    if (!e) return { isPending: true };
    // Assessments store their findings, the responses that weren't verified, and the error, if there was one.
    const f = (Array.isArray(e.findings) ? { findings: e.findings } : e.findings) as {
      findings?: unknown[];
      invalid?: unknown[];
      error?: string | null;
    };
    return {
      findings: f.findings ?? [],
      invalid: f.invalid ?? [],
      error: f.error ?? null,
      graph_version: Number(e.graph_version),
      classifier: e.classifier,
    };
  },
  async pending(db, projectId) {
    const classifications = await db
      .selectFrom('classifications')
      .select(['id', 'node_ref', 'axis', 'category', 'confidence', 'justification', 'classifier'])
      .where('project_id', '=', projectId)
      .where('state', '=', 'pending_review')
      .orderBy('created_at')
      .execute();
    const rejected = await db
      .selectFrom('knowledge_updates')
      .select(['id', 'trigger', 'failure', 'created_at'])
      .where('project_id', '=', projectId)
      .where('state', '=', 'rejected')
      .orderBy('created_at')
      .execute();
    return {
      total: classifications.length + rejected.length,
      sections: {
        classifications_to_review: classifications.map((c) => ({ ...c, epistemic_status: 'pending' })),
        rejected_updates: rejected.map((u) => ({ ...u, epistemic_status: 'pending' })),
      },
    };
  },
});
