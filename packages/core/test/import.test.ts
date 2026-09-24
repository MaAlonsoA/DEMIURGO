// H1 preparado: importar el design/ real como lote pendiente, ratificarlo en un paso (solo una
// persona) y exportarlo sin diff. También AC-CON-001-10 (importador idempotente).

import {
  type Document,
  type RecordDocument,
  readTree,
  parseDocument,
  renderDocument,
  validateTree,
} from '@demiurgo/design';
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

/** Copia del árbol con un documento cambiado. */
function edit(base: Map<string, string>, path: string, change: (d: Document) => Document): Map<string, string> {
  const r = parseDocument(base.get(path) ?? '', path);
  if (!r.ok) throw new Error(`${path} no es válido`);
  const m = new Map(base);
  m.set(path, renderDocument(change(r.value)));
  return m;
}

const asRecord = (d: Document) => d as RecordDocument;
const approve = (d: Document) => ({ ...d, state: 'approved' as const });
const withVersion = (version: number, note: string) => (d: Document) => ({ ...asRecord(d), version, changeNote: note });

describe('importación de design/ (H1)', () => {
  it('AC-AUT-001-01 la importación crea un lote pendiente con los mismos recuentos que el origen y nada aprobado', async () => {
    const p = await project('H1 recuentos');
    const r = await runImport(p);
    const report = validateTree(tree);
    const expected = treeCounts(report.records, report.taxonomies);
    expect(r.result).toMatchObject({ counts: expected, proposals: report.records.length + report.taxonomies.length });
    const batch = await s.db.selectFrom('proposal_batches').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
    expect(batch).toMatchObject({ kind: 'import', resolution_mode: 'package', state: 'pending', producer: 'system:importador@1' });
    // Nada existe todavía como autoridad.
    expect(await s.db.selectFrom('records').select('id').where('project_id', '=', p).execute()).toHaveLength(0);
    expect(
      await s.db.selectFrom('record_versions').select('id').where('project_id', '=', p).where('state', '=', 'approved').execute(),
    ).toHaveLength(0);
  });

  it('AC-CON-001-10 importar dos veces design/ no duplica', async () => {
    const p = await project('H1 idempotente');
    const a = await runImport(p);
    const b = await runImport(p);
    expect(b.entityId).toBe(a.entityId);
    expect(b.result).toMatchObject({ duplicate: true });
    const batches = await s.db.selectFrom('proposal_batches').select('id').where('project_id', '=', p).execute();
    const proposals = await s.db.selectFrom('proposals').select('id').where('project_id', '=', p).execute();
    expect(batches).toHaveLength(1);
    expect(proposals).toHaveLength(validateTree(tree).records.length + validateTree(tree).taxonomies.length);
  });

  it('AC-AUT-001-02 ratificar con un actor no humano da 403 sin efectos', async () => {
    const p = await project('H1 solo persona');
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

  it('AC-AUT-001-03 ratificar en un paso crea todo con los estados del origen y la persona como actor', async () => {
    const p = await project('H1 ratificar');
    const r = await runImport(p);
    await ratify(p, r.entityId);
    const report = validateTree(tree);
    expect(await dbCounts(p)).toEqual(treeCounts(report.records, report.taxonomies));
    // Todo el design/ de D0 está «propuesto»: las versiones quedan en borrador.
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

  it('AC-AUT-001-04 tras ratificar, la exportación coincide byte a byte con design/', async () => {
    const p = await project('H1 exportar');
    await ratify(p, (await runImport(p)).entityId);
    expect(await compareExport(s.db, p, tree)).toEqual([]);
    const exported = await exportDesign(s.db, p);
    expect([...exported.keys()].sort()).toEqual([...tree.keys()].sort());
  });

  it('AC-AUT-001-04 con documentos aprobados en el origen, se aprueban al ratificar y la exportación sigue sin diff', async () => {
    const p = await project('H1 aprobados');
    // Simula el merge de la persona: aprueba la decisión y la taxonomía editando su estado.
    const approved = new Map(tree);
    for (const path of ['decisions/DEC-PLN-001.md', 'taxonomy/TAX-001.md']) {
      const doc = parseDocument(tree.get(path) ?? '', path);
      if (!doc.ok) throw new Error('documento inválido');
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

  it('AC-AUT-001-05 importar de nuevo tras ratificar no crea nada', async () => {
    const p = await project('H1 reimportar');
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

describe('reimportación y diseño en la v2 (revisión de H1)', () => {
  const FDR = 'fdr/FDR-AUT-001.md';

  it('AC-AUT-001-05 un cambio sin subir la versión se rechaza nombrando el documento; subiéndola se propone solo ese', async () => {
    const p = await project('H1 cambio sin versión');
    await ratify(p, (await runImport(p)).entityId);
    // Un enlace nuevo en la misma versión: la huella del contenido no bastaba para verlo.
    const withLink = (d: Document) => {
      const r = asRecord(d);
      return {
        ...r,
        links: [...r.links, { type: 'conflicts_with' as const, target: { code: 'ADR-FMT-001', version: 1 } }],
      };
    };
    await expect(runImport(p, edit(tree, FDR, withLink))).rejects.toMatchObject({
      type: 'guard',
      reasons: [`${FDR}: la versión 1 ya está en la v2 con otro contenido; sube la versión y añade nota_de_cambio.`],
    });
    const v2 = edit(tree, FDR, (d) => ({ ...withLink(d), version: 2, changeNote: 'Enlaza con el formato.' }));
    const r = await runImport(p, v2);
    expect(r.result).toMatchObject({ proposals: 1 });
    await ratify(p, r.entityId);
    expect(await compareExport(s.db, p, v2)).toEqual([]);
  });

  it('AC-AUT-001-05 un cambio solo de estado, también de la taxonomía, se ratifica y la exportación coincide', async () => {
    const p = await project('H1 solo estado');
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

  it('AC-AUT-001-04 una versión nueva aprobada en la v2 deja una exportación válida que, reimportada, no propone nada', async () => {
    const p = await project('H1 versión en la v2');
    await ratify(p, (await runImport(p)).entityId);
    const dec = await s.db
      .selectFrom('records')
      .select('id')
      .where('project_id', '=', p)
      .where('code', '=', 'DEC-PLN-001')
      .executeTakeFirstOrThrow();
    const original = parseDocument(tree.get('decisions/DEC-PLN-001.md') ?? '', 'dec');
    if (!original.ok) throw new Error('DEC-PLN-001 no es válido');
    const incoming = await executeCommand(s, {
      command: 'record_version.create',
      actor: ana,
      projectId: p,
      data: {
        record_id: dec.id,
        title: original.value.title,
        sections: original.value.sections,
        change_note: 'Se revisa el plan.',
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
    // Los documentos que se basan en DEC-PLN-001 siguen en su versión 1 hasta que la persona revise el enlace.
    expect(exported.get(FDR)).toContain('destino: DEC-PLN-001@1');
    await expect(runImport(p, exported)).rejects.toMatchObject({ type: 'conflict' });
  });

  it('AC-AUT-001-04 un registro creado en la v2 no comparte DOM-NNN con otro tipo: la exportación sigue siendo válida', async () => {
    const p = await project('H1 códigos');
    await ratify(p, (await runImport(p)).entityId);
    const fdr = {
      type: 'fdr',
      domain: 'core',
      title: 'El núcleo del Pilar 2',
      sections: [
        { title: 'Goal', content: 'o' },
        { title: 'Scope', content: 'a' },
        { title: 'Fuera de alcance', content: 'f' },
        { title: 'Behavior', content: 'c' },
      ],
      criteria: [
        {
          carry: 'new',
          title: 'Tasks',
          statement: 'Cuando se crea una tarea, entonces cubre un AC.',
          verification: 'automatic',
          check: 'Test.',
        },
      ],
    };
    const r = await executeCommand(s, { command: 'record.create', actor: ana, projectId: p, data: fdr });
    // ADR-NUC-001 ya existe: la FDR del mismo dominio recibe el siguiente número de NUC.
    expect((r.result as { code: string }).code).toBe('FDR-NUC-002');
    await expect(
      executeCommand(s, { command: 'record.create', actor: ana, projectId: p, data: { ...fdr, code: 'FDR-NUC-001' } }),
    ).rejects.toMatchObject({
      type: 'guard',
      reasons: ['FDR-NUC-001 comparte NUC-001 con ADR-NUC-001: la parte DOM-NNN de un código es única entre tipos.'],
    });
    expect(validateTree(await exportDesign(s.db, p)).problems).toEqual([]);
  });

  it('AC-AUT-001-04 un criterio con «Deriva de» sobrevive a la ida y vuelta', async () => {
    const p = await project('H1 deriva de');
    const withDerived = edit(tree, FDR, (d) => {
      const r = asRecord(d);
      const fresh = {
        code: 'AC-AUT-001-09',
        title: 'Reimportación sin efectos',
        verification: 'automática' as const,
        check: 'Se reimporta tras ratificar.',
        statement: 'Dado design/ ratificado, cuando se importa otra vez, entonces no se crea nada.',
        derivedFrom: 'AC-CON-001-10',
      };
      return { ...r, criteria: [...r.criteria, fresh] };
    });
    expect(validateTree(withDerived).problems).toEqual([]);
    await ratify(p, (await runImport(p, withDerived)).entityId);
    expect(await compareExport(s.db, p, withDerived)).toEqual([]);
  });

  it('AC-AUT-001-01 una importación nueva deja obsoleta la que seguía pendiente', async () => {
    const p = await project('H1 dos importaciones');
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

  it('AC-AUT-001-01 una persona puede importar: el importador produce el lote y ella queda en el evento', async () => {
    const p = await project('H1 importa una persona');
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
    expect(batch.producer).toBe('system:importador@1');
    const event = await s.db
      .selectFrom('events')
      .select('actor')
      .where('command', '=', 'design.import')
      .where('entity_id', '=', r.entityId)
      .executeTakeFirstOrThrow();
    expect(event.actor).toBe('human:ana');
  });

  it('AC-AUT-001-02 solo la importación propone documentos importados', async () => {
    const p = await project('H1 tipos importados');
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
        reasons: expect.arrayContaining(['Solo la importación de design/ propone «registro_importado».']),
      });
    }
  });

  it('AC-AUT-001-05 aprobar desde design/ una versión anterior a la aprobada en la v2 se rechaza al importar, también en la taxonomía', async () => {
    const p = await project('H1 aprobada posterior');
    await ratify(p, (await runImport(p)).entityId);
    const dec = await s.db
      .selectFrom('records')
      .select('id')
      .where('project_id', '=', p)
      .where('code', '=', 'DEC-PLN-001')
      .executeTakeFirstOrThrow();
    const original = parseDocument(tree.get('decisions/DEC-PLN-001.md') ?? '', 'dec');
    if (!original.ok) throw new Error('DEC-PLN-001 no es válido');
    const v2 = await executeCommand(s, {
      command: 'record_version.create',
      actor: ana,
      projectId: p,
      data: {
        record_id: dec.id,
        title: original.value.title,
        sections: original.value.sections,
        change_note: 'Revisión.',
      },
    });
    await executeCommand(s, {
      command: 'record_version.approve',
      actor: ana,
      projectId: p,
      entityId: v2.entityId,
      data: {},
    });
    // La taxonomía: una v2 aprobada en la v2.
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
    ).rejects.toMatchObject({ type: 'guard', reasons: ['Ya hay una versión aprobada posterior (v2) de esta taxonomía.'] });
    const old = edit(edit(tree, 'decisions/DEC-PLN-001.md', approve), 'taxonomy/TAX-001.md', approve);
    await expect(runImport(p, old)).rejects.toMatchObject({
      type: 'guard',
      reasons: [
        'decisions/DEC-PLN-001.md: la v2 ya tiene aprobada la versión 2; la 1 solo se puede descartar.',
        'taxonomy/TAX-001.md: la v2 ya tiene aprobada la versión 2; la 1 no se puede aprobar.',
      ],
    });
  });

  it('AC-AUT-001-05 lo que no se podría ratificar se rechaza al importar: estado hacia atrás, versión anterior, anexo cambiado, enlace a una versión que no está', async () => {
    const p = await project('H1 problemas al importar');
    const approved = edit(tree, 'decisions/DEC-PLN-001.md', approve);
    await ratify(p, (await runImport(p, approved)).entityId);
    // Volver a «propuesto» una versión aprobada.
    await expect(runImport(p, tree)).rejects.toMatchObject({
      reasons: ['decisions/DEC-PLN-001.md: la versión 1 está aprobada en la v2 y no puede pasar a «propuesto».'],
    });
    // Un anexo cambiado sin subir la versión de su registro.
    const annex = new Map(approved);
    annex.set('data/capabilities.yaml', `${approved.get('data/capabilities.yaml') ?? ''}# Comentario nuevo.\n`);
    await expect(runImport(p, annex)).rejects.toMatchObject({
      reasons: ['adr/ADR-NUC-001.md: la versión 1 ya está en la v2 con otro contenido; sube la versión y añade nota_de_cambio.'],
    });
    // Una versión anterior a la última de la v2.
    const v3 = edit(approved, 'decisions/DEC-PLN-001.md', withVersion(3, 'Tercera.'));
    await ratify(p, (await runImport(p, v3)).entityId);
    await expect(runImport(p, edit(approved, 'decisions/DEC-PLN-001.md', withVersion(2, 'Segunda.')))).rejects.toMatchObject({
      reasons: ['decisions/DEC-PLN-001.md: la versión 2 es anterior a la última de la v2 (3).'],
    });
    // Un enlace a una versión anterior que la v2 no tiene (proyecto nuevo).
    const q = await project('H1 enlace anterior');
    await expect(runImport(q, v3)).rejects.toMatchObject({
      reasons: expect.arrayContaining([
        `${FDR}: el enlace a DEC-PLN-001@1 apunta a una versión que no está en design/ ni en la v2.`,
      ]),
    });
  });

  it('AC-AUT-001-05 un código de AC descartado no vuelve, un código nuevo no comparte DOM-NNN con la v2 y «Deriva de» se conserva entre versiones', async () => {
    const p = await project('H1 criterios entre versiones');
    const fresh = {
      code: 'AC-AUT-001-09',
      title: 'Reimportación sin efectos',
      verification: 'automática' as const,
      check: 'Se reimporta tras ratificar.',
      statement: 'Dado design/ ratificado, cuando se importa otra vez, entonces no se crea nada.',
      derivedFrom: 'AC-CON-001-10',
    };
    const v1 = edit(tree, FDR, (d) => ({ ...asRecord(d), criteria: [...asRecord(d).criteria, fresh] }));
    await ratify(p, (await runImport(p, v1)).entityId);
    // v2 conserva el criterio derivado y descarta AC-AUT-001-08: la exportación coincide.
    const v2 = edit(v1, FDR, (d) => {
      const r = asRecord(d);
      return {
        ...r,
        version: 2,
        changeNote: 'Sin AC-AUT-001-08.',
        criteria: r.criteria.filter((c) => c.code !== 'AC-AUT-001-08'),
      };
    });
    await ratify(p, (await runImport(p, v2)).entityId);
    expect(await compareExport(s.db, p, v2)).toEqual([]);
    // v3 no puede recuperar AC-AUT-001-08 ni cambiar la derivación de AC-AUT-001-09.
    const v3 = edit(v1, FDR, (d) => {
      const r = asRecord(d);
      return {
        ...r,
        version: 3,
        changeNote: 'Vuelve AC-AUT-001-08.',
        criteria: r.criteria.map((c) => (c.code === 'AC-AUT-001-09' ? { ...c, derivedFrom: 'AC-CON-001-01' } : c)),
      };
    });
    await expect(runImport(p, v3)).rejects.toMatchObject({
      reasons: [
        `${FDR}: AC-AUT-001-08 ya se usó en una versión anterior; un criterio nuevo lleva un código nuevo.`,
        `${FDR}: AC-AUT-001-09 cambia su «Deriva de»; un criterio que se mantiene o se modifica conserva su derivación.`,
      ],
    });
    // Un registro nuevo de design/ que comparte DOM-NNN con uno creado en la v2.
    await executeCommand(s, {
      command: 'record.create',
      actor: ana,
      projectId: p,
      data: {
        type: 'adr',
        code: 'ADR-ZET-001',
        domain: 'zeta',
        title: 'Solo en la v2',
        sections: [
          { title: 'Context', content: 'c' },
          { title: 'Options', content: 'o' },
          { title: 'Decisión', content: 'd' },
          { title: 'Consequences', content: 'k' },
        ],
        criteria: [
          {
            carry: 'new',
            title: 'T',
            statement: 'Cuando pasa, entonces se ve.',
            verification: 'automatic',
            check: 'P.',
          },
        ],
      },
    });
    const withZet = new Map(v2);
    const dec = parseDocument(tree.get('decisions/DEC-PLN-001.md') ?? '', 'dec');
    if (!dec.ok) throw new Error('DEC-PLN-001 no es válido');
    withZet.set(
      'decisions/DEC-ZET-001.md',
      renderDocument({ ...asRecord(dec.value), code: 'DEC-ZET-001', domain: 'zeta', links: [] }),
    );
    await expect(runImport(p, withZet)).rejects.toMatchObject({
      reasons: ['decisions/DEC-ZET-001.md: DEC-ZET-001 comparte ZET-001 con ADR-ZET-001, que ya está en la v2.'],
    });
  });

  it('AC-AUT-001-05 si la versión cambia en la v2 entre importar y ratificar, ratificar se rechaza sin efectos', async () => {
    const p = await project('H1 cambio antes de ratificar');
    await ratify(p, (await runImport(p)).entityId);
    const batch = await runImport(p, edit(tree, 'decisions/DEC-PLN-001.md', approve));
    // Simula un cambio fuera de la importación: un enlace nuevo en el borrador de DEC-PLN-001.
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
