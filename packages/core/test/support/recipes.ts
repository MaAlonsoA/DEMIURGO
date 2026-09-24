// Factory recipes for the S1 entities: how to create each one and, when a guard requires it,
// how to reach certain states.

import { randomUUID } from 'node:crypto';
import { human, system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { executeCommand } from '../../src/bus/bus.ts';
import type { Services } from '../../src/services.ts';
import { registerRecipe, unique } from './factory.ts';

const ana = human('ana');
const sys = system('test');

export async function newExploration(s: Services, projectId: string): Promise<string> {
  const r = await executeCommand(s, {
    command: 'exploration.open',
    actor: ana,
    projectId,
    data: { purpose: unique('Explore') },
  });
  return r.entityId;
}

const decisionSections = [
  { title: 'Context', content: 'Contexto de prueba.' },
  { title: 'Decision', content: 'Decisión de prueba.' },
  { title: 'Consequences', content: 'Consecuencias de prueba.' },
];

export async function newDecision(
  s: Services,
  projectId: string,
  approve = false,
): Promise<{ recordId: string; versionId: string; code: string }> {
  const r = await executeCommand(s, {
    command: 'record.create',
    actor: ana,
    projectId,
    data: { type: 'decision', domain: 'test', title: unique('Decision'), sections: decisionSections },
  });
  const res = r.result as { recordId: string; versionId: string; code: string };
  if (approve)
    await executeCommand(s, { command: 'record_version.approve', actor: ana, projectId, entityId: res.versionId, data: {} });
  return res;
}

const decisionPayload = () => ({ title: unique('Proposal'), context: 'c', decision: 'd', consequences: 'k' });

export async function newBatch(
  s: Services,
  projectId: string,
  packageBatch: boolean,
  n = 1,
): Promise<{ batchId: string; proposals: string[] }> {
  const r = await executeCommand(s, {
    command: 'batch.submit',
    actor: sys,
    projectId,
    data: {
      batch_type: packageBatch ? 'system_package' : 'agent',
      resolution: packageBatch ? 'package' : 'item',
      proposals: Array.from({ length: n }, () => ({ type: 'decision', payload: decisionPayload() })),
    },
  });
  return r.result as { batchId: string; proposals: string[] };
}

registerRecipe('agent_token', {
  async create(s, projectId) {
    const r = await executeCommand(s, { command: 'agent_token.issue', actor: ana, projectId, data: { name: 'bot' } });
    return r.entityId;
  },
});

registerRecipe('exploration', {
  create: newExploration,
  data: { 'exploration.set_aside': () => ({ reason: 'Apartada en la prueba.' }) },
});

registerRecipe('message', {
  async create(s, projectId) {
    const exploration = await newExploration(s, projectId);
    const r = await executeCommand(s, {
      command: 'message.post',
      actor: ana,
      projectId,
      data: { exploration_id: exploration, text: 'Hello', respond: false },
    });
    return r.entityId;
  },
});

registerRecipe('source', {
  async create(s, projectId) {
    const r = await executeCommand(s, {
      command: 'source.register',
      actor: ana,
      projectId,
      data: { name: 'VISION.md', content: unique('x') },
    });
    return r.entityId;
  },
});

registerRecipe('question', {
  async create(s, projectId) {
    const exploration = await newExploration(s, projectId);
    const r = await executeCommand(s, {
      command: 'question.raise',
      actor: ana,
      projectId,
      data: { exploration_id: exploration, question: '¿Quién usará el producto?' },
    });
    return r.entityId;
  },
  data: {
    'question.infer': () => ({ conclusion: 'Los socios.', reasoning: 'Lo dijo la persona.' }),
    'question.confirm': () => ({ conclusion: 'Los socios.' }),
    'question.postpone': () => ({ reason: 'Más adelante.' }),
    'question.discard': () => ({ reason: 'No aplica.' }),
  },
});

registerRecipe('record', {
  async create(s, projectId) {
    return (await newDecision(s, projectId)).recordId;
  },
});

registerRecipe('record_version', {
  async create(s, projectId) {
    return (await newDecision(s, projectId)).versionId;
  },
  states: {
    // A version only becomes superseded once another, later one of the same record is approved.
    async superseded(s, projectId) {
      const d = await newDecision(s, projectId, true);
      const v2 = await executeCommand(s, {
        command: 'record_version.create',
        actor: ana,
        projectId,
        data: { record_id: d.recordId, title: unique('Decision'), sections: decisionSections, change_note: 'Change.' },
      });
      await executeCommand(s, { command: 'record_version.approve', actor: ana, projectId, entityId: v2.entityId, data: {} });
      return d.versionId;
    },
  },
});

registerRecipe('criterion', {
  async create(s, projectId) {
    const r = await executeCommand(s, {
      command: 'record.create',
      actor: ana,
      projectId,
      data: {
        type: 'fdr',
        domain: 'test',
        title: unique('FDR'),
        sections: [
          { title: 'Goal', content: 'o' },
          { title: 'Scope', content: 'a' },
          { title: 'Out of scope', content: 'f' },
          { title: 'Behavior', content: 'c' },
        ],
        criteria: [
          {
            carry: 'new',
            title: 'T',
            statement: 'Cuando x, entonces y.',
            verification: 'automatic',
            check: 'Test.',
          },
        ],
      },
    });
    const versionId = (r.result as { versionId: string }).versionId;
    const c = await s.db.selectFrom('criteria').select('id').where('record_version_id', '=', versionId).executeTakeFirstOrThrow();
    return c.id;
  },
});

registerRecipe('link', {
  async create(s, projectId) {
    // A link is born with its version: a decision that is derived from another one.
    const b = await newDecision(s, projectId);
    const r = await executeCommand(s, {
      command: 'record.create',
      actor: ana,
      projectId,
      data: {
        type: 'decision',
        domain: 'test',
        title: unique('Decision'),
        sections: decisionSections,
        links: [{ type: 'derived_from', target: { code: b.code, version: 1 } }],
      },
    });
    const versionId = (r.result as { versionId: string }).versionId;
    return (await s.db.selectFrom('links').select('id').where('from_id', '=', versionId).executeTakeFirstOrThrow()).id;
  },
  data: { 'link.flag_review': () => ({ reason: 'Cambió el destino.' }) },
});

registerRecipe('batch', {
  // A package by default: this way "accepting the package" and "rejecting it" both have a legal path.
  async create(s, projectId) {
    return (await newBatch(s, projectId, true)).batchId;
  },
  data: { 'batch.supersede': () => ({ reason: 'Obsolete.' }) },
  states: {
    // "resolved" requires an item batch that is fully resolved: its one proposal is rejected.
    async resolved(s, projectId) {
      const { batchId, proposals } = await newBatch(s, projectId, false);
      await executeCommand(s, { command: 'proposal.reject', actor: ana, projectId, entityId: proposals[0] ?? '', data: {} });
      return batchId;
    },
  },
});

registerRecipe('proposal', {
  async create(s, projectId) {
    return (await newBatch(s, projectId, false)).proposals[0] ?? '';
  },
  data: {
    'proposal.accept_edited': () => ({ edit: decisionPayload() }),
    'proposal.supersede': () => ({ reason: 'Obsolete.' }),
  },
});

// Recetas de S2.

const testAxes = [
  {
    code: 'area',
    name: 'Área',
    categories: [
      { code: 'socios', name: 'Socios', description: 'Datos de los socios.' },
      { code: 'other', name: 'Other', description: 'Nada de lo anterior.' },
    ],
  },
];

async function newTaxonomy(s: Services, projectId: string, approve: boolean): Promise<string> {
  const prior = await s.db
    .selectFrom('taxonomies')
    .select('version')
    .where('project_id', '=', projectId)
    .where('code', '=', 'TAX-009')
    .orderBy('version', 'desc')
    .executeTakeFirst();
  const r = await executeCommand(s, {
    command: 'taxonomy.propose',
    actor: ana,
    projectId,
    data: { code: 'TAX-009', title: unique('Taxonomy'), axes: testAxes, version: (prior?.version ?? 0) + 1 },
  });
  if (approve) await executeCommand(s, { command: 'taxonomy.approve', actor: ana, projectId, entityId: r.entityId, data: {} });
  return r.entityId;
}

registerRecipe('taxonomy', {
  create: (s, projectId) => newTaxonomy(s, projectId, false),
});

const classificationData = (taxonomyId: string) => ({
  node_ref: unique('NODE'),
  taxonomy_id: taxonomyId,
  axis: 'area',
  category: 'socios',
  confidence: 0.3,
  justification: 'test',
  classifier: 'test@1',
  input_hash: unique('h'),
  update_id: null,
});

registerRecipe('classification', {
  async create(s, projectId) {
    const t = await newTaxonomy(s, projectId, true);
    return (await executeCommand(s, { command: 'classification.record', actor: sys, projectId, data: classificationData(t) }))
      .entityId;
  },
  data: { 'classification.resolve': () => ({ category: 'socios' }) },
  states: {
    async pending_review(s, projectId) {
      const t = await newTaxonomy(s, projectId, true);
      return (await executeCommand(s, { command: 'classification.hold', actor: sys, projectId, data: classificationData(t) }))
        .entityId;
    },
    async resolved(s, projectId) {
      const t = await newTaxonomy(s, projectId, true);
      const r = await executeCommand(s, {
        command: 'classification.hold',
        actor: sys,
        projectId,
        data: classificationData(t),
      });
      await executeCommand(s, {
        command: 'classification.resolve',
        actor: ana,
        projectId,
        entityId: r.entityId,
        data: { category: 'socios' },
      });
      return r.entityId;
    },
  },
});

// A queued update is created directly (without the inline engine processing it right away).
registerRecipe('knowledge_update', {
  async create(s, projectId) {
    const { rows } = await sql<{ id: string }>`
      insert into knowledge_updates (project_id, trigger, trigger_seq, state)
      values (${projectId}::uuid, ${JSON.stringify({ type: 'another', id: randomUUID(), version: null })}::jsonb, 0, 'queued') returning id`.execute(
      s.db,
    );
    return rows[0]?.id ?? '';
  },
  data: {
    'knowledge_update.verify': () => ({
      change: null,
      candidates: [],
      input_hash: 'x',
      classifier: 'test@1',
      verdicts: [],
    }),
    'knowledge_update.apply': () => ({ operations: {}, version_before: 0, version_after: 0 }),
    'knowledge_update.reject': () => ({ reasons: ['test'] }),
  },
});

const nodeData = () => ({
  ref: unique('NODE'),
  type: 'source',
  label: 'Node',
  text: 'Text',
  categories: {},
  epistemic: 'unknown',
  origin: { type: 'source', id: null, version: null },
  from: 1,
  update_id: null,
});

registerRecipe('knowledge_node', {
  async create(s, projectId) {
    return (await executeCommand(s, { command: 'knowledge_node.project', actor: sys, projectId, data: nodeData() })).entityId;
  },
  data: { 'knowledge_node.invalidate': () => ({ until: 2 }) },
});

registerRecipe('knowledge_edge', {
  async create(s, projectId) {
    const a = nodeData();
    const b = nodeData();
    await executeCommand(s, { command: 'knowledge_node.project', actor: sys, projectId, data: a });
    await executeCommand(s, { command: 'knowledge_node.project', actor: sys, projectId, data: b });
    const r = await executeCommand(s, {
      command: 'knowledge_edge.project',
      actor: sys,
      projectId,
      data: { type: 'related', from: a.ref, to: b.ref, validFrom: 1, update_id: null },
    });
    return r.entityId;
  },
  data: { 'knowledge_edge.invalidate': () => ({ until: 2 }) },
});

registerRecipe('idea_assessment', {
  async create(s, projectId) {
    const { proposals } = await newBatch(s, projectId, true);
    const r = await executeCommand(s, {
      command: 'idea_assessment.record',
      actor: sys,
      projectId,
      data: {
        proposal_id: proposals[0] ?? '',
        findings: [],
        graph_version: 0,
        classifier: 'test@1',
        input_hash: unique('h'),
      },
    });
    return r.entityId;
  },
});
