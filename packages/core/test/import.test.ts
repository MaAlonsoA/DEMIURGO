// H1 ready: import the real design/ tree as a pending batch, ratify it in one step (only a
// person can) and export it back with no diff. Also AC-CON-001-10 (idempotent importer).

import { type Document, type RecordDocument, readTree, parseDocument, renderDocument, validateTree } from '@demiurgo/design';
import { type Actor, externalAgent, agentRun, human, system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { compareExport, exportDesign } from '../src/design/export.ts';
import { IMPORTER, treeCounts } from '../src/design/import.ts';
import type { Services } from '../src/services.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');
let s: Services;
let tree: Map<string, string>;

beforeAll(async () => {
  s = environment().services;
  tree = await readTree('design');
});

async function project(name: string): Promise<string> {
  return (await executeCommand(s, { command: 'project.create', actor: system('cli'), data: { name } })).projectId;
}

const runImport = (projectId: string, a: Map<string, string> = tree) =>
  executeCommand(s, {
    command: 'design.import',
    actor: IMPORTER,
    projectId,
    data: { tree: Object.fromEntries(a), origin: 'test' },
  });

const ratify = (projectId: string, batchId: string, actor: Actor = ana) =>
  executeCommand(s, { command: 'batch.accept_package', actor, projectId, entityId: batchId, data: {} });

async function dbCounts(projectId: string) {
  const records = await s.db.selectFrom('records').select('type').where('project_id', '=', projectId).execute();
  const n = (t: string) => records.filter((r) => r.type === t).length;
  const count = async (table: 'criteria' | 'links' | 'taxonomies') =>
    Number(
      (
        await s.db
          .selectFrom(table)
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('project_id', '=', projectId)
          .executeTakeFirstOrThrow()
      ).n,
    );
  const versions = await s.db.selectFrom('record_versions').select('annexes').where('project_id', '=', projectId).execute();
  return {
    decision: n('decision'),
    adr: n('adr'),
    fdr: n('fdr'),
    bug: n('bug'),
    versions: versions.length,
    criteria: await count('criteria'),
    links: await count('links'),
    taxonomies: await count('taxonomies'),
    annexes: versions.reduce((k, v) => k + (v.annexes as unknown[]).length, 0),
  };
}

/** Copy of the tree with one document changed. */
function edit(base: Map<string, string>, path: string, change: (d: Document) => Document): Map<string, string> {
  const r = parseDocument(base.get(path) ?? '', path);
  if (!r.ok) throw new Error(`${path} is not valid`);
  const m = new Map(base);
  m.set(path, renderDocument(change(r.value)));
  return m;
}

const asRecord = (d: Document) => d as RecordDocument;
const approve = (d: Document) => ({ ...d, state: 'approved' as const });
const withVersion = (version: number, note: string) => (d: Document) => ({ ...asRecord(d), version, changeNote: note });

