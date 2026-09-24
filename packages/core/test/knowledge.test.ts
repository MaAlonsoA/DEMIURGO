// S2 ACs on the knowledge engine: verified update, invalidate instead of deleting,
// rebuild with the same fingerprint, freshness, idea assessment, context packs,
// taxonomy and confidence.

import { randomUUID } from 'node:crypto';
import {
  type Actor,
  type Change,
  type Classifier,
  type Graph,
  DEFAULT_THRESHOLDS,
  VERDICTS,
  externalAgent,
  routeByConfidence,
  human,
  buildPlan,
  system,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { inbox } from '../src/queries/read.ts';
import { createCascadeClassifier } from '../src/classifier/cascade.ts';
import { UPDATER } from '../src/knowledge/commands.ts';
import { compareRebuild } from '../src/knowledge/rebuild.ts';
import { loadGraph, readGraphVersion } from '../src/knowledge/graph-pg.ts';
import type { Services } from '../src/services.ts';
import { createScriptedClassifier, response } from './support/scripted-classifier.ts';
import { useEnvironment } from './support/env.ts';

const script = createScriptedClassifier();
const environment = useEnvironment({ classifier: () => script });
const ana = human('ana');
let s: Services;

beforeAll(() => {
  s = environment().services;
});
beforeEach(() => script.restart());

async function newProject(name: string): Promise<string> {
  return (await executeCommand(s, { command: 'project.create', actor: ana, data: { name } })).projectId;
}

const cmd = (
  projectId: string,
  command: Parameters<typeof executeCommand>[1]['command'],
  data: unknown,
  entityId?: string,
  actor: Actor = ana,
) => executeCommand(s, { command, actor, projectId, data, ...(entityId ? { entityId } : {}) });

async function decision(projectId: string, title: string, text: string, approve = true) {
  const r = await cmd(projectId, 'record.create', {
    type: 'decision',
    domain: 'socios',
    title,
    sections: [
      { title: 'Context', content: `Contexto de ${title}.` },
      { title: 'Decision', content: text },
      { title: 'Consequences', content: 'Hay que diseñarlo.' },
    ],
  });
  const res = r.result as { recordId: string; versionId: string; code: string };
  if (approve) await cmd(projectId, 'record_version.approve', {}, res.versionId);
  return res;
}

async function newVersion(projectId: string, recordId: string, text: string) {
  const v = await cmd(projectId, 'record_version.create', {
    record_id: recordId,
    title: 'Versión revisada',
    sections: [
      { title: 'Context', content: 'Revisión.' },
      { title: 'Decision', content: text },
      { title: 'Consequences', content: 'Hay que rediseñarlo.' },
    ],
    change_note: 'Cambia la decisión.',
  });
  await cmd(projectId, 'record_version.approve', {}, v.entityId);
  return v.entityId;
}

const updates = (projectId: string) =>
  s.db
    .selectFrom('knowledge_updates')
    .selectAll()
    .where('project_id', '=', projectId)
    .orderBy('trigger_seq')
    .orderBy('id')
    .execute();
const nodes = (projectId: string) => s.db.selectFrom('knowledge_nodes').selectAll().where('project_id', '=', projectId).execute();
const unique = () => randomUUID().slice(0, 8);

/** Batch from an external agent with proposals of one type. */
async function agentBatch(projectId: string, payloads: Record<string, unknown>[], type = 'decision') {
  const r = await cmd(
    projectId,
    'batch.submit',
    { proposals: payloads.map((payload) => ({ type, payload })) },
    undefined,
    externalAgent('bot', 'session'),
  );
  return r.result as { batchId: string; proposals: string[] };
}

const decisionPayload = (title: string, text: string) => ({ title, context: 'c', decision: text, consequences: 'k' });

/** Taxonomy with one axis, one of its own categories and "other". */
const axesWith = (cat: string) => [
  {
    code: 'area',
    name: 'Área',
    categories: [
      { code: cat, name: cat, description: `Todo sobre ${cat} y socios.` },
      { code: 'other', name: 'Other', description: 'Other.' },
    ],
  },
];

/** Classifier that always answers the same thing, with each position's confidence. */
const fixed = (id: string, choice: string, confidences: number[]): Classifier => ({
  id,
  choice: async (items) => items.map((i, k) => response(i.id, choice, confidences[k] ?? 0.5)),
  score: async () => [],
  noul: async () => [],
});

/** Node with authority, for the plan's pure tests. */
const testNode = (ref: string) => ({
  ref,
  type: 'decision',
  label: ref,
  text: ref,
  categories: {},
  epistemic: 'confirmed' as const,
  authority: true,
  origin: { type: 'record_version', id: null, version: 1 },
  from: 1,
  until: null,
});

/** A project's current nodes as "ref|epistemic status". */
const current = async (projectId: string) =>
  (await nodes(projectId))
    .filter((n) => n.valid_to === null)
    .map((n) => `${n.ref}|${n.epistemic}`)
    .sort();

describe('Update knowledge', () => {
  it('AC-CON-001-01 approving a version triggers the update and bumps the graph version', async () => {
    const p = await newProject('Trigger');
    expect(await readGraphVersion(s.db, p)).toBe(0);
    const d = await decision(p, `Alta de socios ${unique()}`, 'Cada socio se da de alta con su correo.');
    const us = await updates(p);
    expect(us).toHaveLength(1);
    expect(us[0]).toMatchObject({ state: 'applied', trigger: { type: 'record_version', id: d.versionId } });
    expect(await readGraphVersion(s.db, p)).toBe(1);
    const n = await nodes(p);
    expect(n.map((x) => [x.ref, x.epistemic, x.valid_to])).toEqual([[`${d.code}@1`, 'confirmed', null]]);
    const event = await s.db
      .selectFrom('events')
      .select(['actor'])
      .where('command', '=', 'knowledge_update.apply')
      .where('entity_id', '=', us[0]?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(event.actor).toBe('system:knowledge@1');
  });

  it('AC-CON-001-02 a set of verdicts that does not cover a candidate leaves the update rejected with no effects', async () => {
    const p = await newProject('No verdict');
    const t = unique();
    await decision(p, `Cuotas anuales ${t}`, `Los socios pagan una cuota anual ${t}.`);
    const before = { version: await readGraphVersion(s.db, p), nodes: (await nodes(p)).length };
    script.scripts.verdict = () => [];
    await decision(p, `Cuotas anuales revisadas ${t}`, `Los socios pagan una cuota anual ${t} en enero.`);
    const us = await updates(p);
    expect(us.at(-1)).toMatchObject({ state: 'rejected' });
    expect(us.at(-1)?.failure).toMatch(/has no verdict/);
    expect({ version: await readGraphVersion(s.db, p), nodes: (await nodes(p)).length }).toEqual(before);
    expect((await inbox(s.db, p)).rejected_updates).toHaveLength(1);
  });

  it('AC-CON-001-03 a verdict that cites a nonexistent node leaves the update rejected with no effects', async () => {
    const p = await newProject('Nonexistent node');
    const t = unique();
    await decision(p, `Invitados ${t}`, `Cada socio puede traer invitados ${t}.`);
    const before = { version: await readGraphVersion(s.db, p), nodes: (await nodes(p)).length };
    script.scripts.verdict = (items, baseline) => [...baseline, response('DEC-XXX-999@1', 'relate', 0.9)];
    await decision(p, `Invitados limitados ${t}`, `Cada socio puede traer dos invitados ${t}.`);
    const u = (await updates(p)).at(-1);
    expect(u).toMatchObject({ state: 'rejected' });
    expect(u?.failure).toMatch(/does not exist: DEC-XXX-999@1/);
    expect({ version: await readGraphVersion(s.db, p), nodes: (await nodes(p)).length }).toEqual(before);
  });

  it('AC-CON-001-04 a verdict that invalidates an approved decision produces a proposal in the inbox, never a direct change', async () => {
    const p = await newProject('Invalidate authority');
    const t = unique();
    const old = await decision(p, `Pago en efectivo ${t}`, `Las cuotas se pagan en efectivo ${t}.`);
    script.scripts.verdict = (items) =>
      items.map((i) => response(i.id, 'invalidate', 0.95, 'El pago por transferencia sustituye al efectivo.'));
    await decision(p, `Pago por transferencia ${t}`, `Las cuotas se pagan por transferencia ${t}.`);
    // The old decision stays approved and its node stays current.
    const v = await s.db.selectFrom('record_versions').select('state').where('id', '=', old.versionId).executeTakeFirstOrThrow();
    expect(v.state).toBe('approved');
    const oldNode = (await nodes(p)).find((n) => n.ref === `${old.code}@1`);
    expect(oldNode?.valid_to).toBeNull();
    // And the inbox has a knowledge review proposal, which the person resolves.
    const b = await inbox(s.db, p);
    const batch = b.batches.find((l) => l.type === 'knowledge');
    expect(batch?.producer).toBe('system:knowledge@1');
    expect(batch?.proposals[0]).toMatchObject({
      type: 'review',
      payload: { record: { code: old.code, version: 1 }, verdict: 'invalidate' },
    });
  });

  it('AC-CON-001-04 if a review cannot be proposed, the update is rejected instead of being lost', async () => {
    const p = await newProject('Review without origin');
    const t = unique();
    await decision(p, `Base ${t}`, `Algo de base ${t}.`);
    // A node with authority whose origin isn't a version of this project (e.g. an altered graph).
    await sql`insert into knowledge_nodes (project_id, ref, kind, source_type, source_id, source_version, label, body, epistemic, valid_from, state)
      values (${p}::uuid, 'DEC-ZZZ-009@1', 'decision', 'record_version', ${randomUUID()}::uuid, 1,
              ${`Pago en efectivo ${t}`}, ${`Las cuotas se pagan en efectivo ${t}.`}, 'confirmed', 1, 'current')`.execute(s.db);
    script.scripts.verdict = (items) => items.map((i) => response(i.id, 'invalidate', 0.95, 'Superseded.'));
    await decision(p, `Pago por transferencia ${t}`, `Las cuotas se pagan por transferencia ${t}.`);
    const u = (await updates(p)).at(-1);
    expect(u?.state).toBe('rejected');
    expect(u?.failure).toMatch(/Can't propose the review of DEC-ZZZ-009@1/);
  });

  it('AC-CON-001-04 a record with a domain that has digits is rejected on creation: its code could not be cited', async () => {
    const p = await newProject('Domain with digits');
    await expect(
      cmd(p, 'record.create', {
        type: 'decision',
        domain: 'b2b',
        title: 'Payment',
        sections: [
          { title: 'Context', content: 'c' },
          { title: 'Decision', content: 'd' },
          { title: 'Consequences', content: 'k' },
        ],
      }),
    ).rejects.toMatchObject({ type: 'validation' });
  });

  it('AC-CON-001-05 what is superseded gets a valid_to and is never deleted', async () => {
    const p = await newProject('Invalidate');
    const d = await decision(p, `Horario ${unique()}`, 'La sede abre por la tarde.');
    await newVersion(p, d.recordId, 'La sede abre por la mañana.');
    const n = await nodes(p);
    const v1 = n.find((x) => x.ref === `${d.code}@1`);
    const v2 = n.find((x) => x.ref === `${d.code}@2`);
    expect(v1?.valid_to).toBe('2');
    expect(v2?.valid_to).toBeNull();
    await expect(sql`delete from knowledge_nodes where id = ${v1?.id ?? ''}::uuid`.execute(s.db)).rejects.toThrow(/DELETE/);
    await expect(sql`update knowledge_nodes set valid_to = null where id = ${v1?.id ?? ''}::uuid`.execute(s.db)).rejects.toThrow(
      /can only be invalidated/,
    );
  });

  it('AC-CON-001-06 rebuilding with the saved classifications gives the same fingerprint', async () => {
    const p = await newProject('Rebuild');
    const t = unique();
    await cmd(p, 'taxonomy.propose', {
      code: 'TAX-001',
      title: 'Taxonomía',
      axes: [
        {
          code: 'area',
          name: 'Área',
          categories: [
            { code: 'socios', name: 'Socios', description: 'Alta, baja y datos de los socios.' },
            { code: 'dues', name: 'Dues', description: 'Pagos y cuotas de la asociación.' },
            { code: 'other', name: 'Other', description: 'Nada de lo anterior.' },
          ],
        },
      ],
    }).then((r) => cmd(p, 'taxonomy.approve', {}, r.entityId));
    const a = await decision(p, `Alta de socios ${t}`, `Los socios se dan de alta con su correo ${t}.`);
    const b = await decision(p, `Cuota anual ${t}`, `Los socios pagan una cuota anual ${t}.`);
    await newVersion(p, a.recordId, `Los socios se dan de alta con correo y teléfono ${t}.`);
    await cmd(p, 'record.create', {
      type: 'fdr',
      domain: 'socios',
      title: `Alta ${t}`,
      sections: [
        { title: 'Goal', content: 'Alta de socios.' },
        { title: 'Scope', content: 'Formulario.' },
        { title: 'Out of scope', content: 'Pagos.' },
        { title: 'Behavior', content: 'Se rellena y se confirma.' },
      ],
      criteria: [
        {
          carry: 'new',
          title: 'Alta',
          statement: 'Cuando se envía, entonces se guarda.',
          verification: 'automatic',
          check: 'Test.',
        },
      ],
      links: [{ type: 'based_on', target: { code: b.code, version: 1 } }],
    }).then((r) => cmd(p, 'record_version.approve', {}, (r.result as { versionId: string }).versionId));
    const callsBefore = { ...script.calls };
    const comparison = await compareRebuild(s.db, p);
    expect(comparison.equal).toBe(true);
    expect(comparison.alive).toMatch(/^[0-9a-f]{64}$/);
    // The rebuild doesn't call the classifier again: everything comes from what's saved.
    expect(script.calls).toEqual(callsBefore);
    const g = await loadGraph(s.db, p);
    expect(g.nodes.some((n) => Object.keys(n.categories).length > 0)).toBe(true);
  });

  it('AC-CON-001-06 the rebuild reproduces proposals, discards, links, rejections and retries, and detects an altered graph', async () => {
    const p = await newProject('Rebuild everything');
    const t = unique();
    const a = await decision(p, `Horario de la sede ${t}`, `La sede abre por la tarde ${t}.`);
    // A proposal accepted without approving is projected as proposed; discarding the draft withdraws it.
    const discarded = await agentBatch(p, [decisionPayload(`Sede por la mañana ${t}`, `La sede abre por la mañana ${t}.`)]);
    const draft = (await cmd(p, 'proposal.accept', {}, discarded.proposals[0])).result as {
      versionId: string;
      code: string;
    };
    expect(await current(p)).toContain(`${draft.code}@1|proposed`);
    await cmd(p, 'record_version.discard', { reason: 'No.' }, draft.versionId);
    expect((await current(p)).some((n) => n.startsWith(`${draft.code}@1`))).toBe(false);
    // "Accept and approve".
    const approved = await agentBatch(p, [decisionPayload(`Sede en agosto ${t}`, `La sede cierra en agosto ${t}.`)]);
    await cmd(p, 'proposal.accept', { approve: true }, approved.proposals[0]);
    // An FDR with its link to a decision.
    await cmd(p, 'record.create', {
      type: 'fdr',
      domain: 'socios',
      title: `Reservas de la sede ${t}`,
      sections: [
        { title: 'Goal', content: 'Reservar la sede.' },
        { title: 'Scope', content: 'Formulario.' },
        { title: 'Out of scope', content: 'Pagos.' },
        { title: 'Behavior', content: 'Se reserva y se confirma.' },
      ],
      criteria: [
        {
          carry: 'new',
          title: 'Reservation',
          statement: 'Cuando se reserva, entonces se confirma.',
          verification: 'automatic',
          check: 'Test.',
        },
      ],
      links: [{ type: 'based_on', target: { code: a.code, version: 1 } }],
    }).then((r) => cmd(p, 'record_version.approve', {}, (r.result as { versionId: string }).versionId));
    // A rejected update, another applied afterwards, and the rejected one's retry at the end.
    script.scripts.verdict = () => [];
    await decision(p, `Sede abierta los sábados ${t}`, `La sede abre por la tarde los sábados ${t}.`);
    script.restart();
    await decision(p, `Llaves de la sede ${t}`, `Cada socio de la junta tiene llave de la sede ${t}.`);
    const rejected = (await updates(p)).find((u) => u.state === 'rejected');
    expect(rejected).toBeDefined();
    await cmd(p, 'knowledge_update.retry', {}, rejected?.id);
    expect((await updates(p)).find((u) => u.id === rejected?.id)?.state).toBe('applied');
    await newVersion(p, a.recordId, `La sede abre por la tarde y los domingos ${t}.`);

    const callsBefore = { ...script.calls };
    expect(await compareRebuild(s.db, p)).toMatchObject({ equal: true, derivation: null });
    expect(script.calls).toEqual(callsBefore);

    // The rebuild starts from authority, not the live graph: a hand-inserted node makes it diverge.
    await sql`insert into knowledge_nodes (project_id, ref, kind, source_type, label, body, epistemic, valid_from, state)
      values (${p}::uuid, 'DEC-ZZZ-999@1', 'decision', 'manual', 'Colado', 'Colado', 'confirmed', 1, 'current')`.execute(s.db);
    expect(await compareRebuild(s.db, p)).toMatchObject({ equal: false, derivation: expect.stringMatching(/doesn't match/) });
  });

  it('AC-CON-001-13 the same input reuses the verdicts saved by input_hash without calling the classifier', async () => {
    const t = unique();
    const text = `La junta aprueba las altas ${t}.`;
    const p1 = await newProject('Cache 1');
    await decision(p1, `Aprobación de altas ${t}`, text);
    await decision(p1, `Revisión de altas ${t}`, `${text} Y revisa las bajas.`);
    const calls = script.calls.verdict;
    expect(calls).toBeGreaterThan(0);
    const p2 = await newProject('Cache 2');
    await decision(p2, `Aprobación de altas ${t}`, text);
    await decision(p2, `Revisión de altas ${t}`, `${text} Y revisa las bajas.`);
    expect(script.calls.verdict).toBe(calls);
    const [u1, u2] = [(await updates(p1)).at(-1), (await updates(p2)).at(-1)];
    expect(u2?.input_hash).toBe(u1?.input_hash);
    expect(u2?.verdicts).toEqual(u1?.verdicts);
  });

  it('AC-CON-001-13 an unverified output does not enter the cache: retrying asks again and gets applied', async () => {
    const p = await newProject('Cache without poison');
    const t = unique();
    await decision(p, `Invitados ${t}`, `Cada socio puede traer invitados ${t}.`);
    script.scripts.verdict = () => [];
    await decision(p, `Invitados limitados ${t}`, `Cada socio puede traer dos invitados ${t}.`);
    const rejected = (await updates(p)).at(-1);
    expect(rejected?.state).toBe('rejected');
    const saved = await s.db
      .selectFrom('verdict_cache')
      .select('input_hash')
      .where('input_hash', '=', rejected?.input_hash ?? '')
      .executeTakeFirst();
    expect(saved).toBeUndefined();
    script.restart();
    await cmd(p, 'knowledge_update.retry', {}, rejected?.id);
    expect(script.calls.verdict).toBe(1);
    expect((await updates(p)).at(-1)?.state).toBe('applied');
  });

  it('AC-CON-001-02 a verdict that cites a node that was not a candidate, or two verdicts for the same candidate, leave the update rejected', async () => {
    const p = await newProject('Strict verification');
    const t = unique();
    const a = await decision(p, `Cuotas ${t}`, `Los socios pagan una cuota anual ${t}.`);
    // Another decision on the same topic: this way there are candidates and the classifier answers.
    await decision(p, `Recibos de las cuotas ${t}`, `Los socios pagan la cuota anual ${t} con recibo.`);
    // The version being superseded exists, but is never a candidate: precedence is decided by the code.
    script.scripts.verdict = (items, baseline) => [...baseline, response(`${a.code}@1`, 'relate', 0.9)];
    await newVersion(p, a.recordId, `Los socios pagan una cuota anual ${t} en enero.`);
    const u1 = (await updates(p)).at(-1);
    expect(u1?.state).toBe('rejected');
    expect(u1?.failure).toMatch(/was not a candidate/);
    script.scripts.verdict = (items, baseline) => [...baseline, ...baseline];
    await decision(p, `Cuotas de enero ${t}`, `Los socios pagan una cuota anual ${t} cada enero.`);
    const u2 = (await updates(p)).at(-1);
    expect(u2?.state).toBe('rejected');
    expect(u2?.failure).toMatch(/has 2 verdicts/);
  });
});

describe('freshness', () => {
  it('AC-CON-001-07 with an unprojected authority event, requesting a run is rejected because the graph is stale', async () => {
    const p = await newProject('Freshness');
    const d = await decision(p, `Frescura ${unique()}`, 'Algo aprobado.');
    // An authority event whose update has not been applied yet (e.g. after a crash).
    await sql`insert into knowledge_updates (project_id, trigger, trigger_seq, state)
      values (${p}::uuid, ${JSON.stringify({ type: 'record_version', id: d.versionId, version: 1 })}::jsonb, 999, 'queued')`.execute(
      s.db,
    );
    const request = () =>
      cmd(p, 'run.request', { action: 'design_proposal', scope: { type: 'record_version', id: d.versionId } });
    await expect(request()).rejects.toMatchObject({ type: 'guard', reasons: [expect.stringContaining('not up to date')] });
    await s.engine.startUpdate('', p);
    await expect(request()).resolves.toMatchObject({ state: 'queued' });
  });
});

describe('idea assessment', () => {
  it('AC-CON-001-08 an idea that duplicates an approved decision appears in the inbox marked as a duplicate with the citation', async () => {
    const p = await newProject('Ideas');
    const t = unique();
    const d = await decision(
      p,
      `Dos invitados por socio ${t}`,
      `Cada socio puede traer como máximo dos invitados a los eventos ${t}.`,
    );
    await cmd(
      p,
      'batch.submit',
      {
        proposals: [
          {
            type: 'decision',
            payload: {
              title: `Dos invitados por socio ${t}`,
              context: 'Aforo.',
              decision: `Cada socio puede traer como máximo dos invitados a los eventos ${t}.`,
              consequences: 'Contarlos.',
            },
          },
        ],
      },
      undefined,
      externalAgent('bot', 's1'),
    );
    const b = await inbox(s.db, p);
    const proposal = b.batches[0]?.proposals[0];
    expect(proposal?.assessment).toMatchObject({
      findings: [expect.objectContaining({ finding: 'duplicates', citation: `${d.code}@1` })],
    });
  });
});

describe('idea assessment: packages, citations and failures', () => {
  it("AC-CON-001-08 the ideas in a run's package are assessed, with the citation's epistemic status and invalid responses recorded", async () => {
    const p = await newProject('Package ideas');
    const t = unique();
    const text = `Cada socio puede traer como máximo dos invitados a los eventos ${t}.`;
    const d = await decision(p, `Dos invitados por socio ${t}`, text);
    const run = await cmd(p, 'run.request', { action: 'design_proposal', scope: { type: 'record_version', id: d.versionId } });
    script.scripts.idea = (items, baseline) => [...baseline, response('DEC-ZZZ-001@1', 'duplicates', 0.9)];
    const batch = await cmd(
      p,
      'batch.submit',
      {
        batch_type: 'system_package',
        resolution: 'package',
        run_id: run.entityId,
        proposals: [
          {
            type: 'fdr',
            payload: {
              title: `Dos invitados por socio ${t}`,
              goal: text,
              scope: 'Eventos.',
              out_of_scope: 'Pagos.',
              behavior: text,
              criteria: [
                {
                  title: 'Cap',
                  statement: 'Cuando trae un tercero, entonces se rechaza.',
                  verification: 'automatic',
                  check: 'E2E.',
                },
              ],
              based_on: { code: d.code, version: 1 },
            },
          },
        ],
      },
      undefined,
      system('design'),
    );
    const b = await inbox(s.db, p);
    const assessment = b.batches.find((l) => l.id === batch.entityId)?.proposals[0]?.assessment;
    expect(assessment).toMatchObject({
      findings: [expect.objectContaining({ citation: `${d.code}@1`, epistemic_status: 'confirmed' })],
      invalid: [expect.objectContaining({ citation: 'DEC-ZZZ-001@1', reason: 'Not a candidate.' })],
      error: null,
    });
  });

  it('AC-CON-001-08 if assessing an idea fails, the error is recorded instead of it staying pending', async () => {
    const p = await newProject('Ideas with failure');
    const t = unique();
    await decision(p, `Sede ${t}`, `La sede abre por la tarde ${t}.`);
    script.scripts.idea = () => {
      throw new Error('provider down');
    };
    const batch = await agentBatch(p, [decisionPayload(`Sede por la tarde ${t}`, `La sede abre por la tarde ${t}.`)]);
    const b = await inbox(s.db, p);
    expect(b.batches.find((l) => l.id === batch.batchId)?.proposals[0]?.assessment).toMatchObject({
      findings: [],
      error: expect.stringMatching(/provider down/),
    });
  });
});

describe('context packs', () => {
  it('AC-CON-001-09 the pack records role, budget, nodes with a reason, graph version, dependencies and hash', async () => {
    const p = await newProject('Packs');
    const t = unique();
    await decision(p, `Cuotas ${t}`, `Las cuotas de los socios se pagan cada año ${t}.`);
    const d = await decision(p, `Alta de socios ${t}`, `El alta de los socios exige pagar la cuota ${t}.`);
    const request = () =>
      cmd(p, 'run.request', { action: 'design_proposal', scope: { type: 'record_version', id: d.versionId } });
    const r1 = await request();
    const r2 = await request();
    const packs = await s.db.selectFrom('context_packs').selectAll().where('project_id', '=', p).execute();
    expect(packs).toHaveLength(1);
    const pack = packs[0];
    expect(pack).toMatchObject({ role: 'design', builder: 'design_proposal@1', graph_version: '2' });
    expect(pack?.budget).toMatchObject({ decision: 8000, knowledge: 4000 });
    const content = pack?.content as { knowledge: { ref: string; reason: string }[] };
    expect(content.knowledge.length).toBeGreaterThan(0);
    for (const n of content.knowledge) expect(n.reason).toMatch(/relevance/);
    expect(pack?.dependencies).toContainEqual({ type: 'knowledge_node', id: content.knowledge[0]?.ref, version: 2 });
    expect((r1.result as { contextPackHash: string }).contextPackHash).toBe(
      (r2.result as { contextPackHash: string }).contextPackHash,
    );
    // With the graph changed, the pack for the same scope is a different one.
    await decision(p, `Otra ${t}`, 'Algo distinto.');
    const r3 = await request();
    expect((r3.result as { contextPackHash: string }).contextPackHash).not.toBe(
      (r1.result as { contextPackHash: string }).contextPackHash,
    );
  });
});

describe('what is approved is confirmed', () => {
  it('AC-CON-001-09 what is approved with "Accept and approve" is confirmed in the graph and enters the context pack', async () => {
    const p = await newProject('Accept and approve');
    const t = unique();
    const batch = await agentBatch(p, [
      decisionPayload(`Cuota de socios ${t}`, `Los socios pagan una cuota anual de treinta euros ${t}.`),
    ]);
    const accepted = (await cmd(p, 'proposal.accept', { approve: true }, batch.proposals[0])).result as { code: string };
    expect((await current(p)).filter((n) => n.startsWith(accepted.code))).toEqual([`${accepted.code}@1|confirmed`]);
    const d = await decision(p, `Recibo de la cuota ${t}`, `La cuota anual de los socios se cobra con recibo ${t}.`);
    const r = await cmd(p, 'run.request', { action: 'design_proposal', scope: { type: 'record_version', id: d.versionId } });
    const pack = await s.db
      .selectFrom('context_packs')
      .select('content')
      .where('id', '=', (r.result as { contextPackId: string }).contextPackId)
      .executeTakeFirstOrThrow();
    const refs = (pack.content as { knowledge: { ref: string }[] }).knowledge.map((n) => n.ref);
    expect(refs).toContain(`${accepted.code}@1`);
  });
});

describe('taxonomy and confidence', () => {
  const axes = [
    {
      code: 'area',
      name: 'Área',
      categories: [
        { code: 'socios', name: 'Socios', description: 'Alta, baja y datos de los socios.' },
        { code: 'other', name: 'Other', description: 'Nada de lo anterior.' },
      ],
    },
  ];

  it('AC-CON-001-15 classification only uses the current approved taxonomy', async () => {
    const p = await newProject('Taxonomy');
    await decision(p, `Sin taxonomía ${unique()}`, 'Datos de los socios.');
    const proposal = await cmd(p, 'taxonomy.propose', { code: 'TAX-001', title: 'Taxonomy', axes });
    await decision(p, `Con borrador ${unique()}`, 'Datos de los socios.');
    expect(await s.db.selectFrom('classifications').select('id').where('project_id', '=', p).execute()).toHaveLength(0);
    await cmd(p, 'taxonomy.approve', {}, proposal.entityId);
    await decision(p, `Con aprobada ${unique()}`, 'Alta y datos de los socios.');
    const c = await s.db.selectFrom('classifications').selectAll().where('project_id', '=', p).execute();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ taxonomy_id: proposal.entityId, axis: 'area', category: 'socios', state: 'applied' });
  });

  it('AC-CON-001-15 a category or an axis outside the approved taxonomy reject the update with no effects', async () => {
    const p = await newProject('Closed taxonomy');
    const tx = await cmd(p, 'taxonomy.propose', { code: 'TAX-001', title: 'Taxonomy', axes });
    await cmd(p, 'taxonomy.approve', {}, tx.entityId);
    script.scripts.category = (items) => [
      ...items.map((i) => response(i.id, 'invented', 0.95)),
      response('ghost_axis', 'x', 0.99),
    ];
    const d = await decision(p, `Categorías ${unique()}`, 'Datos de los socios.');
    const u = (await updates(p)).at(-1);
    expect(u?.state).toBe('rejected');
    expect(u?.failure).toMatch(/"invented" is not a category of axis area/);
    expect(u?.failure).toMatch(/is not in the taxonomy: ghost_axis/);
    expect(await s.db.selectFrom('classifications').select('id').where('project_id', '=', p).execute()).toEqual([]);
    expect((await nodes(p)).some((n) => n.ref === `${d.code}@1`)).toBe(false);
    // The command doesn't admit it either, even when called directly.
    const data = {
      node_ref: `${d.code}@1`,
      taxonomy_id: tx.entityId,
      axis: 'area',
      category: 'invented',
      confidence: 0.9,
      justification: 'x',
      classifier: 'test@1',
      input_hash: 'h',
      update_id: null,
    };
    await expect(cmd(p, 'classification.record', data, undefined, UPDATER)).rejects.toMatchObject({
      type: 'guard',
      reasons: ['"invented" is not a category of axis area.'],
    });
  });

  it('AC-CON-001-13 the category cache distinguishes taxonomies with the same code and version but different content', async () => {
    const t = unique();
    const categories: string[][] = [];
    for (const cat of ['socios', 'dues']) {
      const p = await newProject(`Category cache ${cat}`);
      const tx = await cmd(p, 'taxonomy.propose', { code: 'TAX-001', title: 'Taxonomy', axes: axesWith(cat) });
      await cmd(p, 'taxonomy.approve', {}, tx.entityId);
      await decision(p, `Alta ${t}`, `Alta de los socios ${t}.`);
      const c = await s.db.selectFrom('classifications').select('category').where('project_id', '=', p).execute();
      categories.push(c.map((x) => x.category));
    }
    expect(script.calls.category).toBe(2);
    expect(categories[1]?.every((c) => ['dues', 'other'].includes(c))).toBe(true);
  });

  it('AC-CON-001-14 a low-confidence classification stays pending and appears in the inbox', async () => {
    const p = await newProject('Confidence');
    const tx = await cmd(p, 'taxonomy.propose', { code: 'TAX-001', title: 'Taxonomy', axes });
    await cmd(p, 'taxonomy.approve', {}, tx.entityId);
    script.scripts.category = (items) => items.map((i) => response(i.id, 'socios', 0.3, 'No estoy seguro.'));
    const d = await decision(p, `Dudosa ${unique()}`, 'Algo ambiguo.');
    const c = await s.db.selectFrom('classifications').selectAll().where('project_id', '=', p).executeTakeFirstOrThrow();
    expect(c).toMatchObject({ state: 'pending_review', confidence: 0.3 });
    const node = (await nodes(p)).find((n) => n.ref === `${d.code}@1`);
    expect(node?.categories).toEqual({});
    const b = await inbox(s.db, p);
    expect(b.classifications_to_review).toEqual([expect.objectContaining({ node_ref: `${d.code}@1`, category: 'socios' })]);
    // The person resolves it.
    await cmd(p, 'classification.resolve', { category: 'socios' }, c.id);
    expect((await inbox(s.db, p)).classifications_to_review).toHaveLength(0);
  });

  it('AC-CLA-001-04 without a reviewer, a medium-confidence relation is not applied and is noted on the update', async () => {
    const p = await newProject('Medium relation');
    const t = unique();
    const a = await decision(p, `Sede ${t}`, `La sede abre por la tarde ${t}.`);
    script.scripts.verdict = (items) => items.map((i) => response(i.id, 'relate', 0.6));
    await decision(p, `Sede en verano ${t}`, `La sede abre por la tarde en verano ${t}.`);
    const u = (await updates(p)).at(-1);
    expect(u?.state).toBe('applied');
    expect((await loadGraph(s.db, p)).edges.filter((x) => x.type === 'related')).toEqual([]);
    expect((u?.operations as { not_applied: unknown[] } | undefined)?.not_applied).toEqual([
      { ref: `${a.code}@1`, verdict: 'relate', confidence: 0.6, path: 'review_llm' },
    ]);
  });

  it('AC-CLA-001-04 the cascade passes medium confidence to the reviewer: if it raises it, the relation is applied', async () => {
    const cascade = createCascadeClassifier(fixed('base@1', 'relate', [0.9, 0.6, 0.3]), fixed('reviewer@1', 'relate', [0.95]));
    expect(cascade.id).toBe('base@1>reviewer@1');
    const items = ['DEC-AAA-001@1', 'DEC-BBB-001@1', 'DEC-CCC-001@1'].map((id) => ({
      id,
      state: 'x',
      question: '¿Qué le pasa?',
      options: VERDICTS,
    }));
    const responses = await cascade.choice(items);
    expect(responses.map((r) => [r.id, r.confidence, r.reviewedBy ?? null])).toEqual([
      ['DEC-AAA-001@1', 0.9, null],
      ['DEC-BBB-001@1', 0.95, 'reviewer@1'],
      ['DEC-CCC-001@1', 0.3, null],
    ]);
    // With the graph and the change, the medium reviewed upward is applied; the low one is noted without applying.
    const g: Graph = { version: 1, nodes: items.map((i) => testNode(i.id)), edges: [] };
    const { from: _d, until: _h, categories: _c, ...main } = testNode('DEC-NUE-001@1');
    const change: Change = { main, companions: [], edges: [], supersedes: [] };
    const plan = buildPlan(g, change, {}, responses, 2);
    expect(plan.newEdges.map((a) => a.to)).toEqual(['DEC-AAA-001@1', 'DEC-BBB-001@1']);
    expect(plan.notApplied.map((x) => [x.ref, x.path])).toEqual([['DEC-CCC-001@1', 'pending_person']]);
  });

  it('AC-CLA-001-04 the threshold cascade sends high confidence to apply, medium to review and low to the person', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ validFrom: 0.8, average: 0.55 });
    expect(routeByConfidence(0.95)).toBe('apply');
    expect(routeByConfidence(0.8)).toBe('apply');
    expect(routeByConfidence(0.6)).toBe('review_llm');
    expect(routeByConfidence(0.3)).toBe('pending_person');
  });
});

describe('the classifier does not touch authority', () => {
  it('AC-CON-001-12 an update only writes derived knowledge, classifications and proposals', async () => {
    const p = await newProject('Frontier');
    const t = unique();
    await decision(p, `Sede ${t}`, `La sede abre de lunes a viernes ${t}.`);
    const authority = async () => {
      const rows = await sql<{ t: string; n: number; h: string }>`
        select 'records' as t, count(*)::int as n, md5(string_agg(r::text, '' order by r.id)) as h from records r where project_id = ${p}::uuid
        union all select 'record_versions', count(*)::int, md5(string_agg(v::text, '' order by v.id)) from record_versions v where project_id = ${p}::uuid
        union all select 'criteria', count(*)::int, md5(string_agg(c::text, '' order by c.id)) from criteria c where project_id = ${p}::uuid
        union all select 'links', count(*)::int, md5(string_agg(l::text, '' order by l.id)) from links l where project_id = ${p}::uuid
        union all select 'taxonomies', count(*)::int, md5(string_agg(x::text, '' order by x.id)) from taxonomies x where project_id = ${p}::uuid
        union all select 'questions', count(*)::int, md5(string_agg(q::text, '' order by q.id)) from questions q where project_id = ${p}::uuid`.execute(
        s.db,
      );
      return rows.rows;
    };
    // A second decision on the same topic: reprojecting the first one, the second is a candidate.
    await decision(p, `Sede en verano ${t}`, `La sede abre de lunes a viernes en verano ${t}.`);
    script.scripts.verdict = (items) => items.map((i) => response(i.id, 'invalidate', 0.99));
    // An update on the first decision is enqueued by hand and processed: authority doesn't change.
    const before = await authority();
    const v = await s.db
      .selectFrom('record_versions')
      .select('id')
      .where('project_id', '=', p)
      .orderBy('id')
      .executeTakeFirstOrThrow();
    await executeCommand(s, {
      command: 'knowledge_update.enqueue',
      actor: UPDATER,
      projectId: p,
      data: { object: { type: 'record_version', id: v.id, version: 1 } },
    });
    expect(script.calls.verdict).toBeGreaterThan(0);
    expect((await updates(p)).at(-1)?.state).toBe('applied');
    expect(await authority()).toEqual(before);
    // What would have invalidated authority went out as a review proposal instead.
    expect((await inbox(s.db, p)).batches.filter((l) => l.type === 'knowledge')).toHaveLength(1);
  });

  it('AC-CON-001-12 the knowledge component does not execute authority commands even if the matrix allows them for system', async () => {
    const p = await newProject('Component');
    const d = await decision(p, `Aprobada ${unique()}`, 'Algo aprobado.');
    const supersede = (actor: Actor) =>
      executeCommand(s, { command: 'record_version.supersede', actor, projectId: p, entityId: d.versionId, data: {} });
    await expect(supersede(UPDATER)).rejects.toMatchObject({ type: 'forbidden' });
    // And no component supersedes an approved version without a later one approved.
    await expect(supersede(system('versions'))).rejects.toMatchObject({
      type: 'guard',
      reasons: ['An approved version is only superseded when a later one is approved.'],
    });
    const v = await s.db.selectFrom('record_versions').select('state').where('id', '=', d.versionId).executeTakeFirstOrThrow();
    expect(v.state).toBe('approved');
  });
});
