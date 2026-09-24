// H1 preparado: importar el design/ real como lote pendiente, ratificarlo en un paso (solo una
// persona) y exportarlo sin diff. También AC-CON-001-10 (importador idempotente).

import {
  type Documento,
  type DocumentoRegistro,
  leerArbol,
  parsearDocumento,
  renderizarDocumento,
  validarArbol,
} from '@demiurgo/design';
import { type Actor, agenteExterno, agenteRun, humano, sistema } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { ejecutarComando } from '../src/bus/bus.ts';
import { compararExportacion, exportarDiseno } from '../src/diseno/exportar.ts';
import { IMPORTADOR, recuentosDelArbol } from '../src/diseno/importar.ts';
import type { Servicios } from '../src/servicios.ts';
import { usarEntorno } from './soporte/entorno.ts';

const entorno = usarEntorno();
const ana = humano('ana');
let s: Servicios;
let arbol: Map<string, string>;

beforeAll(async () => {
  s = entorno().servicios;
  arbol = await leerArbol('design');
});

async function proyecto(nombre: string): Promise<string> {
  return (await ejecutarComando(s, { comando: 'project.create', actor: sistema('cli'), datos: { nombre } })).proyectoId;
}

const importar = (proyectoId: string, a: Map<string, string> = arbol) =>
  ejecutarComando(s, {
    comando: 'design.import',
    actor: IMPORTADOR,
    proyectoId,
    datos: { arbol: Object.fromEntries(a), origen: 'prueba' },
  });

const ratificar = (proyectoId: string, loteId: string, actor: Actor = ana) =>
  ejecutarComando(s, { comando: 'batch.accept_package', actor, proyectoId, entidadId: loteId, datos: {} });

async function recuentosEnBase(proyectoId: string) {
  const registros = await s.db.selectFrom('records').select('type').where('project_id', '=', proyectoId).execute();
  const n = (t: string) => registros.filter((r) => r.type === t).length;
  const contar = async (tabla: 'criteria' | 'links' | 'taxonomies') =>
    Number(
      (
        await s.db
          .selectFrom(tabla)
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('project_id', '=', proyectoId)
          .executeTakeFirstOrThrow()
      ).n,
    );
  const versiones = await s.db.selectFrom('record_versions').select('annexes').where('project_id', '=', proyectoId).execute();
  return {
    decision: n('decision'),
    adr: n('adr'),
    fdr: n('fdr'),
    bug: n('bug'),
    versiones: versiones.length,
    criterios: await contar('criteria'),
    enlaces: await contar('links'),
    taxonomias: await contar('taxonomies'),
    anexos: versiones.reduce((k, v) => k + (v.annexes as unknown[]).length, 0),
  };
}

/** Copia del árbol con un documento cambiado. */
function editar(base: Map<string, string>, ruta: string, cambio: (d: Documento) => Documento): Map<string, string> {
  const r = parsearDocumento(base.get(ruta) ?? '', ruta);
  if (!r.ok) throw new Error(`${ruta} no es válido`);
  const m = new Map(base);
  m.set(ruta, renderizarDocumento(cambio(r.valor)));
  return m;
}

const comoRegistro = (d: Documento) => d as DocumentoRegistro;
const aprobar = (d: Documento) => ({ ...d, estado: 'aprobado' as const });
const conVersion = (version: number, nota: string) => (d: Documento) => ({ ...comoRegistro(d), version, notaDeCambio: nota });