describe('design/ import (H1)', () => {
  it('AC-AUT-001-01 the import creates a pending batch with the same counts as the source and nothing approved', async () => {
    const p = await project('H1 counts');
    const r = await runImport(p);
    const report = validateTree(tree);
    const expected = treeCounts(report.records, report.taxonomies);
    expect(r.result).toMatchObject({ counts: expected, proposals: report.records.length + report.taxonomies.length });
    const batch = await s.db.selectFrom('proposal_batches').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
    expect(batch).toMatchObject({ kind: 'import', resolution_mode: 'package', state: 'pending', producer: 'system:importer@1' });
    // Nothing exists yet as authority.
    expect(await s.db.selectFrom('records').select('id').where('project_id', '=', p).execute()).toHaveLength(0);
    expect(
      await s.db.selectFrom('record_versions').select('id').where('project_id', '=', p).where('state', '=', 'approved').execute(),
    ).toHaveLength(0);
  });

  it('AC-CON-001-10 importing design/ twice does not duplicate', async () => {
    const p = await project('H1 idempotent');
    const a = await runImport(p);
    const b = await runImport(p);
    expect(b.entityId).toBe(a.entityId);
    expect(b.result).toMatchObject({ duplicate: true });
    const batches = await s.db.selectFrom('proposal_batches').select('id').where('project_id', '=', p).execute();
    const proposals = await s.db.selectFrom('proposals').select('id').where('project_id', '=', p).execute();
    expect(batches).toHaveLength(1);
    expect(proposals).toHaveLength(validateTree(tree).records.length + validateTree(tree).taxonomies.length);
  });

  it('AC-AUT-001-02 ratifying with a non-human actor gives 403 with no effects', async () => {
    const p = await project('H1 person only');
    const r = await runImport(p);
    const events = async () => (await s.db.selectFrom('events').select('id').where('project_id', '=', p).execute()).length;
    const before = await events();
    for (const actor of [
      externalAgent('claude-code', 's'),
      agentRun('00000000-0000-7000-8000-000000000009'),
      system('importer'),
    ]) {
      await expect(ratify(p, r.entityId, actor)).rejects.toMatchObject({ type: 'forbidden' });
    }
    expect(await events()).toBe(before);
    expect(await s.db.selectFrom('records').select('id').where('project_id', '=', p).execute()).toHaveLength(0);
  });

  it("AC-AUT-001-03 ratifying in one step creates everything with the source's states and the person as actor", async () => {
    const p = await project('H1 ratify');
    const r = await runImport(p);
    await ratify(p, r.entityId);
    const report = validateTree(tree);
    expect(await dbCounts(p)).toEqual(treeCounts(report.records, report.taxonomies));
    // All of D0's design/ is "proposed": the versions stay in draft.
    const states = await s.db.selectFrom('record_versions').select('state').where('project_id', '=', p).execute();
    expect(new Set(states.map((e) => e.state))).toEqual(new Set(['draft']));
    const actors = await s.db
      .selectFrom('events')
      .select(['command', 'actor'])
      .where('project_id', '=', p)
      .where('command', 'in', [
        'batch.accept_package',
        'proposal.accept',
        'record.create',
        'record_version.create',
        'criterion.record',
        'link.create',
        'taxonomy.propose',
      ])
      .execute();
    expect(actors.length).toBeGreaterThan(20);
    expect(actors.every((e) => e.actor === 'human:ana')).toBe(true);
    const batch = await s.db
      .selectFrom('proposal_batches')
      .select('state')
      .where('id', '=', r.entityId)
      .executeTakeFirstOrThrow();
    expect(batch.state).toBe('accepted');
  });

  it('AC-AUT-001-04 after ratifying, the export matches design/ byte for byte', async () => {
    const p = await project('H1 export');
    await ratify(p, (await runImport(p)).entityId);
    expect(await compareExport(s.db, p, tree)).toEqual([]);
    const exported = await exportDesign(s.db, p);
    expect([...exported.keys()].sort()).toEqual([...tree.keys()].sort());
  });

  it('AC-AUT-001-04 with approved documents in the source, they get approved on ratifying and the export still has no diff', async () => {
    const p = await project('H1 approved');
    // Simulates the person's merge: approves the decision and the taxonomy by editing their state.
    const approved = new Map(tree);
    for (const path of ['decisions/DEC-PLN-001.md', 'taxonomy/TAX-001.md']) {
      const doc = parseDocument(tree.get(path) ?? '', path);
      if (!doc.ok) throw new Error('invalid document');
      approved.set(path, renderDocument({ ...doc.value, state: 'approved' }));
    }
    await ratify(p, (await runImport(p, approved)).entityId);
    const dec = await s.db
      .selectFrom('record_versions')
      .innerJoin('records', 'records.id', 'record_versions.record_id')
      .select(['record_versions.state', 'record_versions.approved_by'])
      .where('records.project_id', '=', p)
      .where('records.code', '=', 'DEC-PLN-001')
      .executeTakeFirstOrThrow();
    expect(dec).toEqual({ state: 'approved', approved_by: 'human:ana' });
    const tax = await s.db
      .selectFrom('taxonomies')
      .select(['state', 'approved_by'])
      .where('project_id', '=', p)
      .executeTakeFirstOrThrow();
    expect(tax).toEqual({ state: 'approved', approved_by: 'human:ana' });
    expect(await compareExport(s.db, p, approved)).toEqual([]);
  });

  it('AC-AUT-001-05 importing again after ratifying creates nothing', async () => {
    const p = await project('H1 re-import');
    const r = await runImport(p);
    await ratify(p, r.entityId);
    const before = await dbCounts(p);
    const other = await runImport(p);
    expect(other.entityId).toBe(r.entityId);
    expect(other.result).toMatchObject({ duplicate: true, state: 'accepted' });
    expect(await dbCounts(p)).toEqual(before);
    expect(
      await s.db.selectFrom('proposal_batches').select('id').where('project_id', '=', p).where('kind', '=', 'import').execute(),
    ).toHaveLength(1);
  });
});