describe('importación de design/ (H1)', () => {
  it('AC-AUT-001-01 la importación crea un lote pendiente con los mismos recuentos que el origen y nada aprobado', async () => {
    const p = await proyecto('H1 recuentos');
    const r = await importar(p);
    const informe = validarArbol(arbol);
    const esperados = recuentosDelArbol(informe.registros, informe.taxonomias);
    expect(r.resultado).toMatchObject({ recuentos: esperados, propuestas: informe.registros.length + informe.taxonomias.length });
    const lote = await s.db.selectFrom('proposal_batches').selectAll().where('id', '=', r.entidadId).executeTakeFirstOrThrow();
    expect(lote).toMatchObject({ kind: 'import', resolution_mode: 'package', state: 'pending', producer: 'system:importador@1' });
    // Nada existe todavía como autoridad.
    expect(await s.db.selectFrom('records').select('id').where('project_id', '=', p).execute()).toHaveLength(0);
    expect(
      await s.db.selectFrom('record_versions').select('id').where('project_id', '=', p).where('state', '=', 'approved').execute(),
    ).toHaveLength(0);
  });

  it('AC-CON-001-10 importar dos veces design/ no duplica', async () => {
    const p = await proyecto('H1 idempotente');
    const a = await importar(p);
    const b = await importar(p);
    expect(b.entidadId).toBe(a.entidadId);
    expect(b.resultado).toMatchObject({ repetida: true });
    const lotes = await s.db.selectFrom('proposal_batches').select('id').where('project_id', '=', p).execute();
    const propuestas = await s.db.selectFrom('proposals').select('id').where('project_id', '=', p).execute();
    expect(lotes).toHaveLength(1);
    expect(propuestas).toHaveLength(validarArbol(arbol).registros.length + validarArbol(arbol).taxonomias.length);
  });

  it('AC-AUT-001-02 ratificar con un actor no humano da 403 sin efectos', async () => {
    const p = await proyecto('H1 solo persona');
    const r = await importar(p);
    const eventos = async () => (await s.db.selectFrom('events').select('id').where('project_id', '=', p).execute()).length;
    const antes = await eventos();
    for (const actor of [
      agenteExterno('claude-code', 's'),
      agenteRun('00000000-0000-7000-8000-000000000009'),
      sistema('importador'),
    ]) {
      await expect(ratificar(p, r.entidadId, actor)).rejects.toMatchObject({ tipo: 'prohibido' });
    }
    expect(await eventos()).toBe(antes);
    expect(await s.db.selectFrom('records').select('id').where('project_id', '=', p).execute()).toHaveLength(0);
  });

  it('AC-AUT-001-03 ratificar en un paso crea todo con los estados del origen y la persona como actor', async () => {
    const p = await proyecto('H1 ratificar');
    const r = await importar(p);
    await ratificar(p, r.entidadId);
    const informe = validarArbol(arbol);
    expect(await recuentosEnBase(p)).toEqual(recuentosDelArbol(informe.registros, informe.taxonomias));
    // Todo el design/ de D0 está «propuesto»: las versiones quedan en borrador.
    const estados = await s.db.selectFrom('record_versions').select('state').where('project_id', '=', p).execute();
    expect(new Set(estados.map((e) => e.state))).toEqual(new Set(['draft']));
    const actores = await s.db
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
    expect(actores.length).toBeGreaterThan(20);
    expect(actores.every((e) => e.actor === 'human:ana')).toBe(true);
    const lote = await s.db
      .selectFrom('proposal_batches')
      .select('state')
      .where('id', '=', r.entidadId)
      .executeTakeFirstOrThrow();
    expect(lote.state).toBe('accepted');
  });

  it('AC-AUT-001-04 tras ratificar, la exportación coincide byte a byte con design/', async () => {
    const p = await proyecto('H1 exportar');
    await ratificar(p, (await importar(p)).entidadId);
    expect(await compararExportacion(s.db, p, arbol)).toEqual([]);
    const exportado = await exportarDiseno(s.db, p);
    expect([...exportado.keys()].sort()).toEqual([...arbol.keys()].sort());
  });

  it('AC-AUT-001-04 con documentos aprobados en el origen, se aprueban al ratificar y la exportación sigue sin diff', async () => {
    const p = await proyecto('H1 aprobados');
    // Simula el merge de la persona: aprueba la decisión y la taxonomía editando su estado.
    const aprobado = new Map(arbol);
    for (const ruta of ['decisiones/DEC-PLN-001.md', 'taxonomia/TAX-001.md']) {
      const doc = parsearDocumento(arbol.get(ruta) ?? '', ruta);
      if (!doc.ok) throw new Error('documento inválido');
      aprobado.set(ruta, renderizarDocumento({ ...doc.valor, estado: 'aprobado' }));
    }
    await ratificar(p, (await importar(p, aprobado)).entidadId);
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
    expect(await compararExportacion(s.db, p, aprobado)).toEqual([]);
  });

  it('AC-AUT-001-05 importar de nuevo tras ratificar no crea nada', async () => {
    const p = await proyecto('H1 reimportar');
    const r = await importar(p);
    await ratificar(p, r.entidadId);
    const antes = await recuentosEnBase(p);
    const otra = await importar(p);
    expect(otra.entidadId).toBe(r.entidadId);
    expect(otra.resultado).toMatchObject({ repetida: true, estado: 'accepted' });
    expect(await recuentosEnBase(p)).toEqual(antes);
    expect(
      await s.db.selectFrom('proposal_batches').select('id').where('project_id', '=', p).where('kind', '=', 'import').execute(),
    ).toHaveLength(1);
  });
});