describe('re-import and design in the v2 (H1 review)', () => {
  const FDR = 'fdr/FDR-AUT-001.md';

  it('AC-AUT-001-05 a change without bumping the version is rejected naming the document; bumping it proposes only that one', async () => {
    const p = await project('H1 change without version');
    await ratify(p, (await runImport(p)).entityId);
    // A new link in the same version: the content fingerprint alone was not enough to see it.
    const withLink = (d: Document) => {
      const r = asRecord(d);
      return {
        ...r,
        links: [...r.links, { type: 'conflicts_with' as const, target: { code: 'ADR-FMT-001', version: 1 } }],
      };
    };
    await expect(runImport(p, edit(tree, FDR, withLink))).rejects.toMatchObject({
      type: 'guard',
      reasons: [`${FDR}: version 1 is already in the v2 with different content; bump the version and add a change_note.`],
    });
    const v2 = edit(tree, FDR, (d) => ({ ...withLink(d), version: 2, changeNote: 'Links to the format.' }));
    const r = await runImport(p, v2);
    expect(r.result).toMatchObject({ proposals: 1 });
    await ratify(p, r.entityId);
    expect(await compareExport(s.db, p, v2)).toEqual([]);
  });

  it('AC-AUT-001-05 a change only in state, also in the taxonomy, gets ratified and the export matches', async () => {
    const p = await project('H1 state only');
    await ratify(p, (await runImport(p)).entityId);
    let approved = tree;
    for (const path of ['decisions/DEC-PLN-001.md', 'taxonomy/TAX-001.md']) {
      approved = edit(approved, path, (d) => ({ ...d, state: 'approved' }));
    }
    const r = await runImport(p, approved);
    expect(r.result).toMatchObject({ proposals: 2 });
    await ratify(p, r.entityId);
    const tax = await s.db.selectFrom('taxonomies').select('state').where('project_id', '=', p).execute();
    expect(tax.map((t) => t.state)).toEqual(['approved']);
    expect(await compareExport(s.db, p, approved)).toEqual([]);
  });

  it('AC-AUT-001-04 a new version approved in the v2 leaves a valid export that, reimported, proposes nothing', async () => {
    const p = await project('H1 version in the v2');
    await ratify(p, (await runImport(p)).entityId);
    const dec = await s.db
      .selectFrom('records')
      .select('id')
      .where('project_id', '=', p)
      .where('code', '=', 'DEC-PLN-001')
      .executeTakeFirstOrThrow();
    const original = parseDocument(tree.get('decisions/DEC-PLN-001.md') ?? '', 'dec');
    if (!original.ok) throw new Error('DEC-PLN-001 is not valid');
    const incoming = await executeCommand(s, {
      command: 'record_version.create',
      actor: ana,
      projectId: p,
      data: {
        record_id: dec.id,
        title: original.value.title,
        sections: original.value.sections,
        change_note: 'The plan is reviewed.',
      },
    });
    await executeCommand(s, {
      command: 'record_version.approve',
      actor: ana,
      projectId: p,
      entityId: incoming.entityId,
      data: {},
    });
    const exported = await exportDesign(s.db, p);
    expect(validateTree(exported).problems).toEqual([]);
    // Documents based on DEC-PLN-001 stay on their version 1 until the person reviews the link.
    expect(exported.get(FDR)).toContain('target: DEC-PLN-001@1');
    await expect(runImport(p, exported)).rejects.toMatchObject({ type: 'conflict' });
  });

  it('AC-AUT-001-04 a record created in the v2 does not share DOM-NNN with another type: the export stays valid', async () => {
    const p = await project('H1 codes');
    await ratify(p, (await runImport(p)).entityId);
    const fdr = {
      type: 'fdr',
      domain: 'nucleo',
      title: 'The core of Pillar 2',
      sections: [
        { title: 'Goal', content: 'o' },
        { title: 'Scope', content: 'a' },
        { title: 'Out of scope', content: 'f' },
        { title: 'Behavior', content: 'c' },
      ],
      criteria: [
        {
          carry: 'new',
          title: 'Tasks',
          statement: 'When a task is created, then it covers an AC.',
          verification: 'automatic',
          check: 'Test.',
        },
      ],
    };
    const r = await executeCommand(s, { command: 'record.create', actor: ana, projectId: p, data: fdr });
    // ADR-NUC-001 already exists: the FDR in the same domain gets the next NUC number.
    expect((r.result as { code: string }).code).toBe('FDR-NUC-002');
    await expect(
      executeCommand(s, { command: 'record.create', actor: ana, projectId: p, data: { ...fdr, code: 'FDR-NUC-001' } }),
    ).rejects.toMatchObject({
      type: 'guard',
      reasons: ['FDR-NUC-001 shares NUC-001 with ADR-NUC-001: the DOM-NNN part of a code is unique across types.'],
    });
    expect(validateTree(await exportDesign(s.db, p)).problems).toEqual([]);
  });

  it('AC-AUT-001-04 a criterion with "Derived from" survives the round trip', async () => {
    const p = await project('H1 derived from');
    const withDerived = edit(tree, FDR, (d) => {
      const r = asRecord(d);
      const fresh = {
        code: 'AC-AUT-001-09',
        title: 'Re-import with no effects',
        verification: 'automatic' as const,
        check: 'It is reimported after ratifying.',
        statement: 'Given design/ ratified, when it is imported again, then nothing is created.',
        derivedFrom: 'AC-CON-001-10',
      };
      return { ...r, criteria: [...r.criteria, fresh] };
    });
    expect(validateTree(withDerived).problems).toEqual([]);
    await ratify(p, (await runImport(p, withDerived)).entityId);
    expect(await compareExport(s.db, p, withDerived)).toEqual([]);
  });

  it('AC-AUT-001-01 a new import makes the one that was still pending obsolete', async () => {
    const p = await project('H1 two imports');
    const first = await runImport(p);
    const second = await runImport(
      p,
      edit(tree, 'decisions/DEC-PLN-001.md', (d) => ({ ...d, state: 'approved' })),
    );
    const state = async (id: string) =>
      (await s.db.selectFrom('proposal_batches').select('state').where('id', '=', id).executeTakeFirstOrThrow()).state;
    expect(await state(first.entityId)).toBe('superseded');
    expect(await state(second.entityId)).toBe('pending');
    await ratify(p, second.entityId);
  });

  it('AC-AUT-001-01 a person can import: the importer produces the batch and she is recorded in the event', async () => {
    const p = await project('H1 a person imports');
    const r = await executeCommand(s, {
      command: 'design.import',
      actor: ana,
      projectId: p,
      data: { tree: Object.fromEntries(tree) },
    });
    const batch = await s.db
      .selectFrom('proposal_batches')
      .select('producer')
      .where('id', '=', r.entityId)
      .executeTakeFirstOrThrow();
    expect(batch.producer).toBe('system:importer@1');
    const event = await s.db
      .selectFrom('events')
      .select('actor')
      .where('command', '=', 'design.import')
      .where('entity_id', '=', r.entityId)
      .executeTakeFirstOrThrow();
    expect(event.actor).toBe('human:ana');
  });

  it('AC-AUT-001-02 only the import proposes imported documents', async () => {
    const p = await project('H1 imported types');
    const report = validateTree(tree);
    const document = { ...report.records[0], annexesContent: [] };
    for (const actor of [system('test'), system('knowledge')]) {
      await expect(
        executeCommand(s, {
          command: 'batch.submit',
          actor,
          projectId: p,
          data: { proposals: [{ type: 'imported_record', payload: { document, path: 'x' } }] },
        }),
      ).rejects.toMatchObject({
        type: 'guard',
        reasons: expect.arrayContaining(['Only the design/ importer proposes "imported_record".']),
      });
    }
  });

  it('AC-AUT-001-05 approving from design/ a version earlier than the one approved in the v2 is rejected on import, also for the taxonomy', async () => {
    const p = await project('H1 later approved');
    await ratify(p, (await runImport(p)).entityId);
    const dec = await s.db
      .selectFrom('records')
      .select('id')
      .where('project_id', '=', p)
      .where('code', '=', 'DEC-PLN-001')
      .executeTakeFirstOrThrow();
    const original = parseDocument(tree.get('decisions/DEC-PLN-001.md') ?? '', 'dec');
    if (!original.ok) throw new Error('DEC-PLN-001 is not valid');
    const v2 = await executeCommand(s, {
      command: 'record_version.create',
      actor: ana,
      projectId: p,
      data: {
        record_id: dec.id,
        title: original.value.title,
        sections: original.value.sections,
        change_note: 'Revision.',
      },
    });
    await executeCommand(s, {
      command: 'record_version.approve',
      actor: ana,
      projectId: p,
      entityId: v2.entityId,
      data: {},
    });
    // The taxonomy: a v2 approved in the v2.
    const tax = await s.db.selectFrom('taxonomies').selectAll().where('project_id', '=', p).executeTakeFirstOrThrow();
    const taxV2 = await executeCommand(s, {
      command: 'taxonomy.propose',
      actor: ana,
      projectId: p,
      data: { code: tax.code, title: tax.title, axes: tax.axes, sections: tax.sections, version: 2 },
    });
    await executeCommand(s, { command: 'taxonomy.approve', actor: ana, projectId: p, entityId: taxV2.entityId, data: {} });
    await expect(
      executeCommand(s, { command: 'taxonomy.approve', actor: ana, projectId: p, entityId: tax.id, data: {} }),
    ).rejects.toMatchObject({ type: 'guard', reasons: ['A later approved version (v2) of this taxonomy already exists.'] });
    const old = edit(edit(tree, 'decisions/DEC-PLN-001.md', approve), 'taxonomy/TAX-001.md', approve);
    await expect(runImport(p, old)).rejects.toMatchObject({
      type: 'guard',
      reasons: [
        'decisions/DEC-PLN-001.md: the v2 already has version 2 approved; 1 can only be discarded.',
        'taxonomy/TAX-001.md: the v2 already has version 2 approved; 1 cannot be approved.',
      ],
    });
  });

  it('AC-AUT-001-05 what could not be ratified is rejected on import: state going backwards, earlier version, changed annex, link to a version that is not there', async () => {
    const p = await project('H1 problems on import');
    const approved = edit(tree, 'decisions/DEC-PLN-001.md', approve);
    await ratify(p, (await runImport(p, approved)).entityId);
    // Moving an approved version back to "proposed".
    await expect(runImport(p, tree)).rejects.toMatchObject({
      reasons: ['decisions/DEC-PLN-001.md: version 1 is approved in the v2 and cannot move to "proposed".'],
    });
    // A changed annex without bumping its record's version.
    const annex = new Map(approved);
    annex.set('data/capabilities.yaml', `${approved.get('data/capabilities.yaml') ?? ''}# New comment.\n`);
    await expect(runImport(p, annex)).rejects.toMatchObject({
      reasons: [
        'adr/ADR-NUC-001.md: version 1 is already in the v2 with different content; bump the version and add a change_note.',
      ],
    });
    // A version earlier than the latest in the v2.
    const v3 = edit(approved, 'decisions/DEC-PLN-001.md', withVersion(3, 'Third.'));
    await ratify(p, (await runImport(p, v3)).entityId);
    await expect(runImport(p, edit(approved, 'decisions/DEC-PLN-001.md', withVersion(2, 'Second.')))).rejects.toMatchObject({
      reasons: ['decisions/DEC-PLN-001.md: version 2 is older than the latest in the v2 (3).'],
    });
    // A link to an earlier version that the v2 does not have (new project).
    const q = await project('H1 earlier link');
    await expect(runImport(q, v3)).rejects.toMatchObject({
      reasons: expect.arrayContaining([
        `${FDR}: the link to DEC-PLN-001@1 points to a version that is not in design/ or the v2.`,
      ]),
    });
  });

  it('AC-AUT-001-05 a discarded AC code does not come back, a new code does not share DOM-NNN with the v2, and "Derived from" is kept across versions', async () => {
    const p = await project('H1 criteria across versions');
    const fresh = {
      code: 'AC-AUT-001-09',
      title: 'Re-import with no effects',
      verification: 'automatic' as const,
      check: 'It is reimported after ratifying.',
      statement: 'Given design/ ratified, when it is imported again, then nothing is created.',
      derivedFrom: 'AC-CON-001-10',
    };
    const v1 = edit(tree, FDR, (d) => ({ ...asRecord(d), criteria: [...asRecord(d).criteria, fresh] }));
    await ratify(p, (await runImport(p, v1)).entityId);
    // v2 keeps the derived criterion and discards AC-AUT-001-08: the export matches.
    const v2 = edit(v1, FDR, (d) => {
      const r = asRecord(d);
      return {
        ...r,
        version: 2,
        changeNote: 'Without AC-AUT-001-08.',
        criteria: r.criteria.filter((c) => c.code !== 'AC-AUT-001-08'),
      };
    });
    await ratify(p, (await runImport(p, v2)).entityId);
    expect(await compareExport(s.db, p, v2)).toEqual([]);
    // v3 cannot bring back AC-AUT-001-08 or change AC-AUT-001-09's derivation.
    const v3 = edit(v1, FDR, (d) => {
      const r = asRecord(d);
      return {
        ...r,
        version: 3,
        changeNote: 'Brings back AC-AUT-001-08.',
        criteria: r.criteria.map((c) => (c.code === 'AC-AUT-001-09' ? { ...c, derivedFrom: 'AC-CON-001-01' } : c)),
      };
    });
    await expect(runImport(p, v3)).rejects.toMatchObject({
      reasons: [
        `${FDR}: AC-AUT-001-08 was already used in a previous version; a new criterion needs a new code.`,
        `${FDR}: AC-AUT-001-09 changes its "Derived from"; a criterion that is kept or modified keeps its derivation.`,
      ],
    });
    // A new record from design/ that shares DOM-NNN with one created in the v2.
    await executeCommand(s, {
      command: 'record.create',
      actor: ana,
      projectId: p,
      data: {
        type: 'adr',
        code: 'ADR-ZET-001',
        domain: 'zeta',
        title: 'Only in the v2',
        sections: [
          { title: 'Context', content: 'c' },
          { title: 'Options', content: 'o' },
          { title: 'Decision', content: 'd' },
          { title: 'Consequences', content: 'k' },
        ],
        criteria: [
          {
            carry: 'new',
            title: 'T',
            statement: 'When it happens, then it is seen.',
            verification: 'automatic',
            check: 'P.',
          },
        ],
      },
    });
    const withZet = new Map(v2);
    const dec = parseDocument(tree.get('decisions/DEC-PLN-001.md') ?? '', 'dec');
    if (!dec.ok) throw new Error('DEC-PLN-001 is not valid');
    withZet.set(
      'decisions/DEC-ZET-001.md',
      renderDocument({ ...asRecord(dec.value), code: 'DEC-ZET-001', domain: 'zeta', links: [] }),
    );
    await expect(runImport(p, withZet)).rejects.toMatchObject({
      reasons: ['decisions/DEC-ZET-001.md: DEC-ZET-001 shares ZET-001 with ADR-ZET-001, which is already in the v2.'],
    });
  });

  it('AC-AUT-001-05 if the version changes in the v2 between importing and ratifying, ratifying is rejected with no effects', async () => {
    const p = await project('H1 change before ratifying');
    await ratify(p, (await runImport(p)).entityId);
    const batch = await runImport(p, edit(tree, 'decisions/DEC-PLN-001.md', approve));
    // Simulates a change outside the import: a new link in DEC-PLN-001's draft.
    const v = await s.db
      .selectFrom('record_versions')
      .innerJoin('records', 'records.id', 'record_versions.record_id')
      .select(['record_versions.id'])
      .where('records.project_id', '=', p)
      .where('records.code', 'in', ['DEC-PLN-001', 'ADR-FMT-001'])
      .orderBy('records.code', 'desc')
      .execute();
    await sql`insert into links (project_id, type, from_type, from_id, from_version, to_type, to_id, to_version, state, created_by)
      values (${p}::uuid, 'conflicts_with', 'record_version', ${v[0]?.id ?? ''}::uuid, 1, 'record_version', ${v[1]?.id ?? ''}::uuid, 1, 'current', 'human:ana')`.execute(
      s.db,
    );
    await expect(ratify(p, batch.entityId)).rejects.toMatchObject({ type: 'conflict' });
    const state = await s.db
      .selectFrom('proposal_batches')
      .select('state')
      .where('id', '=', batch.entityId)
      .executeTakeFirstOrThrow();
    expect(state.state).toBe('pending');
  });
});