describe('reimportación y diseño en la v2 (revisión de H1)', () => {
  const FDR = 'fdr/FDR-AUT-001.md';

  it('AC-AUT-001-05 un cambio sin subir la versión se rechaza nombrando el documento; subiéndola se propone solo ese', async () => {
    const p = await proyecto('H1 cambio sin versión');
    await ratificar(p, (await importar(p)).entidadId);
    // Un enlace nuevo en la misma versión: la huella del contenido no bastaba para verlo.
    const conEnlace = (d: Documento) => {
      const r = comoRegistro(d);
      return {
        ...r,
        enlaces: [...r.enlaces, { tipo: 'conflicts_with' as const, destino: { codigo: 'ADR-FMT-001', version: 1 } }],
      };
    };
    await expect(importar(p, editar(arbol, FDR, conEnlace))).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: [`${FDR}: la versión 1 ya está en la v2 con otro contenido; sube la versión y añade nota_de_cambio.`],
    });
    const v2 = editar(arbol, FDR, (d) => ({ ...conEnlace(d), version: 2, notaDeCambio: 'Enlaza con el formato.' }));
    const r = await importar(p, v2);
    expect(r.resultado).toMatchObject({ propuestas: 1 });
    await ratificar(p, r.entidadId);
    expect(await compararExportacion(s.db, p, v2)).toEqual([]);
  });

  it('AC-AUT-001-05 un cambio solo de estado, también de la taxonomía, se ratifica y la exportación coincide', async () => {
    const p = await proyecto('H1 solo estado');
    await ratificar(p, (await importar(p)).entidadId);
    let aprobado = arbol;
    for (const ruta of ['decisiones/DEC-PLN-001.md', 'taxonomia/TAX-001.md']) {
      aprobado = editar(aprobado, ruta, (d) => ({ ...d, estado: 'aprobado' }));
    }
    const r = await importar(p, aprobado);
    expect(r.resultado).toMatchObject({ propuestas: 2 });
    await ratificar(p, r.entidadId);
    const tax = await s.db.selectFrom('taxonomies').select('state').where('project_id', '=', p).execute();
    expect(tax.map((t) => t.state)).toEqual(['approved']);
    expect(await compararExportacion(s.db, p, aprobado)).toEqual([]);
  });

  it('AC-AUT-001-04 una versión nueva aprobada en la v2 deja una exportación válida que, reimportada, no propone nada', async () => {
    const p = await proyecto('H1 versión en la v2');
    await ratificar(p, (await importar(p)).entidadId);
    const dec = await s.db
      .selectFrom('records')
      .select('id')
      .where('project_id', '=', p)
      .where('code', '=', 'DEC-PLN-001')
      .executeTakeFirstOrThrow();
    const original = parsearDocumento(arbol.get('decisiones/DEC-PLN-001.md') ?? '', 'dec');
    if (!original.ok) throw new Error('DEC-PLN-001 no es válido');
    const nueva = await ejecutarComando(s, {
      comando: 'record_version.create',
      actor: ana,
      proyectoId: p,
      datos: {
        record_id: dec.id,
        titulo: original.valor.titulo,
        secciones: original.valor.secciones,
        nota_de_cambio: 'Se revisa el plan.',
      },
    });
    await ejecutarComando(s, {
      comando: 'record_version.approve',
      actor: ana,
      proyectoId: p,
      entidadId: nueva.entidadId,
      datos: {},
    });
    const exportado = await exportarDiseno(s.db, p);
    expect(validarArbol(exportado).problemas).toEqual([]);
    // Los documentos que se basan en DEC-PLN-001 siguen en su versión 1 hasta que la persona revise el enlace.
    expect(exportado.get(FDR)).toContain('destino: DEC-PLN-001@1');
    await expect(importar(p, exportado)).rejects.toMatchObject({ tipo: 'conflicto' });
  });

  it('AC-AUT-001-04 un registro creado en la v2 no comparte DOM-NNN con otro tipo: la exportación sigue siendo válida', async () => {
    const p = await proyecto('H1 códigos');
    await ratificar(p, (await importar(p)).entidadId);
    const fdr = {
      tipo: 'fdr',
      dominio: 'nucleo',
      titulo: 'El núcleo del Pilar 2',
      secciones: [
        { titulo: 'Objetivo', contenido: 'o' },
        { titulo: 'Alcance', contenido: 'a' },
        { titulo: 'Fuera de alcance', contenido: 'f' },
        { titulo: 'Comportamiento', contenido: 'c' },
      ],
      criterios: [
        {
          arrastre: 'new',
          titulo: 'Tareas',
          enunciado: 'Cuando se crea una tarea, entonces cubre un AC.',
          verificacion: 'automatic',
          comprobacion: 'Prueba.',
        },
      ],
    };
    const r = await ejecutarComando(s, { comando: 'record.create', actor: ana, proyectoId: p, datos: fdr });
    // ADR-NUC-001 ya existe: la FDR del mismo dominio recibe el siguiente número de NUC.
    expect((r.resultado as { codigo: string }).codigo).toBe('FDR-NUC-002');
    await expect(
      ejecutarComando(s, { comando: 'record.create', actor: ana, proyectoId: p, datos: { ...fdr, codigo: 'FDR-NUC-001' } }),
    ).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: ['FDR-NUC-001 comparte NUC-001 con ADR-NUC-001: la parte DOM-NNN de un código es única entre tipos.'],
    });
    expect(validarArbol(await exportarDiseno(s.db, p)).problemas).toEqual([]);
  });

  it('AC-AUT-001-04 un criterio con «Deriva de» sobrevive a la ida y vuelta', async () => {
    const p = await proyecto('H1 deriva de');
    const conDerivado = editar(arbol, FDR, (d) => {
      const r = comoRegistro(d);
      const nuevo = {
        codigo: 'AC-AUT-001-09',
        titulo: 'Reimportación sin efectos',
        verificacion: 'automática' as const,
        comprobacion: 'Se reimporta tras ratificar.',
        enunciado: 'Dado design/ ratificado, cuando se importa otra vez, entonces no se crea nada.',
        derivaDe: 'AC-CON-001-10',
      };
      return { ...r, criterios: [...r.criterios, nuevo] };
    });
    expect(validarArbol(conDerivado).problemas).toEqual([]);
    await ratificar(p, (await importar(p, conDerivado)).entidadId);
    expect(await compararExportacion(s.db, p, conDerivado)).toEqual([]);
  });

  it('AC-AUT-001-01 una importación nueva deja obsoleta la que seguía pendiente', async () => {
    const p = await proyecto('H1 dos importaciones');
    const primera = await importar(p);
    const segunda = await importar(
      p,
      editar(arbol, 'decisiones/DEC-PLN-001.md', (d) => ({ ...d, estado: 'aprobado' })),
    );
    const estado = async (id: string) =>
      (await s.db.selectFrom('proposal_batches').select('state').where('id', '=', id).executeTakeFirstOrThrow()).state;
    expect(await estado(primera.entidadId)).toBe('superseded');
    expect(await estado(segunda.entidadId)).toBe('pending');
    await ratificar(p, segunda.entidadId);
  });

  it('AC-AUT-001-01 una persona puede importar: el importador produce el lote y ella queda en el evento', async () => {
    const p = await proyecto('H1 importa una persona');
    const r = await ejecutarComando(s, {
      comando: 'design.import',
      actor: ana,
      proyectoId: p,
      datos: { arbol: Object.fromEntries(arbol) },
    });
    const lote = await s.db
      .selectFrom('proposal_batches')
      .select('producer')
      .where('id', '=', r.entidadId)
      .executeTakeFirstOrThrow();
    expect(lote.producer).toBe('system:importador@1');
    const evento = await s.db
      .selectFrom('events')
      .select('actor')
      .where('command', '=', 'design.import')
      .where('entity_id', '=', r.entidadId)
      .executeTakeFirstOrThrow();
    expect(evento.actor).toBe('human:ana');
  });

  it('AC-AUT-001-02 solo la importación propone documentos importados', async () => {
    const p = await proyecto('H1 tipos importados');
    const informe = validarArbol(arbol);
    const documento = { ...informe.registros[0], anexosContenido: [] };
    for (const actor of [sistema('prueba'), sistema('conocimiento')]) {
      await expect(
        ejecutarComando(s, {
          comando: 'batch.submit',
          actor,
          proyectoId: p,
          datos: { propuestas: [{ tipo: 'registro_importado', carga: { documento, ruta: 'x' } }] },
        }),
      ).rejects.toMatchObject({
        tipo: 'guarda',
        motivos: expect.arrayContaining(['Solo la importación de design/ propone «registro_importado».']),
      });
    }
  });

  it('AC-AUT-001-05 aprobar desde design/ una versión anterior a la aprobada en la v2 se rechaza al importar, también en la taxonomía', async () => {
    const p = await proyecto('H1 aprobada posterior');
    await ratificar(p, (await importar(p)).entidadId);
    const dec = await s.db
      .selectFrom('records')
      .select('id')
      .where('project_id', '=', p)
      .where('code', '=', 'DEC-PLN-001')
      .executeTakeFirstOrThrow();
    const original = parsearDocumento(arbol.get('decisiones/DEC-PLN-001.md') ?? '', 'dec');
    if (!original.ok) throw new Error('DEC-PLN-001 no es válido');
    const v2 = await ejecutarComando(s, {
      comando: 'record_version.create',
      actor: ana,
      proyectoId: p,
      datos: {
        record_id: dec.id,
        titulo: original.valor.titulo,
        secciones: original.valor.secciones,
        nota_de_cambio: 'Revisión.',
      },
    });
    await ejecutarComando(s, {
      comando: 'record_version.approve',
      actor: ana,
      proyectoId: p,
      entidadId: v2.entidadId,
      datos: {},
    });
    // La taxonomía: una v2 aprobada en la v2.
    const tax = await s.db.selectFrom('taxonomies').selectAll().where('project_id', '=', p).executeTakeFirstOrThrow();
    const taxV2 = await ejecutarComando(s, {
      comando: 'taxonomy.propose',
      actor: ana,
      proyectoId: p,
      datos: { codigo: tax.code, titulo: tax.title, ejes: tax.axes, secciones: tax.sections, version: 2 },
    });
    await ejecutarComando(s, { comando: 'taxonomy.approve', actor: ana, proyectoId: p, entidadId: taxV2.entidadId, datos: {} });
    await expect(
      ejecutarComando(s, { comando: 'taxonomy.approve', actor: ana, proyectoId: p, entidadId: tax.id, datos: {} }),
    ).rejects.toMatchObject({ tipo: 'guarda', motivos: ['Ya hay una versión aprobada posterior (v2) de esta taxonomía.'] });
    const viejo = editar(editar(arbol, 'decisiones/DEC-PLN-001.md', aprobar), 'taxonomia/TAX-001.md', aprobar);
    await expect(importar(p, viejo)).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: [
        'decisiones/DEC-PLN-001.md: la v2 ya tiene aprobada la versión 2; la 1 solo se puede descartar.',
        'taxonomia/TAX-001.md: la v2 ya tiene aprobada la versión 2; la 1 no se puede aprobar.',
      ],
    });
  });

  it('AC-AUT-001-05 lo que no se podría ratificar se rechaza al importar: estado hacia atrás, versión anterior, anexo cambiado, enlace a una versión que no está', async () => {
    const p = await proyecto('H1 problemas al importar');
    const aprobada = editar(arbol, 'decisiones/DEC-PLN-001.md', aprobar);
    await ratificar(p, (await importar(p, aprobada)).entidadId);
    // Volver a «propuesto» una versión aprobada.
    await expect(importar(p, arbol)).rejects.toMatchObject({
      motivos: ['decisiones/DEC-PLN-001.md: la versión 1 está aprobada en la v2 y no puede pasar a «propuesto».'],
    });
    // Un anexo cambiado sin subir la versión de su registro.
    const anexo = new Map(aprobada);
    anexo.set('datos/capacidades.yaml', `${aprobada.get('datos/capacidades.yaml') ?? ''}# Comentario nuevo.\n`);
    await expect(importar(p, anexo)).rejects.toMatchObject({
      motivos: ['adr/ADR-NUC-001.md: la versión 1 ya está en la v2 con otro contenido; sube la versión y añade nota_de_cambio.'],
    });
    // Una versión anterior a la última de la v2.
    const v3 = editar(aprobada, 'decisiones/DEC-PLN-001.md', conVersion(3, 'Tercera.'));
    await ratificar(p, (await importar(p, v3)).entidadId);
    await expect(importar(p, editar(aprobada, 'decisiones/DEC-PLN-001.md', conVersion(2, 'Segunda.')))).rejects.toMatchObject({
      motivos: ['decisiones/DEC-PLN-001.md: la versión 2 es anterior a la última de la v2 (3).'],
    });
    // Un enlace a una versión anterior que la v2 no tiene (proyecto nuevo).
    const q = await proyecto('H1 enlace anterior');
    await expect(importar(q, v3)).rejects.toMatchObject({
      motivos: expect.arrayContaining([
        `${FDR}: el enlace a DEC-PLN-001@1 apunta a una versión que no está en design/ ni en la v2.`,
      ]),
    });
  });

  it('AC-AUT-001-05 un código de AC descartado no vuelve, un código nuevo no comparte DOM-NNN con la v2 y «Deriva de» se conserva entre versiones', async () => {
    const p = await proyecto('H1 criterios entre versiones');
    const nuevo = {
      codigo: 'AC-AUT-001-09',
      titulo: 'Reimportación sin efectos',
      verificacion: 'automática' as const,
      comprobacion: 'Se reimporta tras ratificar.',
      enunciado: 'Dado design/ ratificado, cuando se importa otra vez, entonces no se crea nada.',
      derivaDe: 'AC-CON-001-10',
    };
    const v1 = editar(arbol, FDR, (d) => ({ ...comoRegistro(d), criterios: [...comoRegistro(d).criterios, nuevo] }));
    await ratificar(p, (await importar(p, v1)).entidadId);
    // v2 conserva el criterio derivado y descarta AC-AUT-001-08: la exportación coincide.
    const v2 = editar(v1, FDR, (d) => {
      const r = comoRegistro(d);
      return {
        ...r,
        version: 2,
        notaDeCambio: 'Sin AC-AUT-001-08.',
        criterios: r.criterios.filter((c) => c.codigo !== 'AC-AUT-001-08'),
      };
    });
    await ratificar(p, (await importar(p, v2)).entidadId);
    expect(await compararExportacion(s.db, p, v2)).toEqual([]);
    // v3 no puede recuperar AC-AUT-001-08 ni cambiar la derivación de AC-AUT-001-09.
    const v3 = editar(v1, FDR, (d) => {
      const r = comoRegistro(d);
      return {
        ...r,
        version: 3,
        notaDeCambio: 'Vuelve AC-AUT-001-08.',
        criterios: r.criterios.map((c) => (c.codigo === 'AC-AUT-001-09' ? { ...c, derivaDe: 'AC-CON-001-01' } : c)),
      };
    });
    await expect(importar(p, v3)).rejects.toMatchObject({
      motivos: [
        `${FDR}: AC-AUT-001-08 ya se usó en una versión anterior; un criterio nuevo lleva un código nuevo.`,
        `${FDR}: AC-AUT-001-09 cambia su «Deriva de»; un criterio que se mantiene o se modifica conserva su derivación.`,
      ],
    });
    // Un registro nuevo de design/ que comparte DOM-NNN con uno creado en la v2.
    await ejecutarComando(s, {
      comando: 'record.create',
      actor: ana,
      proyectoId: p,
      datos: {
        tipo: 'adr',
        codigo: 'ADR-ZET-001',
        dominio: 'zeta',
        titulo: 'Solo en la v2',
        secciones: [
          { titulo: 'Contexto', contenido: 'c' },
          { titulo: 'Opciones', contenido: 'o' },
          { titulo: 'Decisión', contenido: 'd' },
          { titulo: 'Consecuencias', contenido: 'k' },
        ],
        criterios: [
          {
            arrastre: 'new',
            titulo: 'T',
            enunciado: 'Cuando pasa, entonces se ve.',
            verificacion: 'automatic',
            comprobacion: 'P.',
          },
        ],
      },
    });
    const conZet = new Map(v2);
    const dec = parsearDocumento(arbol.get('decisiones/DEC-PLN-001.md') ?? '', 'dec');
    if (!dec.ok) throw new Error('DEC-PLN-001 no es válido');
    conZet.set(
      'decisiones/DEC-ZET-001.md',
      renderizarDocumento({ ...comoRegistro(dec.valor), codigo: 'DEC-ZET-001', dominio: 'zeta', enlaces: [] }),
    );
    await expect(importar(p, conZet)).rejects.toMatchObject({
      motivos: ['decisiones/DEC-ZET-001.md: DEC-ZET-001 comparte ZET-001 con ADR-ZET-001, que ya está en la v2.'],
    });
  });

  it('AC-AUT-001-05 si la versión cambia en la v2 entre importar y ratificar, ratificar se rechaza sin efectos', async () => {
    const p = await proyecto('H1 cambio antes de ratificar');
    await ratificar(p, (await importar(p)).entidadId);
    const lote = await importar(p, editar(arbol, 'decisiones/DEC-PLN-001.md', aprobar));
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
    await expect(ratificar(p, lote.entidadId)).rejects.toMatchObject({ tipo: 'conflicto' });
    const estado = await s.db
      .selectFrom('proposal_batches')
      .select('state')
      .where('id', '=', lote.entidadId)
      .executeTakeFirstOrThrow();
    expect(estado.state).toBe('pending');
  });
});
